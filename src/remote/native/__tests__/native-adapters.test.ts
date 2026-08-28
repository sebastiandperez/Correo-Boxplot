import { describe, expect, it, vi } from 'vitest'

import { createMemoryLocalEngine } from '../../../adapters/memory'
import { Coordinator } from '../../../sync/coordinator'
import { Outbox } from '../../../sync/outbox'
import { unwrapOk } from '../../../tests/contracts/assertions'
import {
  createTestAccount,
  createTestIdentity,
  createTestSendMutation,
} from '../../../tests/contracts/fixtures'
import { localEmailId } from '../../compat/domain-ids'
import { createRemoteConnection } from '../../runtime'
import {
  decodeImapEmailId,
  imapAccountId,
  imapEmailId,
  imapMailboxId,
} from '../../imap/ids'
import { ImapRemoteMail } from '../../imap/imap-remote-mail'
import { SmtpSubmission } from '../../smtp/smtp-submission'
import { ImapSmtpRemoteConnection } from '../imap-smtp-connection'
import {
  NATIVE_MAIL_COMMANDS,
  NativeMailIpcClient,
  type NativeMailInvoke,
} from '../native-mail-ipc-client'
import type {
  NativeAttachmentDto,
  NativeBodyDto,
  NativeMailIpcPort,
  NativeMailOpenRequest,
  NativeMailOpenResponse,
  NativeMailboxDto,
  NativeMailboxSnapshotDto,
  NativeMessageRequest,
  NativeMoveRequest,
  NativeMoveResponse,
  NativeSmtpSubmitRequest,
  NativeSmtpSubmitResponse,
  NativeStoreFlagsRequest,
} from '../ipc'

class FakeNativeMailIpc implements NativeMailIpcPort {
  readonly calls: Array<readonly [string, unknown]> = []
  mailboxes: readonly NativeMailboxDto[] = [
    { name: 'Trash', messages: 0, unseen: 0, uidValidity: 3, uidNext: 1 },
    { name: 'INBOX', messages: 1, unseen: 1, uidValidity: 1, uidNext: 2 },
    { name: 'Sent', messages: 0, unseen: 0, uidValidity: 2, uidNext: 1 },
  ]
  messages = [message()]
  body: NativeBodyDto = { kind: 'plain', text: 'hello', html: null }
  attachments: readonly NativeAttachmentDto[] = []
  openResponse: NativeMailOpenResponse = {
    sessionId: 'native-session',
    authenticatedUser: 'alice@boxplot.test',
  }

  async open(request: NativeMailOpenRequest) {
    this.calls.push(['open', request])
    return this.openResponse
  }
  async close(sessionId: string) {
    this.calls.push(['close', sessionId])
  }
  async listMailboxes(sessionId: string) {
    this.calls.push(['listMailboxes', sessionId])
    return this.mailboxes
  }
  async snapshotMailbox(sessionId: string, mailbox: string) {
    this.calls.push(['snapshotMailbox', { sessionId, mailbox }])
    const metadata = this.messages.filter((value) => value.mailbox === mailbox)
    return {
      mailbox: this.mailboxes.find((value) => value.name === mailbox)!,
      messages: metadata,
    } satisfies NativeMailboxSnapshotDto
  }
  async fetchBody(request: NativeMessageRequest) {
    this.calls.push(['fetchBody', request])
    return this.body
  }
  async fetchAttachments(request: NativeMessageRequest) {
    this.calls.push(['fetchAttachments', request])
    return this.attachments
  }
  async storeFlags(request: NativeStoreFlagsRequest) {
    this.calls.push(['storeFlags', request])
  }
  async move(request: NativeMoveRequest) {
    this.calls.push(['move', request])
    return {
      sourceMailbox: request.mailbox,
      sourceUidValidity: request.uidValidity,
      sourceUid: request.uid,
      destinationMailbox: request.destinationMailbox,
      destinationUid: 1,
    } satisfies NativeMoveResponse
  }
  async smtpSubmit(request: NativeSmtpSubmitRequest) {
    this.calls.push(['smtpSubmit', request])
    return {
      accepted: true,
      receiptId: '<receipt>',
    } satisfies NativeSmtpSubmitResponse
  }
}

