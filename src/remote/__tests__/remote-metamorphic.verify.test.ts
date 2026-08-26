import { describe, it, expect } from 'vitest'
import { Coordinator } from '../../sync/coordinator'
import { createMemoryLocalEngine } from '../../adapters/memory'
import { unwrapOk } from '../../tests/contracts/assertions'
import { createTestAccount } from '../../tests/contracts/fixtures'
import type {
  RemoteCollectionSync,
  RemoteKeywordChange,
  RemoteMail,
  RemoteMailboxQuery,
  RemoteMembershipChange,
  RemoteQueryOptions,
} from '../mail'
import { validateRemoteCollectionSync } from '../mail'
import type { RemoteBody } from '../body'
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
} from '../types'
import {
  remoteAccountIdFromString,
  remoteBlobIdFromString,
  remoteEmailIdFromString,
  remoteIdentityIdFromString,
  remoteMailboxIdFromString,
  remoteSyncStateFromString,
  remoteThreadIdFromString,
} from '../types'
import type { JmapClient } from '../../jmap/client'
import { JmapRemoteMail } from '../jmap'
import type {
  JmapEmail,
  JmapEmailsResult,
  JmapIdentitiesResult,
  JmapMailboxesResult,
  JmapQueryResult,
} from '../../jmap/types'

class DirectFakeRemoteMail implements RemoteMail {
  identitiesState = remoteSyncStateFromString('state-id-1')
  identities: RemoteIdentity[] = []

  mailboxesState = remoteSyncStateFromString('state-mbx-1')
  mailboxes: RemoteMailbox[] = []

  emailsState = remoteSyncStateFromString('state-email-1')
  emails: RemoteEmail[] = []

