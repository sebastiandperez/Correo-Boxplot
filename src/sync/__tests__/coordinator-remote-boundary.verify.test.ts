import { describe, it, expect, afterEach } from 'vitest'
import { Coordinator } from '../coordinator'
import {
  createMemoryLocalEngine,
  type MemoryLocalEngine,
} from '../../adapters/memory'
import { unwrapOk } from '../../tests/contracts/assertions'
import { createTestAccount } from '../../tests/contracts/fixtures'
import type {
  RemoteCollectionSync,
  RemoteKeywordChange,
  RemoteMail,
  RemoteMailboxQuery,
  RemoteMembershipChange,
  RemoteQueryOptions,
} from '../../remote/mail'
import { validateRemoteCollectionSync } from '../../remote/mail'
import type { RemoteBody } from '../../remote/body'
import type {
  RemoteAccountId,
  RemoteAttachment,
  RemoteEmail,
  RemoteEmailId,
  RemoteIdentity,
  RemoteIdentityId,
  RemoteMailbox,
  RemoteMailboxId,
  RemoteSyncState,
} from '../../remote/types'
import {
  remoteAccountIdFromString,
  remoteBlobIdFromString,
  remoteEmailIdFromString,
  remoteIdentityIdFromString,
  remoteMailboxIdFromString,
  remoteSyncStateFromString,
  remoteThreadIdFromString,
} from '../../remote/types'

class NonJmapFakeRemoteMail implements RemoteMail {
  identitiesState = remoteSyncStateFromString('state-id-01')
  identities: RemoteIdentity[] = []

  mailboxesState = remoteSyncStateFromString('{"uidValidity":7,"uidNext":4}')
  mailboxes: RemoteMailbox[] = []

  emailsState = remoteSyncStateFromString('{"uidValidity":7,"uidNext":4}')
  emails: RemoteEmail[] = []

  shouldFailIdentities = false
  shouldFailMailboxes = false
  shouldFailEmails = false

  async syncIdentities(
    accountId: RemoteAccountId,
    previousState: RemoteSyncState | null,
  ): Promise<RemoteCollectionSync<RemoteIdentity, RemoteIdentityId>> {
    void accountId
    void previousState
    if (this.shouldFailIdentities)
      throw new Error('Identity sync network failure')
    return validateRemoteCollectionSync(
      {
        mode: 'replace',
        state: this.identitiesState,
        snapshot: this.identities,
      },
      (i) => i.id,
    )
  }

  async syncMailboxes(
    accountId: RemoteAccountId,
    previousState: RemoteSyncState | null,
  ): Promise<RemoteCollectionSync<RemoteMailbox, RemoteMailboxId>> {
    void accountId
    void previousState
    if (this.shouldFailMailboxes)
      throw new Error('Mailbox sync network failure')
    return validateRemoteCollectionSync(
      {
        mode: 'replace',
        state: this.mailboxesState,
        snapshot: this.mailboxes,
      },
      (m) => m.id,
    )
  }

  async syncEmails(
    accountId: RemoteAccountId,
    previousState: RemoteSyncState | null,
  ): Promise<RemoteCollectionSync<RemoteEmail, RemoteEmailId>> {
    void accountId
    void previousState
    if (this.shouldFailEmails) throw new Error('Email sync network failure')
    return validateRemoteCollectionSync(
      {
        mode: 'replace',
        state: this.emailsState,
        snapshot: this.emails,
      },
      (e) => e.id,
    )
  }

  async queryMailbox(
    accountId: RemoteAccountId,
    mailboxId: RemoteMailboxId,
    filter?: unknown,
    options?: RemoteQueryOptions,
  ): Promise<RemoteMailboxQuery> {
    void accountId
    void filter
    void options
    const matched = this.emails.filter((e) => e.mailboxIds.includes(mailboxId))
    return {
      ids: matched.map((e) => e.id),
      queryState: this.emailsState,
      total: matched.length,
      position: 0,
      canCalculateChanges: true,
    }
  }

  async fetchBody(
    accountId: RemoteAccountId,
    emailId: RemoteEmailId,
  ): Promise<RemoteBody> {
    void accountId
    void emailId
    return { kind: 'plain', text: 'body text', html: null }
  }

  async fetchAttachments(
    accountId: RemoteAccountId,
    emailId: RemoteEmailId,
  ): Promise<readonly RemoteAttachment[]> {
    void accountId
    void emailId
    return []
  }