function message(overrides: Partial<ReturnType<typeof messageBase>> = {}) {
  return { ...messageBase(), ...overrides }
}

function messageBase() {
  return {
    mailbox: 'INBOX',
    uidValidity: 1,
    uid: 1,
    flags: [] as readonly string[],
    internalDate: '2026-08-28T12:00:00+00:00',
    size: 42,
    sender: null,
    from: [{ name: 'Alice', email: 'alice@boxplot.test' }],
    replyTo: null,
    to: [{ name: null, email: 'bob@boxplot.test' }],
    cc: null,
    bcc: null,
    subject: 'Hello',
    sentAt: null,
    preview: 'hello',
    hasAttachment: false,
  }
}

describe('ImapRemoteMail', () => {
  it('always returns authoritative replacement snapshots', async () => {
    const ipc = new FakeNativeMailIpc()
    const mail = new ImapRemoteMail(ipc, 's', 'alice@boxplot.test')
    expect((await mail.syncIdentities(mail.accountId, null)).mode).toBe(
      'replace',
    )
    const mailboxSync = await mail.syncMailboxes(
      mail.accountId,
      'opaque' as never,
    )
    expect(mailboxSync.mode).toBe('replace')
    if (mailboxSync.mode !== 'replace') throw new Error('expected replace')
    expect(
      mailboxSync.snapshot.map((value) => [value.name, value.role]),
    ).toEqual([
      ['INBOX', 'inbox'],
      ['Sent', 'sent'],
      ['Trash', 'trash'],
    ])
    const emailSync = await mail.syncEmails(mail.accountId, 'opaque' as never)
    expect(emailSync.mode).toBe('replace')
    if (emailSync.mode !== 'replace') throw new Error('expected replace')
    expect(emailSync.snapshot[0]).toMatchObject({
      subject: 'Hello',
      preview: 'hello',
      mailboxIds: [imapMailboxId('INBOX')],
    })
  })

  it('maps flags and creates deterministic state', async () => {
    const ipc = new FakeNativeMailIpc()
    ipc.messages = [message({ flags: ['\\Seen', '\\Flagged'] })]
    const mail = new ImapRemoteMail(ipc, 's', 'alice@boxplot.test')
    const first = await mail.syncEmails(mail.accountId, null)
    const second = await mail.syncEmails(mail.accountId, null)
    expect(first.state).toBe(second.state)
    if (first.mode !== 'replace') throw new Error('expected replace')
    expect([...first.snapshot[0]!.keywords]).toEqual(['$seen', '$flagged'])
  })

  it('queries with total, limit, anchor and no delta support', async () => {
    const ipc = new FakeNativeMailIpc()
    ipc.mailboxes = [
      { name: 'INBOX', messages: 2, unseen: 2, uidValidity: 1, uidNext: 3 },
    ]
    ipc.messages = [
      message({ uid: 1, internalDate: '2026-01-01T00:00:00+00:00' }),
      message({ uid: 2, internalDate: '2026-02-01T00:00:00+00:00' }),
    ]
    const mail = new ImapRemoteMail(ipc, 's', 'alice@boxplot.test')
    const first = await mail.queryMailbox(
      mail.accountId,
      imapMailboxId('INBOX'),
      undefined,
      { limit: 1 },
    )
    expect(first).toMatchObject({
      total: 2,
      position: 0,
      canCalculateChanges: false,
    })
    expect(decodeImapEmailId(first.ids[0]!).uid).toBe(2)
    const anchored = await mail.queryMailbox(
      mail.accountId,
      imapMailboxId('INBOX'),
      undefined,
      {
        position: 99,
        anchor: first.ids[0],
        anchorOffset: 1,
        limit: 1,
      },
    )
    expect(anchored.position).toBe(1)
    expect(decodeImapEmailId(anchored.ids[0]!).uid).toBe(1)
  })

  it('maps body, E2EE transport and attachment metadata', async () => {
    const ipc = new FakeNativeMailIpc()
    const mail = new ImapRemoteMail(ipc, 's', 'alice@boxplot.test')
    const emailId = imapEmailId({ mailbox: 'INBOX', uidValidity: 1, uid: 1 })
    expect(await mail.fetchBody(mail.accountId, emailId)).toEqual({
      kind: 'plain',
      text: 'hello',
      html: null,
    })
    ipc.body = { kind: 'boxplotE2ee', payload: '{"v":1}' }
    expect(await mail.fetchBody(mail.accountId, emailId)).toEqual({
      kind: 'boxplotE2ee',
      contentType: 'application/vnd.boxplot.e2ee+json',
      payload: '{"v":1}',
    })
    ipc.attachments = [
      {
        partId: '2',
        name: null,
        mediaType: 'image/png',
        size: 3,
        disposition: 'inline',
        cid: '',
      },
    ]
    expect(await mail.fetchAttachments(mail.accountId, emailId)).toMatchObject([
      { partId: '2', name: null, cid: '' },
    ])
  })

  it('maps supported mutations and rejects unsupported changes before IPC', async () => {
    const ipc = new FakeNativeMailIpc()
    const mail = new ImapRemoteMail(ipc, 's', 'alice@boxplot.test')
    const emailId = imapEmailId({ mailbox: 'INBOX', uidValidity: 1, uid: 1 })
    await mail.applyKeywordChange(mail.accountId, emailId, {
      add: ['$seen'],
      remove: ['$flagged'],
    })
    expect(ipc.calls.at(-1)).toEqual([
      'storeFlags',
      expect.objectContaining({ add: ['seen'], remove: ['flagged'] }),
    ])
    const before = ipc.calls.length
    await expect(
      mail.applyKeywordChange(mail.accountId, emailId, {
        add: ['$custom'],
        remove: [],
      }),
    ).rejects.toMatchObject({ kind: 'unsupported' })
    expect(ipc.calls).toHaveLength(before)
    await mail.applyMembershipChange(mail.accountId, emailId, {
      remove: [imapMailboxId('INBOX')],
      add: [imapMailboxId('Trash')],
    })
    expect(ipc.calls.at(-1)).toEqual([
      'move',
      expect.objectContaining({ destinationMailbox: 'Trash' }),
    ])
    const afterMove = ipc.calls.length
    await mail.applyMembershipChange(mail.accountId, emailId, {
      remove: [],
      add: [],
    })
    expect(ipc.calls).toHaveLength(afterMove)
    await expect(
      mail.applyMembershipChange(mail.accountId, emailId, {
        remove: [imapMailboxId('INBOX')],
        add: [imapMailboxId('Trash'), imapMailboxId('Sent')],
      }),
    ).rejects.toMatchObject({ kind: 'unsupported' })
    expect(ipc.calls).toHaveLength(afterMove)
  })

  it('maps typed native failures', async () => {
    const ipc = new FakeNativeMailIpc()
    ipc.fetchBody = vi.fn().mockRejectedValue({
      kind: 'stateInvalid',
      retry: 'never',
      session: 'keep',
      outcome: 'knownNotApplied',
      code: 'uidvalidity_changed',
    })
    const mail = new ImapRemoteMail(ipc, 's', 'alice@boxplot.test')
    await expect(
      mail.fetchBody(
        mail.accountId,
        imapEmailId({ mailbox: 'INBOX', uidValidity: 9, uid: 1 }),
      ),
    ).rejects.toMatchObject({
      kind: 'stateInvalid',
      retry: 'never',
      outcome: 'knownNotApplied',
    })
  })
})

