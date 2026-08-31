import { afterEach, describe, expect, it } from 'vitest'

import { createMemoryLocalEngine } from '../../../adapters/memory'
import type { MemoryLocalEngine } from '../../../adapters/memory'
import { jmapAccountIdFromString } from '../../../domain/ids'
import { Outbox } from '../../../sync/outbox'
import { unwrapOk } from '../../../tests/contracts/assertions'
import {
  createTestAccount,
  createTestIdentity,
  createTestSendMutation,
} from '../../../tests/contracts/fixtures'
import { IPC_READ_COMMANDS, IPC_WRITE_COMMANDS } from '../../../ipc/commands'
import { RemoteError } from '../../errors'
import {
  decodeImapEmailId,
  decodeImapMailboxId,
  imapAccountId,
  imapEmailId,
  imapMailboxId,
} from '../../imap/ids'
import { ImapRemoteMail } from '../../imap/imap-remote-mail'
import { SmtpSubmission } from '../../smtp/smtp-submission'
import { FakeRemoteMail } from '../../testing/fake-remote-mail'
import { remoteAccountIdFromString, remoteEmailIdFromString } from '../../types'
import type {
  NativeAttachmentDto,
  NativeBodyDto,
  NativeMailIpcPort,
  NativeMailOpenResponse,
  NativeMailboxDto,
  NativeMailboxSnapshotDto,
  NativeMoveResponse,
  NativeSmtpSubmitResponse,
} from '../ipc'
import { NATIVE_MAIL_COMMANDS } from '../native-mail-ipc-client'

import coordinatorSource from '../../../sync/coordinator.ts?raw'
import outboxSource from '../../../sync/outbox.ts?raw'
import imapSource from '../../imap/imap-remote-mail.ts?raw'
import smtpSource from '../../smtp/smtp-submission.ts?raw'
import rustRuntimeSource from '../../../../src-tauri/src/net/runtime.rs?raw'
import rustImapSource from '../../../../src-tauri/src/net/imap.rs?raw'
import rustSmtpSource from '../../../../src-tauri/src/net/smtp.rs?raw'
import rustCommandsSource from '../../../../src-tauri/src/net/commands.rs?raw'

class SubmissionIpc implements NativeMailIpcPort {
  calls = 0
  failure: unknown = null

  async smtpSubmit(): Promise<NativeSmtpSubmitResponse> {
    this.calls += 1
    if (this.failure !== null) throw this.failure
    return { accepted: true, receiptId: 'test-owned-receipt' }
  }

  async open(): Promise<NativeMailOpenResponse> {
    throw new Error('not used')
  }
  async close(): Promise<void> {
    throw new Error('not used')
  }
  async listMailboxes(): Promise<readonly NativeMailboxDto[]> {
    throw new Error('not used')
  }
  async snapshotMailbox(
    sessionId: string,
    mailbox: string,
  ): Promise<NativeMailboxSnapshotDto> {
    void sessionId
    void mailbox
    throw new Error('not used')
  }
  async fetchBody(): Promise<NativeBodyDto> {
    throw new Error('not used')
  }
  async fetchAttachments(): Promise<readonly NativeAttachmentDto[]> {
    throw new Error('not used')
  }
  async findMessageId(): Promise<{ kind: 'notFound' }> {
    throw new Error('not used')
  }
  async storeFlags(): Promise<void> {
    throw new Error('not used')
  }
  async move(): Promise<NativeMoveResponse> {
    throw new Error('not used')
  }
}

class SnapshotIpc extends SubmissionIpc {
  listCalls = 0
  snapshotCalls = 0
  constructor(
    private readonly lists: readonly (readonly NativeMailboxDto[])[],
  ) {
    super()
  }

  override async listMailboxes(): Promise<readonly NativeMailboxDto[]> {
    const value = this.lists[this.listCalls]
    this.listCalls += 1
    if (value === undefined) throw new Error('unexpected mailbox listing')
    return value
  }

