import { describe, expect, it, vi } from 'vitest'
import type { Event as TauriEvent } from '@tauri-apps/api/event'

import {
  failMutationTerminal,
  scheduleMutationRetry,
  startMutationAttempt,
} from '../../../domain/pending-mutation'
import type { IpcInvoke, IpcListen } from '../../../ipc/local-engine-ipc-client'
import { LocalEngineIpcClient } from '../../../ipc/local-engine-ipc-client'
import { createTestFixtures } from '../../../tests/contracts/fixtures'
import type { IpcLocalChangeBatch } from '../../../ipc/dto'
import {
  decodeAccount,
  decodeAttachmentRef,
  decodeCursor,
  decodeEmail,
  decodeEmailBody,
  decodeIdentity,
  decodeMailbox,
  decodeMailboxView,
  decodePendingMutation,
  encodeAccount,
  encodeAttachmentRef,
  encodeCollectionSyncCommit,
  encodeCursor,
  encodeEmail,
  encodeEmailBody,
  encodeIdentity,
  encodeMailbox,
  encodeMailboxView,
  encodePendingMutation,
} from '../domain-ipc-codecs'
import { TauriLocalChangeSource } from '../tauri-local-change-source'
import { TauriReadRepository } from '../tauri-read-repository'
import { TauriSyncPort } from '../tauri-sync-port'

const fixtures = createTestFixtures()
const unusedListen: IpcListen = async () => () => undefined

function clientReturning(response: object, calls: string[] = []) {
  const invoke: IpcInvoke = async <T>(command: string) => {
    calls.push(command)
    return response as T
  }
  return new LocalEngineIpcClient(invoke, unusedListen)
}