describe('SmtpSubmission and connection', () => {
  it('returns accepted with no fabricated RemoteEmailId', async () => {
    const ipc = new FakeNativeMailIpc()
    const accountId = imapAccountId('alice@boxplot.test')
    const submission = new SmtpSubmission(ipc, 's', accountId)
    const result = await submission.submit(
      {
        remoteAccountId: accountId,
        remoteIdentityId: null,
        from: { name: 'Alice', email: 'alice@boxplot.test' },
        to: [{ name: null, email: 'bob@boxplot.test' }],
        cc: [],
        bcc: [],
        replyTo: [],
        subject: 'Hello',
        body: { kind: 'plain', text: 'body', html: null },
      },
      'mutation-1',
    )
    expect(result).toEqual({
      kind: 'accepted',
      remoteEmailId: null,
      receiptId: '<receipt>',
    })
  })

  it('opens one protocol-neutral account and closes idempotently', async () => {
    const ipc = new FakeNativeMailIpc()
    const connection = new ImapSmtpRemoteConnection(
      {
        provider: 'imapSmtp',
        host: '127.0.0.1',
        username: 'alice@boxplot.test',
        password: 'secret',
        imapPort: 1143,
        smtpPort: 1587,
      },
      ipc,
    )
    const session = await connection.open()
    expect(session.accounts).toEqual([
      {
        id: imapAccountId('alice@boxplot.test'),
        capabilities: ['mail', 'submission'],
      },
    ])
    expect(session).not.toHaveProperty('password')
    await session.close()
    await session.close()
    expect(ipc.calls.filter(([kind]) => kind === 'close')).toHaveLength(1)
  })

  it('selects imapSmtp only at the runtime factory boundary', () => {
    const ipc = new FakeNativeMailIpc()
    const config = {
      provider: 'imapSmtp' as const,
      host: '127.0.0.1',
      username: 'alice@boxplot.test',
      password: 'secret',
      imapPort: 1143,
      smtpPort: 1587,
    }
    const expected = new ImapSmtpRemoteConnection(config, ipc)
    expect(
      createRemoteConnection(config, {
        jmap: () => {
          throw new Error('wrong factory')
        },
        imapSmtp: () => expected,
      }),
    ).toBe(expected)
  })

  it('keeps ambiguous SMTP failures reconcile/unknown', async () => {
    const ipc = new FakeNativeMailIpc()
    ipc.smtpSubmit = vi.fn().mockRejectedValue({
      kind: 'network',
      retry: 'reconcile',
      session: 'keep',
      outcome: 'unknown',
      code: 'smtp_acceptance_unknown',
    })
    const accountId = imapAccountId('alice@boxplot.test')
    await expect(
      new SmtpSubmission(ipc, 's', accountId).submit(
        {
          remoteAccountId: accountId,
          remoteIdentityId: null,
          from: { name: null, email: 'alice@boxplot.test' },
          to: [{ name: null, email: 'bob@boxplot.test' }],
          cc: [],
          bcc: [],
          replyTo: [],
          subject: '',
          body: { kind: 'plain', text: '', html: null },
        },
        'mutation',
      ),
    ).rejects.toMatchObject({ retry: 'reconcile', outcome: 'unknown' })
  })
})