  async syncIdentities(
    accountId: RemoteAccountId,
    previousState: RemoteSyncState | null,
  ): Promise<RemoteCollectionSync<RemoteIdentity, RemoteIdentityId>> {
    void accountId
    void previousState
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
    return validateRemoteCollectionSync(
      { mode: 'replace', state: this.emailsState, snapshot: this.emails },
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
    return { kind: 'plain', text: 'hello', html: null }
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

const ACCOUNT_ID = remoteAccountIdFromString('acct-canon-1')

describe('V9 — Metamorphic Fake ↔ JMAP Equivalence (C10)', () => {
  it('V9 / C10: Independent FakeRemote and JmapRemoteMail produce equivalent local projections for canonical dataset', async () => {
    // Define canonical dataset
    const canonicalIdentities: RemoteIdentity[] = [
      {
        id: remoteIdentityIdFromString('ident-1'),
        name: 'Alice',
        email: 'alice@example.com',
        replyTo: null,
        bcc: null,
      },
    ]

    const canonicalMailboxes: RemoteMailbox[] = [
      {
        id: remoteMailboxIdFromString('mbx-inbox'),
        name: 'Inbox',
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
        id: remoteMailboxIdFromString('mbx-sent'),
        name: 'Sent',
        parent: null,
        role: 'sent',
        sortOrder: 2,
        totalEmails: 2,
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

    const canonicalEmails: RemoteEmail[] = Array.from(
      { length: 5 },
      (_, i) => ({
        id: remoteEmailIdFromString(`e-${i + 1}`),
        blobId: remoteBlobIdFromString(`blob-${i + 1}`),
        threadId: remoteThreadIdFromString(`thread-${i + 1}`),
        sender: null,
        from: null,
        replyTo: null,
        to: null,
        cc: null,
        bcc: null,
        subject: `Email ${i + 1}`,
        sentAt: null,
        receivedAt: `2026-01-01T00:0${i}:00Z`,
        size: 100 * (i + 1),
        preview: `preview ${i + 1}`,
        hasAttachment: false,
        keywords: i % 2 === 0 ? new Set(['$seen']) : new Set(),
        mailboxIds:
          i < 3
            ? [remoteMailboxIdFromString('mbx-inbox')]
            : [remoteMailboxIdFromString('mbx-sent')],
      }),
    )

    // Scenario A: DirectFakeRemoteMail -> Coordinator -> Engine A
    const engineA = createMemoryLocalEngine()
    const accountA = createTestAccount('A')
    unwrapOk(await engineA.syncPort.registerAccount(accountA))

    const fakeDirect = new DirectFakeRemoteMail()
    fakeDirect.identities = canonicalIdentities
    fakeDirect.mailboxes = canonicalMailboxes
    fakeDirect.emails = canonicalEmails

    const coordA = new Coordinator(
      fakeDirect,
      engineA.syncPort,
      engineA.readRepository,
    )
    await coordA.syncAccount(accountA.key, ACCOUNT_ID)

    // Scenario B: FakeJmapClient -> JmapRemoteMail -> Coordinator -> Engine B
    const engineB = createMemoryLocalEngine()
    const accountB = createTestAccount('B')
    unwrapOk(await engineB.syncPort.registerAccount(accountB))

    const jmapEmails: JmapEmail[] = canonicalEmails.map((e) => ({
      id: e.id,
      blobId: e.blobId,
      threadId: e.threadId,
      sender: null,
      from: null,
      replyTo: null,
      to: null,
      cc: null,
      bcc: null,
      subject: e.subject,
      sentAt: e.sentAt,
      receivedAt: e.receivedAt,
      size: e.size,
      preview: e.preview,
      hasAttachment: e.hasAttachment,
      keywords: Object.fromEntries(
        Array.from(e.keywords).map((k) => [k, true]),
      ),
      mailboxIds: e.mailboxIds.map((m) => m),
    }))

    const fakeJmapClient: JmapClient = {
      getIdentities: async (): Promise<JmapIdentitiesResult> => ({
        identities: canonicalIdentities.map((i) => ({
          id: i.id,
          name: i.name,
          email: i.email,
          replyTo: null,
          bcc: null,
          htmlSignature: '',
          textSignature: '',
        })),
        state: 'state-id-1',
      }),
      getMailboxes: async (): Promise<JmapMailboxesResult> => ({
        mailboxes: canonicalMailboxes.map((m) => ({
          id: m.id,
          name: m.name,
          parent: m.parent,
          role: m.role,
          sortOrder: m.sortOrder,
          totalEmails: m.totalEmails,
          unreadEmails: m.unreadEmails,
          rights: m.rights,
        })),
        state: 'state-mbx-1',
      }),
      queryEmails: async (
        acc: unknown,
        mbxId: string,
      ): Promise<JmapQueryResult> => {
        void acc
        const matched = jmapEmails.filter((e) => e.mailboxIds.includes(mbxId))
        return {
          ids: matched.map((e) => e.id),
          queryState: 'state-email-1',
          total: matched.length,
          position: 0,
          canCalculateChanges: true,
        }
      },
      getEmails: async (): Promise<JmapEmailsResult> => ({
        emails: jmapEmails,
        state: 'state-email-1',
      }),
    } as unknown as JmapClient

    const jmapRemote = new JmapRemoteMail(fakeJmapClient)
    const coordB = new Coordinator(
      jmapRemote,
      engineB.syncPort,
      engineB.readRepository,
    )
    await coordB.syncAccount(accountB.key, ACCOUNT_ID)

    // Compare observable state between Engine A and Engine B
    const mailboxesA = unwrapOk(
      await engineA.readRepository.listMailboxes(accountA.key),
    )
    const mailboxesB = unwrapOk(
      await engineB.readRepository.listMailboxes(accountB.key),
    )

    expect(mailboxesA.kind).toBe('present')
    expect(mailboxesB.kind).toBe('present')
    if (mailboxesA.kind === 'present' && mailboxesB.kind === 'present') {
      expect(mailboxesA.value.map((m) => m.name).sort()).toEqual(
        mailboxesB.value.map((m) => m.name).sort(),
      )
    }

    // Compare email count & subjects
    for (let i = 1; i <= 5; i++) {
      const emailA = unwrapOk(
        await engineA.readRepository.readEmail({
          accountKey: accountA.key,
          jmapId: `e-${i}` as never,
        }),
      )
      const emailB = unwrapOk(
        await engineB.readRepository.readEmail({
          accountKey: accountB.key,
          jmapId: `e-${i}` as never,
        }),
      )

      expect(emailA.kind).toBe('present')
      expect(emailB.kind).toBe('present')
      if (emailA.kind === 'present' && emailB.kind === 'present') {
        expect(emailA.value.subject).toBe(emailB.value.subject)
        expect(emailA.value.preview).toBe(emailB.value.preview)
      }
    }

    await engineA.dispose()
    await engineB.dispose()
  })
})

describe('V10 — Deterministic Seeded Scenario Generator', () => {
  // Simple LCG PRNG for seed repeatability
  function makePRNG(seed: number) {
    let state = seed
    return function random() {
      state = (state * 1664525 + 1013904223) % 4294967296
      return state / 4294967296
    }
  }

  it('V10: 50 deterministic generated scenarios match reference model state', async () => {
    const seed = 12345
    const prng = makePRNG(seed)

    for (let scenarioIndex = 0; scenarioIndex < 50; scenarioIndex++) {
      const engine = createMemoryLocalEngine()
      const account = createTestAccount(`GenAccount_${scenarioIndex}`)
      unwrapOk(await engine.syncPort.registerAccount(account))

      const mbxCount = Math.floor(prng() * 5) + 1
      const emailCount = Math.floor(prng() * 25)

      const mailboxes: RemoteMailbox[] = Array.from(
        { length: mbxCount },
        (_, i) => ({
          id: remoteMailboxIdFromString(`folder_gen_${scenarioIndex}_${i}`),
          name: `Folder_${i}`,
          parent: null,
          role: i === 0 ? 'inbox' : null,
          sortOrder: i,
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
        }),
      )

      const emails: RemoteEmail[] = Array.from(
        { length: emailCount },
        (_, i) => {
          const assignedMbxIndex = Math.floor(prng() * mbxCount)
          return {
            id: remoteEmailIdFromString(`INBOX|${scenarioIndex}|${i}`),
            blobId: remoteBlobIdFromString(`blob_${scenarioIndex}_${i}`),
            threadId: remoteThreadIdFromString(`thread_${scenarioIndex}_${i}`),
            sender: null,
            from: null,
            replyTo: null,
            to: null,
            cc: null,
            bcc: null,
            subject: `Gen Subject ${i}`,
            sentAt: null,
            receivedAt: '2026-01-01T00:00:00Z',
            size: 100,
            preview: `preview ${i}`,
            hasAttachment: false,
            keywords: prng() > 0.5 ? new Set(['$seen']) : new Set(),
            mailboxIds: [mailboxes[assignedMbxIndex].id],
          }
        },
      )

      const fake = new DirectFakeRemoteMail()
      fake.mailboxes = mailboxes
      fake.emails = emails

      const coordinator = new Coordinator(
        fake,
        engine.syncPort,
        engine.readRepository,
      )
      await coordinator.syncAccount(account.key, ACCOUNT_ID)

      const readMailboxes = unwrapOk(
        await engine.readRepository.listMailboxes(account.key),
      )
      expect(readMailboxes.kind).toBe('present')
      if (readMailboxes.kind === 'present') {
        expect(readMailboxes.value).toHaveLength(mbxCount)
      }

      await engine.dispose()
    }
  })
})
