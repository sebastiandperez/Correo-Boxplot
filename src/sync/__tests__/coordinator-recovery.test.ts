import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryLocalEngine } from '../../adapters/memory'
import type { MemoryLocalEngine } from '../../adapters/memory'
import { jmapEmailIdFromString, scopedEmailId } from '../../domain/ids'
import {
  mailboxViewFilterAll,
  mailboxViewSort,
  mailboxViewSpec,
} from '../../domain/mailbox-view'
import {
  collectionSyncCursor,
  collectionSyncStateFromString,
} from '../../domain/sync-cursor'
import type { JmapClient } from '../../jmap/client'
import type { JmapEmail, JmapMailbox } from '../../jmap/types'
import { unwrapOk } from '../../tests/contracts/assertions'
import { createTestAccount } from '../../tests/contracts/fixtures'
import { Coordinator } from '../coordinator'

const RIGHTS = {
  mayReadItems: true,
  mayAddItems: true,
  mayRemoveItems: true,
  maySetSeen: true,
  maySetKeywords: true,
  maySubmit: true,
}

function rawMailbox(id = 'inbox'): JmapMailbox {
  return {
    id,
    name: id,
    parent: null,
    role: id === 'inbox' ? 'inbox' : null,
    sortOrder: 0,
    totalEmails: 0,
    unreadEmails: 0,
    rights: RIGHTS,
  }
}

function rawEmail(id: string, mailboxIds = ['inbox']): JmapEmail {
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
    subject: id,
    sentAt: null,
    receivedAt: '2026-01-01T00:00:00Z',
    size: 1,
    preview: '',
    hasAttachment: false,
    keywords: {},
    mailboxIds,
  }
}

function fakeClient(overrides: Partial<JmapClient>): JmapClient {
  const unsupported = (name: string) => () => {
    throw new Error(`Unexpected JMAP call: ${name}`)
  }
  return {
    openSession: unsupported('openSession'),
    getIdentities: unsupported('getIdentities'),
    getMailboxes: unsupported('getMailboxes'),
    queryEmails: unsupported('queryEmails'),
    getEmails: unsupported('getEmails'),
    getEmailChanges: unsupported('getEmailChanges'),
    getEmailQueryChanges: unsupported('getEmailQueryChanges'),
    getEmailBody: unsupported('getEmailBody'),
    getEmailAttachments: unsupported('getEmailAttachments'),
    updateEmailKeywords: unsupported('updateEmailKeywords'),
    updateEmailMailboxes: unsupported('updateEmailMailboxes'),
    submitEmail: unsupported('submitEmail'),
    onStateChange: unsupported('onStateChange'),
    ...overrides,
  } as JmapClient
}

