import { describe, it, expect, vi, afterEach } from 'vitest'
import { Outbox } from '../outbox'
import { createMemoryLocalEngine } from '../../adapters/memory'
import type { MemoryLocalEngine } from '../../adapters/memory'
import { unwrapOk } from '../../tests/contracts/assertions'
import {
  createTestAccount,
  createTestIdentity,
  createTestSendMutation,
} from '../../tests/contracts/fixtures'
import { startMutationAttempt } from '../../domain/pending-mutation'
import {
  JmapAuthError,
  JmapMethodError,
  JmapNetworkError,
} from '../../jmap/errors'
import type { JmapClient } from '../../jmap/client'
import type { SyncPort } from '../../ports/sync-port'

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

describe('Outbox', () => {
  let engine: MemoryLocalEngine

  afterEach(async () => {
    await engine?.dispose()
  })

  async function setup() {
    engine = createMemoryLocalEngine()
    const account = createTestAccount('A')
    const identity = createTestIdentity(account, 'A')
    unwrapOk(await engine.syncPort.registerAccount(account))
    const mutation = createTestSendMutation(account, identity, 'A1')
    unwrapOk(await engine.syncPort.stageSendMutation(mutation))
    return { engine, account, identity, mutation }
  }

  it('sends successfully: submits the mapped draft, confirms, and removes the mutation', async () => {
    const { engine, account, mutation } = await setup()
    const submitEmail = vi.fn<JmapClient['submitEmail']>(async () => ({
      emailId: 'new-email-1',
      submissionId: 'sub-1',
    }))
    const client = createFakeJmapClient({ submitEmail })
    const outbox = new Outbox(client, engine.syncPort, engine.readRepository)

    const outcome = await outbox.processSendMutation(
      account.key,
      'jmap-acc',
      mutation.mutationId,
    )

    expect(outcome).toEqual({ kind: 'sent' })
    expect(submitEmail).toHaveBeenCalledTimes(1)
    const [jmapAccountId, draft, rawIdentityId] = submitEmail.mock.calls[0]
    expect(jmapAccountId).toBe('jmap-acc')
    expect(draft.subject).toBe(mutation.intent.subject)
    expect(rawIdentityId).toBe(mutation.intent.identityId.jmapId)

    // Proven against real committed state, not a mock assertion.
    const afterward = unwrapOk(
      await engine.readRepository.readPendingMutation(
        account.key,
        mutation.mutationId,
      ),
    )
    expect(afterward.kind).toBe('absent')
  })

  it('a mutationId that was never staged is skipped (notFound), not an error', async () => {
    const engine = createMemoryLocalEngine()
    const account = createTestAccount('B')
    unwrapOk(await engine.syncPort.registerAccount(account))
    const client = createFakeJmapClient()
    const outbox = new Outbox(client, engine.syncPort, engine.readRepository)

    const outcome = await outbox.processSendMutation(
      account.key,
      'jmap-acc',
      'never-staged' as never,
    )

    expect(outcome).toEqual({ kind: 'skipped', reason: 'notFound' })
    await engine.dispose()
  })

  it('a mutation already claimed by a prior run (not pending) is skipped (notPending)', async () => {
    const { engine, account, mutation } = await setup()

    // Drive it to inFlight directly, as if another run already claimed it.
    const staged = unwrapOk(
      await engine.readRepository.readPendingMutation(
        account.key,
        mutation.mutationId,
      ),
    )
    if (staged.kind !== 'present' || staged.value.kind !== 'send') {
      throw new Error('fixture setup broken')
    }
    unwrapOk(
      await engine.syncPort.replacePendingMutationIfCurrent(
        staged.value,
        startMutationAttempt(staged.value),
      ),
    )

    const client = createFakeJmapClient()
    const outbox = new Outbox(client, engine.syncPort, engine.readRepository)

    const outcome = await outbox.processSendMutation(
      account.key,
      'jmap-acc',
      mutation.mutationId,
    )

    expect(outcome).toEqual({ kind: 'skipped', reason: 'notPending' })
  })

  it('loses a real claim race to a concurrent winner: skipped (claimConflict), never calls submitEmail', async () => {
    const { engine, account, mutation } = await setup()

    // Wrap the real engine's SyncPort so the FIRST replacePendingMutationIfCurrent
    // call (Outbox's own claim attempt) is preceded by a genuine competing
    // claim against the SAME underlying engine — a real CAS conflict, not a
    // mocked one.
    let armed = true
    // NOTE: delegates explicitly (not via object-spread) — spreading a
    // MemorySyncPort instance would copy its methods unbound, breaking
    // their internal `this.state` access at call time.
    const racingSyncPort: SyncPort = {
      registerAccount: (a) => engine.syncPort.registerAccount(a),
      applyCollectionSync: (c) => engine.syncPort.applyCollectionSync(c),
      cacheEmailBody: (b) => engine.syncPort.cacheEmailBody(b),
      replaceAttachmentRefs: (id, refs) =>
        engine.syncPort.replaceAttachmentRefs(id, refs),
      replaceMailboxView: (v) => engine.syncPort.replaceMailboxView(v),
      stageSendMutation: (m) => engine.syncPort.stageSendMutation(m),
      applyOptimisticKeywordMutation: (m) =>
        engine.syncPort.applyOptimisticKeywordMutation(m),
      applyOptimisticMailboxMembershipMutation: (m) =>
        engine.syncPort.applyOptimisticMailboxMembershipMutation(m),
      removeConfirmedMutation: (a, id) =>
        engine.syncPort.removeConfirmedMutation(a, id),
      replacePendingMutationIfCurrent: async (expected, next) => {
        if (armed) {
          armed = false
          await engine.syncPort.replacePendingMutationIfCurrent(
            expected,
            startMutationAttempt(expected),
          )
        }
        return engine.syncPort.replacePendingMutationIfCurrent(expected, next)
      },
    }

    const submitEmail = vi.fn()
    const client = createFakeJmapClient({ submitEmail })
    const outbox = new Outbox(client, racingSyncPort, engine.readRepository)

    const outcome = await outbox.processSendMutation(
      account.key,
      'jmap-acc',
      mutation.mutationId,
    )

    expect(outcome).toEqual({ kind: 'skipped', reason: 'claimConflict' })
    expect(submitEmail).not.toHaveBeenCalled()

    // The concurrent winner's claim is the one actually committed.
    const afterward = unwrapOk(
      await engine.readRepository.readPendingMutation(
        account.key,
        mutation.mutationId,
      ),
    )
    expect(afterward.kind).toBe('present')
    if (afterward.kind === 'present') {
      expect(afterward.value.lifecycle.status).toBe('inFlight')
    }
  })

  it('a retryable submit failure (JmapNetworkError) transitions the mutation to retrying and rethrows', async () => {
    const { engine, account, mutation } = await setup()
    const client = createFakeJmapClient({
      submitEmail: vi.fn(async () => {
        throw new JmapNetworkError('connection reset')
      }),
    })
    const outbox = new Outbox(client, engine.syncPort, engine.readRepository)

    await expect(
      outbox.processSendMutation(account.key, 'jmap-acc', mutation.mutationId),
    ).rejects.toThrow(JmapNetworkError)

    const afterward = unwrapOk(
      await engine.readRepository.readPendingMutation(
        account.key,
        mutation.mutationId,
      ),
    )
    expect(afterward.kind).toBe('present')
    if (afterward.kind === 'present') {
      expect(afterward.value.lifecycle.status).toBe('retrying')
    }
  })

  it('a terminal submit failure (JmapMethodError notFound) transitions the mutation to failedTerminal and rethrows', async () => {
    const { engine, account, mutation } = await setup()
    const client = createFakeJmapClient({
      submitEmail: vi.fn(async () => {
        throw new JmapMethodError('EmailSubmission/set', 'notFound', 'bad')
      }),
    })
    const outbox = new Outbox(client, engine.syncPort, engine.readRepository)

    await expect(
      outbox.processSendMutation(account.key, 'jmap-acc', mutation.mutationId),
    ).rejects.toThrow(JmapMethodError)

    const afterward = unwrapOk(
      await engine.readRepository.readPendingMutation(
        account.key,
        mutation.mutationId,
      ),
    )
    expect(afterward.kind).toBe('present')
    if (afterward.kind === 'present') {
      expect(afterward.value.lifecycle.status).toBe('failedTerminal')
    }
  })

  it('a terminal auth failure (JmapAuthError) also transitions to failedTerminal, not retrying', async () => {
    const { engine, account, mutation } = await setup()
    const client = createFakeJmapClient({
      submitEmail: vi.fn(async () => {
        throw new JmapAuthError()
      }),
    })
    const outbox = new Outbox(client, engine.syncPort, engine.readRepository)

    await expect(
      outbox.processSendMutation(account.key, 'jmap-acc', mutation.mutationId),
    ).rejects.toThrow(JmapAuthError)

    const afterward = unwrapOk(
      await engine.readRepository.readPendingMutation(
        account.key,
        mutation.mutationId,
      ),
    )
    expect(afterward.kind).toBe('present')
    if (afterward.kind === 'present') {
      expect(afterward.value.lifecycle.status).toBe('failedTerminal')
    }
  })
})