  override async snapshotMailbox(
    ...args: [string, string]
  ): Promise<NativeMailboxSnapshotDto> {
    const mailbox = args[1]
    this.snapshotCalls += 1
    return {
      mailbox: {
        name: mailbox,
        messages: 0,
        unseen: 0,
        uidValidity: 7,
        uidNext: 1,
      },
      messages: [],
    }
  }
}

describe('independent IMAP identity properties', () => {
  it('round-trips adversarial mailbox names exactly', () => {
    for (const mailbox of [
      'INBOX',
      'A/B',
      'A:B',
      'hello world',
      'Árbol',
      '🔥',
      '"quotes"',
      '{"x":1}',
    ]) {
      expect(decodeImapMailboxId(imapMailboxId(mailbox))).toBe(mailbox)
    }
  })

  it('scopes IDs by mailbox, UIDVALIDITY and UID independently', () => {
    const base = imapEmailId({ mailbox: 'A/B', uidValidity: 7, uid: 42 })
    const values = new Set([
      base,
      imapEmailId({ mailbox: 'A:B', uidValidity: 7, uid: 42 }),
      imapEmailId({ mailbox: 'A/B', uidValidity: 8, uid: 42 }),
      imapEmailId({ mailbox: 'A/B', uidValidity: 7, uid: 43 }),
    ])
    expect(values.size).toBe(4)
    expect(decodeImapEmailId(base)).toEqual({
      mailbox: 'A/B',
      uidValidity: 7,
      uid: 42,
    })
  })

  it('rejects malformed IDs and preserves opaque compatibility strings', () => {
    for (const malformed of [
      'not-imap',
      'imap-email-v1:x:0:1',
      'imap-email-v1:x:1:0',
      'imap-email-v1:🔥:1:1',
    ]) {
      expect(() =>
        decodeImapEmailId(remoteEmailIdFromString(malformed)),
      ).toThrow(RemoteError)
    }

    const opaque = 'imap-looking:/🔥:{"account":1}'
    const remote = remoteAccountIdFromString(opaque)
    const frozenLocalSpelling = jmapAccountIdFromString(remote)
    expect(remoteAccountIdFromString(frozenLocalSpelling)).toBe(opaque)
  })
})

describe('independent native Outbox semantics', () => {
  let engine: MemoryLocalEngine | undefined

  afterEach(async () => {
    await engine?.dispose()
    engine = undefined
  })

  async function setup(ipc: SubmissionIpc) {
    engine = createMemoryLocalEngine()
    const account = createTestAccount('native-independent')
    const identity = createTestIdentity(account, 'native-independent')
    const mutation = createTestSendMutation(
      account,
      identity,
      'native-independent',
    )
    unwrapOk(await engine.syncPort.registerAccount(account))
    unwrapOk(await engine.syncPort.stageSendMutation(mutation))
    const accountId = imapAccountId('alice@boxplot.test')
    const outbox = new Outbox(
      new FakeRemoteMail(),
      new SmtpSubmission(ipc, 'session', accountId),
      engine.syncPort,
      engine.readRepository,
    )
    return { account, mutation, accountId, outbox }
  }

  it('keeps accepted-without-RemoteEmailId inFlight and never submits twice', async () => {
    const ipc = new SubmissionIpc()
    const { account, mutation, accountId, outbox } = await setup(ipc)

    await expect(
      outbox.processSendMutation(account.key, accountId, mutation.mutationId),
    ).resolves.toEqual({ kind: 'needsReconciliation' })
    const stored = unwrapOk(
      await engine!.readRepository.readPendingMutation(
        account.key,
        mutation.mutationId,
      ),
    )
    expect(stored).toMatchObject({
      kind: 'present',
      value: { kind: 'send', lifecycle: { status: 'inFlight' } },
    })
    await expect(
      outbox.processSendMutation(account.key, accountId, mutation.mutationId),
    ).resolves.toEqual({ kind: 'skipped', reason: 'alreadyInFlight' })
    expect(ipc.calls).toBe(1)
  })

  it('keeps native ambiguous outcome inFlight and never submits twice', async () => {
    const ipc = new SubmissionIpc()
    ipc.failure = {
      kind: 'network',
      retry: 'reconcile',
      session: 'keep',
      outcome: 'unknown',
      code: 'smtp_acceptance_unknown',
    }
    const { account, mutation, accountId, outbox } = await setup(ipc)

    await expect(
      outbox.processSendMutation(account.key, accountId, mutation.mutationId),
    ).resolves.toEqual({ kind: 'needsReconciliation' })
    await expect(
      outbox.processSendMutation(account.key, accountId, mutation.mutationId),
    ).resolves.toEqual({ kind: 'skipped', reason: 'alreadyInFlight' })
    expect(ipc.calls).toBe(1)
  })
})

