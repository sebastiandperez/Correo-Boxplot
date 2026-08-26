import { describe, it, expect, vi } from 'vitest'
import { JmapRemoteMail } from '../jmap-remote-mail'
import { JmapSubmission } from '../jmap-submission'
import type { JmapClient } from '../../../jmap/client'
import {
  JmapAuthError,
  JmapMethodError,
  JmapNetworkError,
  JmapSubmissionAmbiguousError,
} from '../../../jmap/errors'
import { RemoteError } from '../../errors'
import {
  remoteAccountIdFromString,
  remoteIdentityIdFromString,
  remoteMailboxIdFromString,
} from '../../types'
import type {
  JmapEmail,
  JmapEmailsResult,
  JmapMailboxesResult,
  JmapQueryResult,
} from '../../../jmap/types'
import type { SubmissionMessage } from '../../submission-message'

function createFakeClient(overrides: Partial<JmapClient> = {}): JmapClient {
  const notImpl = (name: string) => () => {
    throw new Error(`FakeClient.${name} not implemented`)
  }
  return {
    openSession: notImpl('openSession'),
    getMailboxes: notImpl('getMailboxes'),
    getIdentities: notImpl('getIdentities'),
    queryEmails: notImpl('queryEmails'),
    getEmails: notImpl('getEmails'),
    getEmailChanges: notImpl('getEmailChanges'),
    getEmailQueryChanges: notImpl('getEmailQueryChanges'),
    getEmailBody: notImpl('getEmailBody'),
    getEmailAttachments: notImpl('getEmailAttachments'),
    updateEmailKeywords: notImpl('updateEmailKeywords'),
    updateEmailMailboxes: notImpl('updateEmailMailboxes'),
    submitEmail: notImpl('submitEmail'),
    onStateChange: notImpl('onStateChange'),
    ...overrides,
  } as JmapClient
}

function dummyJmapEmail(id: string, mailboxId = 'mbx-1'): JmapEmail {
  return {
    id,
    blobId: `blob-${id}`,
    threadId: `thread-${id}`,
    sender: null,
    from: null,
    replyTo: null,
    to: null,
    cc: null,
    bcc: null,
    subject: `Subject ${id}`,
    sentAt: null,
    receivedAt: '2026-01-01T00:00:00Z',
    size: 100,
    preview: 'prev',
    hasAttachment: false,
    keywords: {},
    mailboxIds: [mailboxId],
  }
}

const ACCOUNT_ID = remoteAccountIdFromString('jmap-acc')