describe('Coordinator recovery invariants', () => {
  let engine: MemoryLocalEngine

  afterEach(async () => {
    await engine?.dispose()
  })

  async function setup() {
    engine = createMemoryLocalEngine()
    const account = createTestAccount('recovery')
    unwrapOk(await engine.syncPort.registerAccount(account))
    return account
  }

  async function seedMailbox(account: Awaited<ReturnType<typeof setup>>) {
    const mailboxClient = fakeClient({
      getMailboxes: vi.fn(async () => ({
        mailboxes: [rawMailbox()],
        state: 'mailbox-state',
      })),
    })
    await new Coordinator(
      mailboxClient,
      engine.syncPort,
      engine.readRepository,
    ).syncMailboxes(account.key, 'remote')
  }

  it('synchronizes identities through an authoritative replace cursor', async () => {
    const account = await setup()
    const client = fakeClient({
      getIdentities: vi.fn(async () => ({
        identities: [
          {
            id: 'identity-1',
            name: 'Alice',
            email: 'alice@example.test',
            replyTo: null,
            bcc: null,
            textSignature: '',
            htmlSignature: '',
          },
        ],
        state: 'identity-state-real',
      })),
    })

    await new Coordinator(
      client,
      engine.syncPort,
      engine.readRepository,
    ).syncIdentities(account.key, 'remote')

    const identities = unwrapOk(
      await engine.readRepository.listIdentities(account.key),
    )
    expect(identities.kind).toBe('present')
    if (identities.kind === 'present') expect(identities.value).toHaveLength(1)
    const cursor = unwrapOk(
      await engine.readRepository.readCollectionSyncCursor(
        account.key,
        'identity',
      ),
    )
    expect(cursor).toEqual({
      kind: 'present',
      value: expect.objectContaining({ state: 'identity-state-real' }),
    })
  })

  it('uses Email/get even for an empty collection to obtain the real state', async () => {
    const account = await setup()
    await seedMailbox(account)
    const getEmails = vi.fn(async (_account: string, ids: string[]) => ({
      emails: [],
      state: 'authoritative-empty-state',
      requested: ids,
    }))
    const client = fakeClient({
      getMailboxes: vi.fn(async () => ({
        mailboxes: [rawMailbox()],
        state: 'mailbox-state',
      })),
      queryEmails: vi.fn(async () => ({
        ids: [],
        queryState: 'query-state',
        total: 0,
        position: 0,
        canCalculateChanges: true,
      })),
      getEmails,
    })

    await new Coordinator(
      client,
      engine.syncPort,
      engine.readRepository,
    ).syncEmails(account.key, 'remote')

    expect(getEmails).toHaveBeenCalledWith('remote', [])
    const cursor = unwrapOk(
      await engine.readRepository.readCollectionSyncCursor(
        account.key,
        'email',
      ),
    )
    expect(cursor).toEqual({
      kind: 'present',
      value: expect.objectContaining({ state: 'authoritative-empty-state' }),
    })
  })

  it.each([499, 500, 501, 1201])(
    'paginates and fetches the complete %i-message snapshot',
    async (count) => {
      const account = await setup()
      await seedMailbox(account)
      const ids = Array.from({ length: count }, (_, index) => `email-${index}`)
      const queryEmails = vi.fn(
        async (
          _account: string,
          _mailbox: string,
          _filter?: unknown,
          options?: { position?: number; limit?: number },
        ) => {
          const position = options?.position ?? 0
          const page = ids.slice(position, position + (options?.limit ?? 500))
          return {
            ids: page,
            queryState: 'stable-query-state',
            total: ids.length,
            position,
            canCalculateChanges: true,
          }
        },
      )
      const getEmails = vi.fn(async (_account: string, batch: string[]) => ({
        emails: batch.map((id) => rawEmail(id)),
        state: 'stable-email-state',
      }))
      const client = fakeClient({
        getMailboxes: vi.fn(async () => ({
          mailboxes: [rawMailbox()],
          state: 'mailbox-state',
        })),
        queryEmails,
        getEmails,
      })

      await new Coordinator(
        client,
        engine.syncPort,
        engine.readRepository,
      ).syncEmails(account.key, 'remote')

      expect(queryEmails).toHaveBeenCalledTimes(Math.ceil(count / 500))
      expect(getEmails.mock.calls.map((call) => call[1].length)).toEqual(
        count === 0
          ? [0]
          : Array.from({ length: Math.ceil(count / 500) }, (_, index) =>
              Math.min(500, count - index * 500),
            ),
      )
      const last = unwrapOk(
        await engine.readRepository.readEmail(
          scopedEmailId(
            account.key,
            jmapEmailIdFromString(`email-${count - 1}`),
          ),
        ),
      )
      expect(last.kind).toBe('present')
    },
  )

  it('fetches an Email present in two mailboxes only once and preserves both memberships', async () => {
    const account = await setup()
    const mailboxes = [rawMailbox('inbox'), rawMailbox('archive')]
    const mailboxCoordinator = new Coordinator(
      fakeClient({
        getMailboxes: vi.fn(async () => ({ mailboxes, state: 'mb-state' })),
      }),
      engine.syncPort,
      engine.readRepository,
    )
    await mailboxCoordinator.syncMailboxes(account.key, 'remote')
    const getEmails = vi.fn(async (_account: string, ids: string[]) => ({
      emails: ids.map((id) => rawEmail(id, ['inbox', 'archive'])),
      state: 'email-state',
    }))
    const coordinator = new Coordinator(
      fakeClient({
        getMailboxes: vi.fn(async () => ({ mailboxes, state: 'mb-state' })),
        queryEmails: vi.fn(async () => ({
          ids: ['shared'],
          queryState: 'query-state',
          total: 1,
          position: 0,
          canCalculateChanges: true,
        })),
        getEmails,
      }),
      engine.syncPort,
      engine.readRepository,
    )

    await coordinator.syncEmails(account.key, 'remote')

    expect(getEmails).toHaveBeenCalledTimes(1)
    expect(getEmails.mock.calls[0][1]).toEqual(['shared'])
    const memberships = unwrapOk(
      await engine.readRepository.readEmailMemberships(
        scopedEmailId(account.key, jmapEmailIdFromString('shared')),
      ),
    )
    expect(memberships.kind).toBe('present')
    if (memberships.kind === 'present')
      expect(memberships.value).toHaveLength(2)
  })

  it.each([
    {
      name: 'non-progressing page',
      page: { ids: [], queryState: 'q', total: 501, position: 500 },
    },
    {
      name: 'malformed position',
      page: { ids: ['e500'], queryState: 'q', total: 501, position: 499 },
    },
  ])(
    'fails closed for a $name without committing replace',
    async ({ page }) => {
      const account = await setup()
      await seedMailbox(account)
      let call = 0
      const client = fakeClient({
        getMailboxes: vi.fn(async () => ({
          mailboxes: [rawMailbox()],
          state: 'mailbox-state',
        })),
        queryEmails: vi.fn(async () => {
          call += 1
          return call === 1
            ? {
                ids: Array.from({ length: 500 }, (_, index) => `e${index}`),
                queryState: 'q',
                total: 501,
                position: 0,
                canCalculateChanges: true,
              }
            : { ...page, canCalculateChanges: true }
        }),
        getEmails: vi.fn(),
      })
      const coordinator = new Coordinator(
        client,
        engine.syncPort,
        engine.readRepository,
      )

      await expect(
        coordinator.syncEmails(account.key, 'remote'),
      ).rejects.toThrow()
      const cursor = unwrapOk(
        await engine.readRepository.readCollectionSyncCursor(
          account.key,
          'email',
        ),
      )
      expect(cursor.kind).toBe('absent')
      expect(client.getEmails).not.toHaveBeenCalled()
    },
  )

  it('passes view pagination as QueryOptions and preserves partial coverage', async () => {
    const account = await setup()
    await seedMailbox(account)
    const queryEmails = vi.fn(async () => ({
      ids: ['email-0'],
      queryState: 'view-state',
      total: 1201,
      position: 0,
      canCalculateChanges: true,
    }))
    const coordinator = new Coordinator(
      fakeClient({ queryEmails }),
      engine.syncPort,
      engine.readRepository,
    )
    const mailboxId = unwrapOk(
      await engine.readRepository.listMailboxes(account.key),
    )
    if (mailboxId.kind !== 'present') throw new Error('missing mailbox')
    const spec = mailboxViewSpec(
      mailboxId.value[0].id,
      mailboxViewFilterAll(),
      mailboxViewSort('descending'),
    )

    await coordinator.syncQueryView(account.key, 'remote', spec)

    expect(queryEmails).toHaveBeenCalledWith('remote', 'inbox', undefined, {
      limit: 500,
    })
    const view = unwrapOk(await engine.readRepository.readMailboxView(spec))
    expect(view.kind).toBe('cached')
    if (view.kind === 'cached') {
      expect(view.value.total).toBe(1201)
      expect(view.value.coverage).toEqual([{ start: 0, endExclusive: 1 }])
    }
  })

  it('surfaces a continuation failure when Email/changes exceeds its bound after safely advancing committed pages', async () => {
    const account = await setup()
    unwrapOk(
      await engine.syncPort.applyCollectionSync({
        kind: 'email',
        mode: 'replace',
        expectedCursor: { kind: 'absent' },
        nextCursor: collectionSyncCursor({
          accountKey: account.key,
          dataType: 'email',
          state: collectionSyncStateFromString('state-0'),
        }),
        snapshot: [],
      }),
    )
    let page = 0
    const getEmailChanges = vi.fn(
      async (_account: string, oldState: string) => {
        page += 1
        return {
          accountId: 'remote',
          oldState,
          newState: `state-${page}`,
          hasMoreChanges: true,
          created: [],
          updated: [],
          destroyed: [],
        }
      },
    )
    const coordinator = new Coordinator(
      fakeClient({ getEmailChanges }),
      engine.syncPort,
      engine.readRepository,
    )

    await expect(coordinator.syncEmails(account.key, 'remote')).rejects.toThrow(
      /still has more changes/,
    )
    expect(getEmailChanges).toHaveBeenCalledTimes(20)
    const cursor = unwrapOk(
      await engine.readRepository.readCollectionSyncCursor(
        account.key,
        'email',
      ),
    )
    expect(cursor).toEqual({
      kind: 'present',
      value: expect.objectContaining({ state: 'state-20' }),
    })
  })
})