describe('Domain IPC codecs', () => {
  it('round-trips every persisted Domain family without semantic loss', () => {
    expect(decodeAccount(encodeAccount(fixtures.accountA))).toEqual(
      fixtures.accountA,
    )
    expect(decodeMailbox(encodeMailbox(fixtures.inboxA))).toEqual(
      fixtures.inboxA,
    )
    expect(decodeIdentity(encodeIdentity(fixtures.identityA))).toEqual(
      fixtures.identityA,
    )
    expect(decodeEmail(encodeEmail(fixtures.emailA1))).toEqual(fixtures.emailA1)
    expect(decodeEmailBody(encodeEmailBody(fixtures.nullBodyA1))).toEqual(
      fixtures.nullBodyA1,
    )
    expect(decodeEmailBody(encodeEmailBody(fixtures.emptyBodyA1))).toEqual(
      fixtures.emptyBodyA1,
    )
    expect(
      decodeAttachmentRef(encodeAttachmentRef(fixtures.attachmentsA1[0])),
    ).toEqual(fixtures.attachmentsA1[0])
    expect(
      decodeMailboxView(encodeMailboxView(fixtures.partialInboxViewA)),
    ).toEqual(fixtures.partialInboxViewA)
    expect(decodeCursor(encodeCursor(fixtures.emptyStateEmailCursorA))).toEqual(
      fixtures.emptyStateEmailCursorA,
    )
    for (const mutation of [
      fixtures.sendMutationA,
      fixtures.keywordMutationA,
      fixtures.membershipMutationA,
    ]) {
      expect(decodePendingMutation(encodePendingMutation(mutation))).toEqual(
        mutation,
      )
    }
  })

  it('preserves mutation lifecycle snapshots, custom keywords, null, empty arrays and empty strings', () => {
    const inFlight = startMutationAttempt(fixtures.keywordMutationA)
    const retrying = scheduleMutationRetry(
      inFlight,
      fixtures.sendMutationA.createdAt,
    )
    const failed = failMutationTerminal(startMutationAttempt(retrying))
    expect(decodePendingMutation(encodePendingMutation(retrying))).toEqual(
      retrying,
    )
    expect(decodePendingMutation(encodePendingMutation(failed))).toEqual(failed)
    const email = decodeEmail(encodeEmail(fixtures.emailA1))
    expect(email.keywords.has('custom-E1')).toBe(true)
    expect(email.cc).toEqual([])
    expect(decodeEmailBody(encodeEmailBody(fixtures.nullBodyA1))).toMatchObject(
      { text: null, html: null },
    )
    expect(
      decodeCursor(encodeCursor(fixtures.emptyStateEmailCursorA)).state,
    ).toBe('')
  })

  it('encodes all six CollectionSyncCommit variants', () => {
    const emailRecord = {
      email: fixtures.emailA1,
      memberships: fixtures.membershipsA,
    }
    const matching = { kind: 'matches' as const, cursor: fixtures.emailCursorA }
    const commits = [
      {
        kind: 'email',
        mode: 'delta',
        expectedCursor: matching,
        nextCursor: fixtures.emailCursorA,
        changed: [emailRecord],
        destroyed: [],
      },
      {
        kind: 'email',
        mode: 'replace',
        expectedCursor: { kind: 'absent' as const },
        nextCursor: fixtures.emailCursorA,
        snapshot: [emailRecord],
      },
      {
        kind: 'mailbox',
        mode: 'delta',
        expectedCursor: {
          kind: 'matches' as const,
          cursor: fixtures.mailboxCursorA,
        },
        nextCursor: fixtures.mailboxCursorA,
        changed: [fixtures.inboxA],
        destroyed: [],
      },
      {
        kind: 'mailbox',
        mode: 'replace',
        expectedCursor: { kind: 'absent' as const },
        nextCursor: fixtures.mailboxCursorA,
        snapshot: [fixtures.inboxA],
      },
      {
        kind: 'identity',
        mode: 'delta',
        expectedCursor: {
          kind: 'matches' as const,
          cursor: fixtures.identityCursorA,
        },
        nextCursor: fixtures.identityCursorA,
        changed: [fixtures.identityA],
        destroyed: [],
      },
      {
        kind: 'identity',
        mode: 'replace',
        expectedCursor: { kind: 'absent' as const },
        nextCursor: fixtures.identityCursorA,
        snapshot: [fixtures.identityA],
      },
    ] as const
    expect(
      commits
        .map(encodeCollectionSyncCommit)
        .map(({ kind, mode }) => `${kind}:${mode}`),
    ).toEqual([
      'email:delta',
      'email:replace',
      'mailbox:delta',
      'mailbox:replace',
      'identity:delta',
      'identity:replace',
    ])
  })
})