describe('independent account-wide replacement barrier', () => {
  const stable = [
    {
      name: 'INBOX',
      messages: 0,
      unseen: 0,
      uidValidity: 7,
      uidNext: 1,
    },
  ] as const
  const changed = [{ ...stable[0], uidNext: 2 }] as const

  it('discards one unstable attempt and accepts only the stable retry', async () => {
    const ipc = new SnapshotIpc([stable, changed, stable, stable])
    const mail = new ImapRemoteMail(ipc, 'session', 'alice@boxplot.test')

    const result = await mail.syncEmails(mail.accountId, null)

    expect(result).toMatchObject({ mode: 'replace', snapshot: [] })
    expect(ipc.listCalls).toBe(4)
    expect(ipc.snapshotCalls).toBe(2)
  })

  it('surfaces conflict after exactly two unstable attempts', async () => {
    const ipc = new SnapshotIpc([stable, changed, stable, changed])
    const mail = new ImapRemoteMail(ipc, 'session', 'alice@boxplot.test')

    await expect(mail.syncEmails(mail.accountId, null)).rejects.toMatchObject({
      kind: 'conflict',
      retry: 'safeImmediate',
      outcome: 'knownNotApplied',
    })
    expect(ipc.listCalls).toBe(4)
    expect(ipc.snapshotCalls).toBe(2)
  })
})

describe('independent architecture and credential-source audit', () => {
  it('keeps protocol-neutral core free of IMAP, SMTP, JMAP and providers', () => {
    for (const source of [coordinatorSource, outboxSource]) {
      expect(source).not.toMatch(/from\s+['"].*(?:imap|smtp|jmap)/i)
      expect(source).not.toMatch(/provider\s*===/)
    }
    expect(imapSource).not.toMatch(/from\s+['"].*jmap/i)
    expect(smtpSource).not.toMatch(/from\s+['"].*jmap/i)
  })

  it('keeps native Rust network code isolated from persistence and E2EE', () => {
    for (const source of [rustRuntimeSource, rustImapSource, rustSmtpSource]) {
      expect(source).not.toMatch(
        /sqlcipher|rusqlite|PersistentLocalEngine|EngineLease/,
      )
      expect(source).not.toMatch(/private[_-]?key|e2ee::|Pinia|Vue/)
    }
  })

  it('retains exact typed IPC inventories without generic JSON commands', () => {
    expect(IPC_READ_COMMANDS).toHaveLength(15)
    expect(IPC_WRITE_COMMANDS).toHaveLength(10)
    expect(NATIVE_MAIL_COMMANDS).toHaveLength(10)
    expect(new Set(NATIVE_MAIL_COMMANDS).size).toBe(10)
    expect(rustCommandsSource).not.toContain('serde_json::Value')
  })

  it('creates no additional owned credential-bearing wire command', () => {
    expect(rustImapSource).toContain('writer.write_all(command.as_bytes())')
    expect(rustSmtpSource).toContain('writer.write_all(command.as_bytes())')
    expect(rustImapSource).not.toContain('format!("{tag} {command}\\r\\n")')
    expect(rustSmtpSource).not.toContain('format!("{command}\\r\\n")')
    expect(rustRuntimeSource).not.toMatch(
      /println!|dbg!|password.*(?:log|print)/,
    )
  })
})