  async applyKeywordChange(
    accountId: RemoteAccountId,
    emailId: RemoteEmailId,
    change: RemoteKeywordChange,
  ): Promise<void> {
    void accountId
    void emailId
    void change
  }

  async applyMembershipChange(
    accountId: RemoteAccountId,
    emailId: RemoteEmailId,
    change: RemoteMembershipChange,
  ): Promise<void> {
    void accountId
    void emailId
    void change
  }
}

const REMOTE_ACCOUNT_ID = remoteAccountIdFromString('acct|local-server|alice')
const IDENTITY_ID = remoteIdentityIdFromString('sender/alice')
const INBOX_ID = remoteMailboxIdFromString('folder:INBOX')
const SENT_ID = remoteMailboxIdFromString('folder:Sent')
const TRASH_ID = remoteMailboxIdFromString('folder:Trash')

describe('V5 & V7 — Coordinator with Non-JMAP Fake & Fault Injection', () => {
  let engine: MemoryLocalEngine

  afterEach(async () => {
    await engine?.dispose()
  })

  async function setup() {
    engine = createMemoryLocalEngine()
    const account = createTestAccount('Alice')
    unwrapOk(await engine.syncPort.registerAccount(account))
    return { engine, account }
  }

  it('V5-01 / C01 / C04: Bootstrap with non-JMAP IDs (IMAP-style) succeeds end-to-end', async () => {
    const { engine, account } = await setup()
    const fake = new NonJmapFakeRemoteMail()

    fake.identities = [
      {
        id: IDENTITY_ID,
        name: 'Alice Sender',
        email: 'alice@example.com',
        replyTo: null,
        bcc: null,
      },
    ]

    fake.mailboxes = [
      {
        id: INBOX_ID,
        name: 'INBOX',
        parent: null,
        role: 'inbox',
        sortOrder: 1,
        totalEmails: 3,
        unreadEmails: 1,
        rights: {
          mayReadItems: true,
          mayAddItems: true,
          mayRemoveItems: true,
          maySetSeen: true,
          maySetKeywords: true,
          maySubmit: true,
        },
      },
      {
        id: SENT_ID,
        name: 'Sent',
        parent: null,
        role: 'sent',
        sortOrder: 2,
        totalEmails: 0,
        unreadEmails: 0,
        rights: {
          mayReadItems: true,
          mayAddItems: true,
          mayRemoveItems: true,
          maySetSeen: true,
          maySetKeywords: true,
          maySubmit: true,
        },
      },
      {
        id: TRASH_ID,
        name: 'Trash',
        parent: null,
        role: 'trash',
        sortOrder: 3,
        totalEmails: 0,
        unreadEmails: 0,
        rights: {
          mayReadItems: true,
          mayAddItems: true,
          mayRemoveItems: true,
          maySetSeen: true,
          maySetKeywords: true,
          maySubmit: true,
        },
      },
    ]

    fake.emails = [
      {
        id: remoteEmailIdFromString('INBOX|7|1'),
        blobId: remoteBlobIdFromString('blob|1'),
        threadId: remoteThreadIdFromString('thread|1'),
        sender: null,
        from: null,
        replyTo: null,
        to: null,
        cc: null,
        bcc: null,
        subject: 'IMAP Msg 1',
        sentAt: null,
        receivedAt: '2026-01-01T00:00:00Z',
        size: 100,
        preview: 'preview 1',
        hasAttachment: false,
        keywords: new Set(['$seen']),
        mailboxIds: [INBOX_ID],
      },
      {
        id: remoteEmailIdFromString('INBOX|7|2'),
        blobId: remoteBlobIdFromString('blob|2'),
        threadId: remoteThreadIdFromString('thread|2'),
        sender: null,
        from: null,
        replyTo: null,
        to: null,
        cc: null,
        bcc: null,
        subject: 'IMAP Msg 2',
        sentAt: null,
        receivedAt: '2026-01-01T00:01:00Z',
        size: 200,
        preview: 'preview 2',
        hasAttachment: false,
        keywords: new Set(),
        mailboxIds: [INBOX_ID],
      },
      {
        id: remoteEmailIdFromString('INBOX|7|3'),
        blobId: remoteBlobIdFromString('blob|3'),
        threadId: remoteThreadIdFromString('thread|3'),
        sender: null,
        from: null,
        replyTo: null,
        to: null,
        cc: null,
        bcc: null,
        subject: 'IMAP Msg 3',
        sentAt: null,
        receivedAt: '2026-01-01T00:02:00Z',
        size: 300,
        preview: 'preview 3',
        hasAttachment: false,
        keywords: new Set(['$seen']),
        mailboxIds: [INBOX_ID],
      },
    ]

    const coordinator = new Coordinator(
      fake,
      engine.syncPort,
      engine.readRepository,
    )
    await coordinator.syncAccount(account.key, REMOTE_ACCOUNT_ID)

    // Verify ReadRepository has normalized records with original non-JMAP strings
    const idList = unwrapOk(
      await engine.readRepository.listIdentities(account.key),
    )
    expect(idList.kind).toBe('present')
    if (idList.kind === 'present') {
      expect(idList.value).toHaveLength(1)
      expect(idList.value[0].id.jmapId).toBe('sender/alice')
    }

    const mbxList = unwrapOk(
      await engine.readRepository.listMailboxes(account.key),
    )
    expect(mbxList.kind).toBe('present')
    if (mbxList.kind === 'present') {
      expect(mbxList.value).toHaveLength(3)
      const names = mbxList.value.map((m) => m.name)
      expect(names).toContain('INBOX')
      expect(names).toContain('Sent')
      expect(names).toContain('Trash')
    }

    const emailRead = unwrapOk(
      await engine.readRepository.readEmail({
        accountKey: account.key,
        jmapId: 'INBOX|7|1' as never,
      }),
    )
    expect(emailRead.kind).toBe('present')
    if (emailRead.kind === 'present') {
      expect(emailRead.value.subject).toBe('IMAP Msg 1')
    }
  })

  it('V7-01: Identity sync failure halts syncAccount before mailboxes or emails', async () => {
    const { engine, account } = await setup()
    const fake = new NonJmapFakeRemoteMail()
    fake.shouldFailIdentities = true

    const coordinator = new Coordinator(
      fake,
      engine.syncPort,
      engine.readRepository,
    )

    await expect(
      coordinator.syncAccount(account.key, REMOTE_ACCOUNT_ID),
    ).rejects.toThrow('Identity sync network failure')

    // Verify no Mailboxes were written
    const mbxList = unwrapOk(
      await engine.readRepository.listMailboxes(account.key),
    )
    expect(mbxList.kind).toBe('present')
    if (mbxList.kind === 'present') {
      expect(mbxList.value).toHaveLength(0)
    }
  })

  it('V7-03: Email sync failure before commit preserves previous local collection intact', async () => {
    const { engine, account } = await setup()
    const fake = new NonJmapFakeRemoteMail()

    fake.identities = [
      {
        id: IDENTITY_ID,
        name: 'Alice',
        email: 'alice@example.com',
        replyTo: null,
        bcc: null,
      },
    ]
    fake.mailboxes = [
      {
        id: INBOX_ID,
        name: 'INBOX',
        parent: null,
        role: 'inbox',
        sortOrder: 1,
        totalEmails: 1,
        unreadEmails: 0,
        rights: {
          mayReadItems: true,
          mayAddItems: true,
          mayRemoveItems: true,
          maySetSeen: true,
          maySetKeywords: true,
          maySubmit: true,
        },
      },
    ]
    fake.emails = [
      {
        id: remoteEmailIdFromString('INBOX|7|1'),
        blobId: remoteBlobIdFromString('b1'),
        threadId: remoteThreadIdFromString('t1'),
        sender: null,
        from: null,
        replyTo: null,
        to: null,
        cc: null,
        bcc: null,
        subject: 'Initial Email',
        sentAt: null,
        receivedAt: '2026-01-01T00:00:00Z',
        size: 100,
        preview: 'initial',
        hasAttachment: false,
        keywords: new Set(),
        mailboxIds: [INBOX_ID],
      },
    ]

    const coordinator = new Coordinator(
      fake,
      engine.syncPort,
      engine.readRepository,
    )
    await coordinator.syncAccount(account.key, REMOTE_ACCOUNT_ID)

    // Now fail email sync on second run
    fake.shouldFailEmails = true
    await expect(
      coordinator.syncEmails(account.key, REMOTE_ACCOUNT_ID),
    ).rejects.toThrow('Email sync network failure')

    // Previous email still present
    const emailRead = unwrapOk(
      await engine.readRepository.readEmail({
        accountKey: account.key,
        jmapId: 'INBOX|7|1' as never,
      }),
    )
    expect(emailRead.kind).toBe('present')
  })
})