describe('TauriReadRepository', () => {
  it('maps all 15 P-01 methods to their exact IPC client command', async () => {
    const calls: string[] = []
    const repo = new TauriReadRepository(
      clientReturning({ ok: false, error: { kind: 'unavailable' } }, calls),
    )
    await repo.readAccount(fixtures.accountA.key)
    await repo.listAccounts()
    await repo.readMailbox(fixtures.inboxA.id)
    await repo.listMailboxes(fixtures.accountA.key)
    await repo.readIdentity(fixtures.identityA.id)
    await repo.listIdentities(fixtures.accountA.key)
    await repo.readEmail(fixtures.emailA1.id)
    await repo.readEmails([fixtures.emailA1.id, fixtures.emailA1.id])
    await repo.readEmailMemberships(fixtures.emailA1.id)
    await repo.readEmailBody(fixtures.emailA1.id)
    await repo.readAttachmentRefs(fixtures.emailA1.id)
    await repo.readMailboxView(fixtures.inboxViewSpecA)
    await repo.readCollectionSyncCursor(fixtures.accountA.key, 'email')
    await repo.readPendingMutation(
      fixtures.accountA.key,
      fixtures.sendMutationA.mutationId,
    )
    await repo.listPendingMutations(fixtures.accountA.key)
    expect(calls).toEqual([
      'local_read_account',
      'local_list_accounts',
      'local_read_mailbox',
      'local_list_mailboxes',
      'local_read_identity',
      'local_list_identities',
      'local_read_email',
      'local_read_emails',
      'local_read_email_memberships',
      'local_read_email_body',
      'local_read_attachment_refs',
      'local_read_mailbox_view',
      'local_read_collection_sync_cursor',
      'local_read_pending_mutation',
      'local_list_pending_mutations',
    ])
  })

  it('preserves P-01 presence variants and positional bulk reads', async () => {
    const responses: object[] = [
      { ok: true, value: { kind: 'ownerAbsent' } },
      { ok: true, value: { kind: 'absent' } },
      { ok: true, value: { kind: 'notCached' } },
      { ok: true, value: { kind: 'cached', value: [] } },
      {
        ok: true,
        value: {
          kind: 'present',
          value: encodeCursor(fixtures.emptyStateEmailCursorA),
        },
      },
      {
        ok: true,
        value: [
          { kind: 'present', value: encodeEmail(fixtures.emailA1) },
          { kind: 'absent' },
          { kind: 'present', value: encodeEmail(fixtures.emailA1) },
        ],
      },
    ]
    const invoke: IpcInvoke = async <T>() => responses.shift() as T
    const repo = new TauriReadRepository(
      new LocalEngineIpcClient(invoke, unusedListen),
    )
    expect(await repo.readEmailMemberships(fixtures.emailA1.id)).toMatchObject({
      ok: true,
      value: { kind: 'ownerAbsent' },
    })
    expect(await repo.readEmail(fixtures.emailA1.id)).toMatchObject({
      ok: true,
      value: { kind: 'absent' },
    })
    expect(await repo.readEmailBody(fixtures.emailA1.id)).toMatchObject({
      ok: true,
      value: { kind: 'notCached' },
    })
    expect(await repo.readAttachmentRefs(fixtures.emailA1.id)).toEqual({
      ok: true,
      value: { kind: 'cached', value: [] },
    })
    expect(
      await repo.readCollectionSyncCursor(fixtures.accountA.key, 'email'),
    ).toMatchObject({ ok: true, value: { value: { state: '' } } })
    const bulk = await repo.readEmails([
      fixtures.emailA1.id,
      fixtures.emailA2.id,
      fixtures.emailA1.id,
    ])
    expect(bulk.ok && bulk.value.map((value) => value.kind)).toEqual([
      'present',
      'absent',
      'present',
    ])
  })

  it('encodes scoped read request DTOs without deduplicating input', async () => {
    let request: object | undefined
    const invoke: IpcInvoke = async <T>(
      _command: string,
      args?: Readonly<{ request: object }>,
    ) => {
      request = args?.request
      return { ok: false, error: { kind: 'unavailable' } } as T
    }
    const repository = new TauriReadRepository(
      new LocalEngineIpcClient(invoke, unusedListen),
    )
    await repository.readEmails([
      fixtures.emailA1.id,
      fixtures.emailA1.id,
      fixtures.emailA2.id,
    ])
    expect(request).toEqual({
      emailIds: [
        {
          accountKey: fixtures.accountA.key,
          jmapEmailId: fixtures.emailA1.id.jmapId,
        },
        {
          accountKey: fixtures.accountA.key,
          jmapEmailId: fixtures.emailA1.id.jmapId,
        },
        {
          accountKey: fixtures.accountA.key,
          jmapEmailId: fixtures.emailA2.id.jmapId,
        },
      ],
    })
  })

  it('maps corrupt successful data, semantic errors, transport and malformed protocol', async () => {
    const corrupt = new TauriReadRepository(
      clientReturning({
        ok: true,
        value: {
          kind: 'present',
          value: { ...encodeEmail(fixtures.emailA1), receivedAt: '' },
        },
      }),
    )
    expect(await corrupt.readEmail(fixtures.emailA1.id)).toEqual({
      ok: false,
      error: { kind: 'corruptState' },
    })
    const semantic = new TauriReadRepository(
      clientReturning({ ok: false, error: { kind: 'unexpected' } }),
    )
    expect(await semantic.listAccounts()).toEqual({
      ok: false,
      error: { kind: 'unexpected' },
    })
    const rejected: IpcInvoke = async () => {
      throw new Error('offline')
    }
    expect(
      await new TauriReadRepository(
        new LocalEngineIpcClient(rejected, unusedListen),
      ).listAccounts(),
    ).toEqual({ ok: false, error: { kind: 'unavailable' } })
    const malformed: IpcInvoke = async <T>() => ({ nope: true }) as T
    expect(
      await new TauriReadRepository(
        new LocalEngineIpcClient(malformed, unusedListen),
      ).listAccounts(),
    ).toEqual({ ok: false, error: { kind: 'unexpected' } })
  })
})