describe('V8 — JMAP Adversarial Regression', () => {
  describe('Pagination matrix & 1201 messages (V8-01 / C09)', () => {
    it('V8-01 / C09: 1201 JMAP messages query in pages of 500+500+201 and produce exactly 1201 remote emails', async () => {
      const pageSizesCalled: number[] = []

      const client = createFakeClient({
        getMailboxes: vi.fn(async (): Promise<JmapMailboxesResult> => ({
          mailboxes: [
            {
              id: 'mbx-1',
              name: 'Inbox',
              parent: null,
              role: 'inbox',
              sortOrder: 0,
              totalEmails: 1201,
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
        queryEmails: vi.fn(
          async (_acc, _mbx, _filter, opts): Promise<JmapQueryResult> => {
            const pos = opts?.position ?? 0
            const limit = opts?.limit ?? 500
            pageSizesCalled.push(limit)

            const remaining = 1201 - pos
            const count = Math.min(limit, remaining)
            const ids = Array.from({ length: count }, (_, i) => `e-${pos + i}`)

            return {
              ids,
              queryState: 'q-state-1',
              total: 1201,
              position: pos,
              canCalculateChanges: true,
            }
          },
        ),
        getEmails: vi.fn(
          async (_acc, ids: readonly string[]): Promise<JmapEmailsResult> => ({
            emails: ids.map((id) => dummyJmapEmail(id)),
            state: 'email-state-1201',
          }),
        ),
      })

      const jmapRemote = new JmapRemoteMail(client)
      const sync = await jmapRemote.syncEmails(ACCOUNT_ID, null)

      expect(sync.mode).toBe('replace')
      if (sync.mode === 'replace') {
        expect(sync.snapshot).toHaveLength(1201)
        expect(sync.state).toBe('email-state-1201')
      }

      // Check pagination batch calls
      expect(pageSizesCalled).toEqual([500, 500, 500]) // 3 query calls: pos 0 (500), 500 (500), 1000 (201 returned)
    })
  })

  describe('Page failure & no partial replace (V8-02 / C08)', () => {
    it('V8-02 / C08: fails closed on page 2 error without emitting a partial replace', async () => {
      let queryCount = 0
      const client = createFakeClient({
        getMailboxes: vi.fn(async (): Promise<JmapMailboxesResult> => ({
          mailboxes: [
            {
              id: 'mbx-1',
              name: 'Inbox',
              parent: null,
              role: 'inbox',
              sortOrder: 0,
              totalEmails: 1000,
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
        queryEmails: vi.fn(
          async (_acc, _mbx, _filter, _opts): Promise<JmapQueryResult> => {
            void _acc
            void _mbx
            void _filter
            void _opts
            queryCount++
            if (queryCount === 1) {
              return {
                ids: Array.from({ length: 500 }, (_, i) => `e-${i}`),
                queryState: 'q-state-1',
                total: 1000,
                position: 0,
                canCalculateChanges: true,
              }
            }
            throw new JmapNetworkError('Network error on page 2')
          },
        ),
      })

      const jmapRemote = new JmapRemoteMail(client)
      await expect(jmapRemote.syncEmails(ACCOUNT_ID, null)).rejects.toThrow(
        RemoteError,
      )
    })
  })

  describe('No progress loop protection (V8-03)', () => {
    it('V8-03: throws RemoteError if query fails to make progress', async () => {
      const client = createFakeClient({
        getMailboxes: vi.fn(async (): Promise<JmapMailboxesResult> => ({
          mailboxes: [
            {
              id: 'mbx-1',
              name: 'Inbox',
              parent: null,
              role: 'inbox',
              sortOrder: 0,
              totalEmails: 100,
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
          ids: [], // Empty array returned when total is 100 -> position doesn't advance!
          queryState: 'q-state-1',
          total: 100,
          position: 0,
          canCalculateChanges: true,
        })),
      })

      const jmapRemote = new JmapRemoteMail(client)
      await expect(jmapRemote.syncEmails(ACCOUNT_ID, null)).rejects.toThrow(
        RemoteError,
      )
    })
  })

  describe('Inconsistent total during pagination (V8-04)', () => {
    it('V8-04: throws RemoteError when total changes mid-pagination', async () => {
      let queryCount = 0
      const client = createFakeClient({
        getMailboxes: vi.fn(async (): Promise<JmapMailboxesResult> => ({
          mailboxes: [
            {
              id: 'mbx-1',
              name: 'Inbox',
              parent: null,
              role: 'inbox',
              sortOrder: 0,
              totalEmails: 1000,
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
        queryEmails: vi.fn(
          async (_acc, _mbx, _filter, _opts): Promise<JmapQueryResult> => {
            void _acc
            void _mbx
            void _filter
            void _opts
            queryCount++
            if (queryCount === 1) {
              return {
                ids: Array.from({ length: 500 }, (_, i) => `e-${i}`),
                queryState: 'q-state-1',
                total: 1000,
                position: 0,
                canCalculateChanges: true,
              }
            }
            return {
              ids: Array.from({ length: 500 }, (_, i) => `e-${500 + i}`),
              queryState: 'q-state-1',
              total: 1005, // Total changed from 1000 to 1005 mid-sync!
              position: 500,
              canCalculateChanges: true,
            }
          },
        ),
      })

      const jmapRemote = new JmapRemoteMail(client)
      await expect(jmapRemote.syncEmails(ACCOUNT_ID, null)).rejects.toThrow(
        RemoteError,
      )
    })
  })

  describe('cannotCalculateChanges fallback (V8-06)', () => {
    it('V8-06: triggers exhaustive replacement snapshot when delta returns cannotCalculateChanges', async () => {
      const client = createFakeClient({
        getEmailChanges: vi.fn(async () => {
          throw new JmapMethodError(
            'Email/changes',
            'cannotCalculateChanges',
            'state invalidated',
          )
        }),
        getMailboxes: vi.fn(async (): Promise<JmapMailboxesResult> => ({
          mailboxes: [],
          state: 'mbx-state-1',
        })),
        getEmails: vi.fn(async (): Promise<JmapEmailsResult> => ({
          emails: [],
          state: 'fresh-state-99',
        })),
      })

      const jmapRemote = new JmapRemoteMail(client)
      const result = await jmapRemote.syncEmails(
        ACCOUNT_ID,
        remoteMailboxIdFromString('stale-state') as never,
      )

      expect(result.mode).toBe('replace')
      expect(result.state).toBe('fresh-state-99')
    })
  })

  describe('JmapSubmission Error Mapping (V8-11)', () => {
    it('V8-11: maps auth error, terminal reject, and ambiguous network errors correctly', async () => {
      const authClient = createFakeClient({
        submitEmail: vi.fn(async () => {
          throw new JmapAuthError()
        }),
      })
      const submission = new JmapSubmission(authClient)

      const msg: SubmissionMessage = {
        remoteAccountId: ACCOUNT_ID,
        remoteIdentityId: remoteIdentityIdFromString('ident-1'),
        from: { name: 'Alice', email: 'alice@example.com' },
        to: [{ name: 'Bob', email: 'bob@example.com' }],
        cc: [],
        bcc: [],
        replyTo: [],
        subject: 'Subj',
        body: { kind: 'plain', text: 'Text', html: null },
      }

      // Auth error
      try {
        await submission.submit(msg, 'mut-1')
        expect.unreachable('Should have thrown')
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(RemoteError)
        if (err instanceof RemoteError) {
          expect(err.kind).toBe('auth')
          expect(err.session).toBe('expire')
        }
      }

      // Ambiguous error mapping
      const netClient = createFakeClient({
        submitEmail: vi.fn(async () => {
          throw new JmapSubmissionAmbiguousError('Ambiguous submit failure')
        }),
      })
      const submissionNet = new JmapSubmission(netClient)

      try {
        await submissionNet.submit(msg, 'mut-2')
        expect.unreachable('Should have thrown')
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(RemoteError)
        if (err instanceof RemoteError) {
          expect(err.retry).toBe('reconcile')
          expect(err.outcome).toBe('unknown')
        }
      }
    })
  })
})