describe('architecture isolation', () => {
  it('keeps native adapters free of JMAP', async () => {
    const sources = await Promise.all([
      import('../../../sync/coordinator.ts?raw'),
      import('../../../sync/outbox.ts?raw'),
      import('../../imap/imap-remote-mail.ts?raw'),
      import('../../smtp/smtp-submission.ts?raw'),
    ])
    for (const source of sources) {
      expect(source.default).not.toMatch(/from\s+['"].*(?:imap|smtp|jmap)/i)
    }
  })
})

describe('typed native IPC', () => {
  it('exposes exactly nine explicit commands', () => {
    expect(NATIVE_MAIL_COMMANDS).toEqual([
      'native_mail_open',
      'native_mail_close',
      'native_imap_list_mailboxes',
      'native_imap_snapshot_mailbox',
      'native_imap_fetch_body',
      'native_imap_fetch_attachments',
      'native_imap_store_flags',
      'native_imap_move',
      'native_smtp_submit',
    ])
  })

  it('routes each capability through its dedicated command', async () => {
    const invoked: string[] = []
    const invoke: NativeMailInvoke = async <T>(command: string): Promise<T> => {
      invoked.push(command)
      const values: Record<string, unknown> = {
        native_mail_open: {
          sessionId: 's',
          authenticatedUser: 'alice@boxplot.test',
        },
        native_imap_list_mailboxes: [],
        native_imap_snapshot_mailbox: {
          mailbox: {
            name: 'INBOX',
            messages: 0,
            unseen: 0,
            uidValidity: 1,
            uidNext: 1,
          },
          messages: [],
        },
        native_imap_fetch_body: { kind: 'plain', text: null, html: null },
        native_imap_fetch_attachments: [],
        native_imap_move: {
          sourceMailbox: 'INBOX',
          sourceUidValidity: 1,
          sourceUid: 1,
          destinationMailbox: 'Trash',
          destinationUid: 1,
        },
        native_smtp_submit: { accepted: true, receiptId: 'receipt' },
      }
      return values[command] as T
    }
    const client = new NativeMailIpcClient(invoke)
    const target = { sessionId: 's', mailbox: 'INBOX', uidValidity: 1, uid: 1 }
    await client.open({
      host: '127.0.0.1',
      username: 'a',
      password: 'p',
      imapPort: 1143,
      smtpPort: 1587,
    })
    await client.close('s')
    await client.listMailboxes('s')
    await client.snapshotMailbox('s', 'INBOX')
    await client.fetchBody(target)
    await client.fetchAttachments(target)
    await client.storeFlags({ ...target, add: ['seen'], remove: [] })
    await client.move({ ...target, destinationMailbox: 'Trash' })
    await client.smtpSubmit({
      sessionId: 's',
      from: { name: null, email: 'a@x' },
      to: [{ name: null, email: 'b@x' }],
      cc: [],
      bcc: [],
      replyTo: [],
      subject: '',
      body: { kind: 'plain', text: '', html: null },
      idempotencyKey: 'm',
    })
    expect(invoked).toEqual(NATIVE_MAIL_COMMANDS)
  })
})

describe('protocol-neutral core verticals', () => {
  it('materializes IMAP data through the unchanged Coordinator', async () => {
    const ipc = new FakeNativeMailIpc()
    const mail = new ImapRemoteMail(ipc, 's', 'alice@boxplot.test')
    const engine = createMemoryLocalEngine()
    try {
      const account = createTestAccount('native-imap-vertical')
      unwrapOk(await engine.syncPort.registerAccount(account))
      await new Coordinator(
        mail,
        engine.syncPort,
        engine.readRepository,
      ).syncAccount(account.key, mail.accountId)
      const remoteId = imapEmailId({ mailbox: 'INBOX', uidValidity: 1, uid: 1 })
      const stored = unwrapOk(
        await engine.readRepository.readEmail(
          localEmailId(account.key, remoteId),
        ),
      )
      expect(stored).toMatchObject({
        kind: 'present',
        value: { subject: 'Hello' },
      })
    } finally {
      await engine.dispose()
    }
  })

  it('keeps SMTP accepted-without-ID in reconciliation through unchanged Outbox', async () => {
    const ipc = new FakeNativeMailIpc()
    const accountId = imapAccountId('alice@boxplot.test')
    const engine = createMemoryLocalEngine()
    try {
      const account = createTestAccount('native-smtp-vertical')
      const identity = createTestIdentity(account, 'native-smtp-vertical')
      const mutation = createTestSendMutation(
        account,
        identity,
        'native-smtp-vertical',
      )
      unwrapOk(await engine.syncPort.registerAccount(account))
      unwrapOk(await engine.syncPort.stageSendMutation(mutation))
      const outbox = new Outbox(
        new ImapRemoteMail(ipc, 's', 'alice@boxplot.test'),
        new SmtpSubmission(ipc, 's', accountId),
        engine.syncPort,
        engine.readRepository,
      )
      await expect(
        outbox.processSendMutation(account.key, accountId, mutation.mutationId),
      ).resolves.toEqual({ kind: 'needsReconciliation' })
      await expect(
        outbox.processSendMutation(account.key, accountId, mutation.mutationId),
      ).resolves.toEqual({ kind: 'skipped', reason: 'alreadyInFlight' })
      expect(ipc.calls.filter(([kind]) => kind === 'smtpSubmit')).toHaveLength(
        1,
      )
    } finally {
      await engine.dispose()
    }
  })
})