describe('TauriSyncPort', () => {
  it('maps all ten P-02 methods one-for-one to IPC calls', async () => {
    const calls: string[] = []
    const port = new TauriSyncPort(
      clientReturning({ ok: true, value: null }, calls),
    )
    const commit = {
      kind: 'email',
      mode: 'replace',
      expectedCursor: { kind: 'absent' },
      nextCursor: fixtures.emailCursorA,
      snapshot: [
        { email: fixtures.emailA1, memberships: fixtures.membershipsA },
      ],
    } as const
    await port.registerAccount(fixtures.accountA)
    await port.applyCollectionSync(commit)
    await port.cacheEmailBody(fixtures.nullBodyA1)
    await port.replaceAttachmentRefs(
      fixtures.emailA1.id,
      fixtures.attachmentsA1,
    )
    await port.replaceMailboxView(fixtures.partialInboxViewA)
    await port.stageSendMutation(fixtures.sendMutationA)
    await port.applyOptimisticKeywordMutation(fixtures.keywordMutationA)
    await port.applyOptimisticMailboxMembershipMutation(
      fixtures.membershipMutationA,
    )
    await port.replacePendingMutationIfCurrent(
      fixtures.keywordMutationA,
      startMutationAttempt(fixtures.keywordMutationA),
    )
    await port.removeConfirmedMutation(
      fixtures.accountA.key,
      fixtures.sendMutationA.mutationId,
    )
    expect(calls).toEqual([
      'local_register_account',
      'local_apply_collection_sync',
      'local_cache_email_body',
      'local_replace_attachment_refs',
      'local_replace_mailbox_view',
      'local_stage_send_mutation',
      'local_apply_optimistic_keyword_mutation',
      'local_apply_optimistic_mailbox_membership_mutation',
      'local_replace_pending_mutation_if_current',
      'local_remove_confirmed_mutation',
    ])
  })

  it('maps write success, semantic conflict and transport failure', async () => {
    expect(
      await new TauriSyncPort(
        clientReturning({ ok: true, value: null }),
      ).registerAccount(fixtures.accountA),
    ).toEqual({ ok: true, value: undefined })
    expect(
      await new TauriSyncPort(
        clientReturning({ ok: false, error: { kind: 'conflict' } }),
      ).registerAccount(fixtures.accountA),
    ).toEqual({ ok: false, error: { kind: 'conflict' } })
    const rejected: IpcInvoke = async () => {
      throw new Error('offline')
    }
    expect(
      await new TauriSyncPort(
        new LocalEngineIpcClient(rejected, unusedListen),
      ).registerAccount(fixtures.accountA),
    ).toEqual({ ok: false, error: { kind: 'unavailable' } })
  })

  it('passes the complete CAS snapshots in one request', async () => {
    const next = startMutationAttempt(fixtures.membershipMutationA)
    let request: object | undefined
    const invoke: IpcInvoke = async <T>(
      _command: string,
      args?: Readonly<{ request: object }>,
    ) => {
      request = args?.request
      return { ok: true, value: null } as T
    }
    const port = new TauriSyncPort(
      new LocalEngineIpcClient(invoke, unusedListen),
    )
    await port.replacePendingMutationIfCurrent(
      fixtures.membershipMutationA,
      next,
    )
    expect(request).toEqual({
      expected: encodePendingMutation(fixtures.membershipMutationA),
      next: encodePendingMutation(next),
    })
  })
})

