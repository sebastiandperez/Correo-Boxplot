import { describe, it, expect, vi, afterEach } from 'vitest'
import { Coordinator } from '../coordinator'
import { createMemoryLocalEngine } from '../../adapters/memory'
import type { MemoryLocalEngine } from '../../adapters/memory'
import { unwrapOk } from '../../tests/contracts/assertions'
import { createTestAccount } from '../../tests/contracts/fixtures'
import { JmapMethodError } from '../../jmap/errors'
import type { JmapClient } from '../../jmap/client'
import type {
  JmapDelta,
  JmapEmail,
  JmapEmailsResult,
  JmapMailboxesResult,
  JmapQueryResult,
} from '../../jmap/types'
import {
  collectionSyncCursor,
  collectionSyncStateFromString,
} from '../../domain/sync-cursor'
import {
  mailboxViewFilterAll,
  mailboxViewSort,
  mailboxViewSpec,
} from '../../domain/mailbox-view'
import { jmapMailboxIdFromString, scopedMailboxId } from '../../domain/ids'

/** Every method throws unless overridden — a call the test doesn't expect fails loudly. */
function createFakeJmapClient(overrides: Partial<JmapClient> = {}): JmapClient {
  const notImplemented = (name: string) => () => {
    throw new Error(`FakeJmapClient.${name} not implemented in this test`)
  }
  return {
    openSession: notImplemented('openSession'),
    getMailboxes: notImplemented('getMailboxes'),
    getIdentities: notImplemented('getIdentities'),
    queryEmails: notImplemented('queryEmails'),
    getEmails: notImplemented('getEmails'),
    getEmailChanges: notImplemented('getEmailChanges'),
    getEmailQueryChanges: notImplemented('getEmailQueryChanges'),
    getEmailBody: notImplemented('getEmailBody'),
    getEmailAttachments: notImplemented('getEmailAttachments'),
    updateEmailKeywords: notImplemented('updateEmailKeywords'),
    updateEmailMailboxes: notImplemented('updateEmailMailboxes'),
    submitEmail: notImplemented('submitEmail'),
    onStateChange: notImplemented('onStateChange'),
    ...overrides,
  } as JmapClient
}

function rawEmail(overrides: Partial<JmapEmail> = {}): JmapEmail {
  return {
    id: 'email-1',
    blobId: 'blob-1',
    threadId: 'thread-1',
    sender: null,
    from: null,
    replyTo: null,
    to: null,
    cc: null,
    bcc: null,
    subject: 'Hello',
    sentAt: null,
    receivedAt: '2026-01-01T00:00:00Z',
    size: 100,
    preview: 'preview',
    hasAttachment: false,
    keywords: {},
    mailboxIds: ['mailbox-1'],
    ...overrides,
  }
}