describe('TauriLocalChangeSource', () => {
  it('decodes all ten hints and preserves independent, isolated subscriptions', async () => {
    const handlers: Array<
      (event: { payload: ReturnType<typeof makeBatch> }) => void
    > = []
    const unlisteners = [vi.fn(), vi.fn()]
    const listen: IpcListen = vi.fn(async (_name, handler) => {
      handlers.push(handler)
      return unlisteners[handlers.length - 1]
    })
    const unusedInvoke: IpcInvoke = async () => {
      throw new Error('unused')
    }
    const source = new TauriLocalChangeSource(
      new LocalEngineIpcClient(unusedInvoke, listen),
    )
    const failing = await source.subscribe(() => {
      throw new Error('consumer')
    })
    const receiver = vi.fn()
    const receiving = await source.subscribe(receiver)
    handlers[0]({ payload: makeBatch() })
    handlers[1]({ payload: makeBatch() })
    expect(
      receiver.mock.calls[0][0].hints.map(
        (hint: { kind: string }) => hint.kind,
      ),
    ).toEqual([
      'accounts',
      'mailboxes',
      'identities',
      'emails',
      'emailMemberships',
      'emailBody',
      'attachmentRefs',
      'mailboxView',
      'syncCursor',
      'pendingMutations',
    ])
    if (receiving.ok) {
      receiving.value.unsubscribe()
      receiving.value.unsubscribe()
    }
    handlers[1]({ payload: makeBatch() })
    expect(receiver).toHaveBeenCalledTimes(1)
    expect(unlisteners[1]).toHaveBeenCalledTimes(1)
    expect(failing.ok).toBe(true)
  })

  it('drops malformed events and maps subscribe failures', async () => {
    let handler: ((event: TauriEvent<IpcLocalChangeBatch>) => void) | undefined
    const listen: IpcListen = vi.fn(async (_name, value) => {
      handler = value
      return () => undefined
    })
    const unusedInvoke: IpcInvoke = async () => {
      throw new Error('unused')
    }
    const receiver = vi.fn()
    await new TauriLocalChangeSource(
      new LocalEngineIpcClient(unusedInvoke, listen),
    ).subscribe(receiver)
    handler?.({
      event: 'local-state-changed',
      id: 1,
      payload: { hints: [{ kind: 'mailboxes', accountKey: '' }] },
    })
    expect(receiver).not.toHaveBeenCalled()
    const failedListen: IpcListen = async () => {
      throw new Error('bridge')
    }
    const result = await new TauriLocalChangeSource(
      new LocalEngineIpcClient(unusedInvoke, failedListen),
    ).subscribe(receiver)
    expect(result).toEqual({ ok: false, error: { kind: 'unavailable' } })
  })
})

function makeBatch() {
  const accountKey = fixtures.accountA.key
  return {
    hints: [
      { kind: 'accounts' },
      { kind: 'mailboxes', accountKey },
      { kind: 'identities', accountKey },
      { kind: 'emails', accountKey },
      { kind: 'emailMemberships', accountKey },
      {
        kind: 'emailBody',
        emailId: { accountKey, jmapEmailId: fixtures.emailA1.id.jmapId },
      },
      {
        kind: 'attachmentRefs',
        emailId: { accountKey, jmapEmailId: fixtures.emailA1.id.jmapId },
      },
      {
        kind: 'mailboxView',
        spec: {
          mailboxId: { accountKey, jmapMailboxId: fixtures.inboxA.id.jmapId },
          filter: { kind: 'all' },
          sort: { property: 'receivedAt', direction: 'descending' },
        },
      },
      { kind: 'syncCursor', accountKey, dataType: 'email' },
      { kind: 'pendingMutations', accountKey },
    ],
  } as const
}