describe('Coordinator', () => {
  let engine: MemoryLocalEngine

  afterEach(async () => {
    await engine?.dispose()
  })

  async function setup() {
    engine = createMemoryLocalEngine()
    const account = createTestAccount('A')
    unwrapOk(await engine.syncPort.registerAccount(account))
    return { engine, account }
  }

  describe('syncMailboxes', () => {
    it('replaces the local Mailbox collection and commits the server state token as the cursor', async () => {
      const { engine, account } = await setup()
      const client = createFakeJmapClient({
        getMailboxes: vi.fn(async (): Promise<JmapMailboxesResult> => ({
          mailboxes: [
            {
              id: 'mailbox-1',
              name: 'Inbox',
              parent: null,
              role: 'inbox',
              sortOrder: 0,
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
          ],
          state: 'mbx-state-1',
        })),
      })
      const coordinator = new Coordinator(
        client,
        engine.syncPort,
        engine.readRepository,
      )

      await coordinator.syncMailboxes(account.key, 'jmap-acc')

      const mailboxes = unwrapOk(
        await engine.readRepository.listMailboxes(account.key),
      )
      expect(mailboxes.kind).toBe('present')
      if (mailboxes.kind === 'present') {
        expect(mailboxes.value).toHaveLength(1)
        expect(mailboxes.value[0].name).toBe('Inbox')
      }

      const cursor = unwrapOk(
        await engine.readRepository.readCollectionSyncCursor(
          account.key,
          'mailbox',
        ),
      )
      expect(cursor).toEqual({
        kind: 'present',
        value: expect.objectContaining({ state: 'mbx-state-1' }),
      })
    })

    it('skips a malformed mailbox (D-02) without failing the whole sync', async () => {
      const { engine, account } = await setup()
      const client = createFakeJmapClient({
        getMailboxes: vi.fn(async (): Promise<JmapMailboxesResult> => ({
          mailboxes: [
            {
              id: 'mailbox-good',
              name: 'Inbox',
              parent: null,
              role: 'inbox',
              sortOrder: 0,
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
            {
              id: 'mailbox-bad',
              name: '', // Domain rejects an empty name
              parent: null,
              role: null,
              sortOrder: 0,
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
          ],
          state: 'mbx-state-2',
        })),
      })
      const coordinator = new Coordinator(
        client,
        engine.syncPort,
        engine.readRepository,
      )
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      await coordinator.syncMailboxes(account.key, 'jmap-acc')

      const mailboxes = unwrapOk(
        await engine.readRepository.listMailboxes(account.key),
      )
      expect(mailboxes.kind).toBe('present')
      if (mailboxes.kind === 'present') {
        expect(mailboxes.value).toHaveLength(1)
        expect(mailboxes.value[0].id.jmapId).toBe('mailbox-good')
      }
      expect(warnSpy).toHaveBeenCalled()
    })
  })

  describe('syncEmails', () => {
    it('with no local cursor, performs a hard reset: queries every mailbox and replaces the Email collection', async () => {
      const { engine, account } = await setup()
      const client = createFakeJmapClient({
        getMailboxes: vi.fn(async (): Promise<JmapMailboxesResult> => ({
          mailboxes: [
            {
              id: 'mailbox-1',
              name: 'Inbox',
              parent: null,
              role: 'inbox',
              sortOrder: 0,
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
          ],
          state: 'mbx-state-1',
        })),
        queryEmails: vi.fn(async (): Promise<JmapQueryResult> => ({
          ids: ['email-1'],
          queryState: 'q1',
          total: 1,
          position: 0,
          canCalculateChanges: true,
        })),
        getEmails: vi.fn(async (): Promise<JmapEmailsResult> => ({
          emails: [rawEmail()],
          state: 'email-state-1',
        })),
      })
      const coordinator = new Coordinator(
        client,
        engine.syncPort,
        engine.readRepository,
      )

      await coordinator.syncEmails(account.key, 'jmap-acc')

      const cursor = unwrapOk(
        await engine.readRepository.readCollectionSyncCursor(
          account.key,
          'email',
        ),
      )
      expect(cursor).toEqual({
        kind: 'present',
        value: expect.objectContaining({ state: 'email-state-1' }),
      })

      const read = unwrapOk(
        await engine.readRepository.readEmail({
          accountKey: account.key,
          jmapId: 'email-1' as never,
        }),
      )
      expect(read.kind).toBe('present')
    })

    it('with a present cursor, applies an incremental delta (changed + destroyed)', async () => {
      const { engine, account } = await setup()

      // Seed: an initial cursor and one already-synced email that a later
      // delta will destroy.
      unwrapOk(
        await engine.syncPort.applyCollectionSync({
          kind: 'email',
          mode: 'replace',
          expectedCursor: { kind: 'absent' },
          nextCursor: collectionSyncCursor({
            accountKey: account.key,
            dataType: 'email',
            state: collectionSyncStateFromString('email-state-0'),
          }),
          snapshot: [],
        }),
      )

      const client = createFakeJmapClient({
        getEmailChanges: vi.fn(async (): Promise<JmapDelta> => ({
          accountId: 'jmap-acc',
          oldState: 'email-state-0',
          newState: 'email-state-1',
          hasMoreChanges: false,
          created: ['email-1'],
          updated: [],
          destroyed: [],
        })),
        getEmails: vi.fn(async (): Promise<JmapEmailsResult> => ({
          emails: [rawEmail()],
          state: 'irrelevant-here',
        })),
      })
      const coordinator = new Coordinator(
        client,
        engine.syncPort,
        engine.readRepository,
      )

      await coordinator.syncEmails(account.key, 'jmap-acc')

      const cursor = unwrapOk(
        await engine.readRepository.readCollectionSyncCursor(
          account.key,
          'email',
        ),
      )
      expect(cursor).toEqual({
        kind: 'present',
        value: expect.objectContaining({ state: 'email-state-1' }),
      })

      const read = unwrapOk(
        await engine.readRepository.readEmail({
          accountKey: account.key,
          jmapId: 'email-1' as never,
        }),
      )
      expect(read.kind).toBe('present')
    })

    it('falls back to a hard reset when the server throws cannotCalculateChanges', async () => {
      const { engine, account } = await setup()

      unwrapOk(
        await engine.syncPort.applyCollectionSync({
          kind: 'email',
          mode: 'replace',
          expectedCursor: { kind: 'absent' },
          nextCursor: collectionSyncCursor({
            accountKey: account.key,
            dataType: 'email',
            state: collectionSyncStateFromString('stale-state'),
          }),
          snapshot: [],
        }),
      )

      const client = createFakeJmapClient({
        getEmailChanges: vi.fn(async () => {
          throw new JmapMethodError(
            'Email/changes',
            'cannotCalculateChanges',
            'state too old',
          )
        }),
        getMailboxes: vi.fn(async (): Promise<JmapMailboxesResult> => ({
          mailboxes: [],
          state: 'mbx-state',
        })),
      })
      const coordinator = new Coordinator(
        client,
        engine.syncPort,
        engine.readRepository,
      )

      await coordinator.syncEmails(account.key, 'jmap-acc')

      // Hard reset with zero mailboxes -> empty replace snapshot, but the
      // cursor must have advanced past the stale state.
      const cursor = unwrapOk(
        await engine.readRepository.readCollectionSyncCursor(
          account.key,
          'email',
        ),
      )
      expect(cursor.kind).toBe('present')
      if (cursor.kind === 'present') {
        expect(cursor.value.state).not.toBe('stale-state')
      }
    })

    it('pages through hasMoreChanges, applying each delta before fetching the next', async () => {
      const { engine, account } = await setup()

      unwrapOk(
        await engine.syncPort.applyCollectionSync({
          kind: 'email',
          mode: 'replace',
          expectedCursor: { kind: 'absent' },
          nextCursor: collectionSyncCursor({
            accountKey: account.key,
            dataType: 'email',
            state: collectionSyncStateFromString('email-state-0'),
          }),
          snapshot: [],
        }),
      )

      let call = 0
      const getEmailChanges = vi.fn(async (): Promise<JmapDelta> => {
        call += 1
        if (call === 1) {
          return {
            accountId: 'jmap-acc',
            oldState: 'email-state-0',
            newState: 'email-state-1',
            hasMoreChanges: true,
            created: ['email-1'],
            updated: [],
            destroyed: [],
          }
        }
        return {
          accountId: 'jmap-acc',
          oldState: 'email-state-1',
          newState: 'email-state-2',
          hasMoreChanges: false,
          created: ['email-2'],
          updated: [],
          destroyed: [],
        }
      })
      const client = createFakeJmapClient({
        getEmailChanges,
        getEmails: vi.fn(
          async (
            _accountId: string,
            ids: string[],
          ): Promise<JmapEmailsResult> => ({
            emails: ids.map((id) => rawEmail({ id })),
            state: 'unused',
          }),
        ),
      })

      const coordinator = new Coordinator(
        client,
        engine.syncPort,
        engine.readRepository,
      )
      await coordinator.syncEmails(account.key, 'jmap-acc')

      expect(getEmailChanges).toHaveBeenCalledTimes(2)
      const cursor = unwrapOk(
        await engine.readRepository.readCollectionSyncCursor(
          account.key,
          'email',
        ),
      )
      expect(cursor).toEqual({
        kind: 'present',
        value: expect.objectContaining({ state: 'email-state-2' }),
      })
    })

    it('recovers from a real CAS conflict by re-reading the cursor and retrying once', async () => {
      const { engine, account } = await setup()

      unwrapOk(
        await engine.syncPort.applyCollectionSync({
          kind: 'email',
          mode: 'replace',
          expectedCursor: { kind: 'absent' },
          nextCursor: collectionSyncCursor({
            accountKey: account.key,
            dataType: 'email',
            state: collectionSyncStateFromString('email-state-0'),
          }),
          snapshot: [],
        }),
      )

      let call = 0
      const getEmailChanges = vi.fn(async (): Promise<JmapDelta> => {
        call += 1
        if (call === 1) {
          // Simulate a concurrent writer advancing the cursor underneath
          // Coordinator, between its cursor read and its eventual commit —
          // a real conflict enforced by the real engine's CAS, not a mock.
          unwrapOk(
            await engine.syncPort.applyCollectionSync({
              kind: 'email',
              mode: 'delta',
              expectedCursor: {
                kind: 'matches',
                cursor: collectionSyncCursor({
                  accountKey: account.key,
                  dataType: 'email',
                  state: collectionSyncStateFromString('email-state-0'),
                }),
              },
              nextCursor: collectionSyncCursor({
                accountKey: account.key,
                dataType: 'email',
                state: collectionSyncStateFromString('email-state-concurrent'),
              }),
              changed: [],
              destroyed: [],
            }),
          )
          return {
            accountId: 'jmap-acc',
            oldState: 'email-state-0',
            newState: 'email-state-1',
            hasMoreChanges: false,
            created: ['email-1'],
            updated: [],
            destroyed: [],
          }
        }
        // Second attempt: Coordinator re-read 'email-state-concurrent' and
        // asked for changes since then.
        expect(call).toBe(2)
        return {
          accountId: 'jmap-acc',
          oldState: 'email-state-concurrent',
          newState: 'email-state-2',
          hasMoreChanges: false,
          created: [],
          updated: [],
          destroyed: [],
        }
      })
      const client = createFakeJmapClient({
        getEmailChanges,
        getEmails: vi.fn(async (_accountId: string, ids: string[]) => ({
          emails: ids.map((id) => rawEmail({ id })),
          state: 'unused',
        })),
      })
      const coordinator = new Coordinator(
        client,
        engine.syncPort,
        engine.readRepository,
      )

      await coordinator.syncEmails(account.key, 'jmap-acc')

      expect(getEmailChanges).toHaveBeenCalledTimes(2)
      const cursor = unwrapOk(
        await engine.readRepository.readCollectionSyncCursor(
          account.key,
          'email',
        ),
      )
      // Final state reflects the retried, successful second attempt.
      expect(cursor).toEqual({
        kind: 'present',
        value: expect.objectContaining({ state: 'email-state-2' }),
      })
    })
  })

  describe('syncQueryView', () => {
    it('replaces the cached MailboxView from a fresh query, once the Mailbox exists locally', async () => {
      const { engine, account } = await setup()
      const mailboxId = scopedMailboxId(
        account.key,
        jmapMailboxIdFromString('mailbox-1'),
      )

      unwrapOk(
        await engine.syncPort.applyCollectionSync({
          kind: 'mailbox',
          mode: 'replace',
          expectedCursor: { kind: 'absent' },
          nextCursor: collectionSyncCursor({
            accountKey: account.key,
            dataType: 'mailbox',
            state: collectionSyncStateFromString('mbx-state-1'),
          }),
          snapshot: [
            {
              id: mailboxId,
              name: 'Inbox',
              parent: null,
              role: 'inbox',
              sortOrder: 0,
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
          ],
        }),
      )

      const client = createFakeJmapClient({
        queryEmails: vi.fn(async (): Promise<JmapQueryResult> => ({
          ids: ['email-1'],
          queryState: 'view-state-1',
          total: 1,
          position: 0,
          canCalculateChanges: true,
        })),
      })
      const coordinator = new Coordinator(
        client,
        engine.syncPort,
        engine.readRepository,
      )
      const spec = mailboxViewSpec(
        mailboxId,
        mailboxViewFilterAll(),
        mailboxViewSort('descending'),
      )

      await coordinator.syncQueryView(account.key, 'jmap-acc', spec)

      const view = unwrapOk(await engine.readRepository.readMailboxView(spec))
      expect(view.kind).toBe('cached')
      if (view.kind === 'cached') {
        expect(view.value.total).toBe(1)
        expect(view.value.items).toHaveLength(1)
      }
    })
  })

  describe('searchEmails', () => {
    it('is a stateless pass-through: never writes to SyncPort', async () => {
      const { engine, account } = await setup()
      const client = createFakeJmapClient({
        queryEmails: vi.fn(async (): Promise<JmapQueryResult> => ({
          ids: ['e1'],
          total: 1,
          position: 0,
          queryState: 'q1',
          canCalculateChanges: true,
        })),
      })
      const coordinator = new Coordinator(
        client,
        engine.syncPort,
        engine.readRepository,
      )

      const result = await coordinator.searchEmails('jmap-acc', 'mailbox-1', {
        text: 'hello',
      })

      expect(client.queryEmails).toHaveBeenCalledWith('jmap-acc', 'mailbox-1', {
        text: 'hello',
      })
      expect(result.ids).toEqual(['e1'])

      const cursor = unwrapOk(
        await engine.readRepository.readCollectionSyncCursor(
          account.key,
          'email',
        ),
      )
      expect(cursor.kind).toBe('absent') // owner (Account) present, but no cursor was ever written
    })
  })
})
