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
import {
  confirmSendMutation,
  mutationInstantFromString,
  scheduleMutationRetry,
  sendConfirmation,
  startMutationAttempt,
} from '../../domain/pending-mutation'
import { jmapEmailIdFromString, scopedEmailId } from '../../domain/ids'
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

  it('an inFlight mutation is never blindly retried', async () => {
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

    expect(outcome).toEqual({ kind: 'skipped', reason: 'alreadyInFlight' })
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

  it('an ambiguous network submit remains inFlight and requires reconciliation', async () => {
    const { engine, account, mutation } = await setup()
    const client = createFakeJmapClient({
      submitEmail: vi.fn(async () => {
        throw new JmapNetworkError('connection reset')
      }),
    })
    const outbox = new Outbox(client, engine.syncPort, engine.readRepository)

    await expect(
      outbox.processSendMutation(account.key, 'jmap-acc', mutation.mutationId),
    ).resolves.toEqual({ kind: 'needsReconciliation' })

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

    await expect(
      outbox.processSendMutation(account.key, 'jmap-acc', mutation.mutationId),
    ).resolves.toEqual({ kind: 'skipped', reason: 'alreadyInFlight' })
    expect(client.submitEmail).toHaveBeenCalledTimes(1)
  })

  it('a known retry-safe method failure transitions to retrying', async () => {
    const { engine, account, mutation } = await setup()
    const client = createFakeJmapClient({
      submitEmail: vi.fn(async () => {
        throw new JmapMethodError('EmailSubmission/set', 'serverUnavailable')
      }),
    })
    const now = mutationInstantFromString('2026-01-01T00:00:00.000Z')
    const outbox = new Outbox(
      client,
      engine.syncPort,
      engine.readRepository,
      () => now,
    )

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
      expect(afterward.value.lifecycle).toEqual({
        status: 'retrying',
        attemptCount: 1,
        nextAttemptAt: now,
      })
    }
  })

  it('skips retrying before nextAttemptAt and retries once due', async () => {
    const { engine, account, mutation } = await setup()
    const pendingRead = unwrapOk(
      await engine.readRepository.readPendingMutation(
        account.key,
        mutation.mutationId,
      ),
    )
    if (pendingRead.kind !== 'present' || pendingRead.value.kind !== 'send') {
      throw new Error('fixture setup broken')
    }
    const inFlight = startMutationAttempt(pendingRead.value)
    const due = mutationInstantFromString('2026-02-01T00:00:00.000Z')
    const retrying = scheduleMutationRetry(inFlight, due)
    unwrapOk(
      await engine.syncPort.replacePendingMutationIfCurrent(
        pendingRead.value,
        inFlight,
      ),
    )
    unwrapOk(
      await engine.syncPort.replacePendingMutationIfCurrent(inFlight, retrying),
    )

    const submitEmail = vi.fn<JmapClient['submitEmail']>(async () => {
      const claimed = unwrapOk(
        await engine.readRepository.readPendingMutation(
          account.key,
          mutation.mutationId,
        ),
      )
      expect(claimed.kind).toBe('present')
      if (claimed.kind === 'present') {
        expect(claimed.value.lifecycle).toEqual({
          status: 'inFlight',
          attemptCount: 2,
        })
      }
      return {
        emailId: 'retried-email',
        submissionId: 'retried-submission',
      }
    })
    const client = createFakeJmapClient({ submitEmail })
    const before = new Outbox(
      client,
      engine.syncPort,
      engine.readRepository,
      () => mutationInstantFromString('2026-01-31T23:59:59.000Z'),
    )
    await expect(
      before.processSendMutation(account.key, 'jmap-acc', mutation.mutationId),
    ).resolves.toEqual({ kind: 'skipped', reason: 'notDue' })
    expect(submitEmail).not.toHaveBeenCalled()

    const dueOutbox = new Outbox(
      client,
      engine.syncPort,
      engine.readRepository,
      () => due,
    )
    await expect(
      dueOutbox.processSendMutation(
        account.key,
        'jmap-acc',
        mutation.mutationId,
      ),
    ).resolves.toEqual({ kind: 'sent' })
    expect(submitEmail).toHaveBeenCalledTimes(1)
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

    await expect(
      outbox.processSendMutation(account.key, 'jmap-acc', mutation.mutationId),
    ).resolves.toEqual({ kind: 'skipped', reason: 'terminal' })
    expect(client.submitEmail).toHaveBeenCalledTimes(1)
  })

  it('a durable confirmed mutation is terminal and never resubmitted', async () => {
    const { engine, account, mutation } = await setup()
    const pendingRead = unwrapOk(
      await engine.readRepository.readPendingMutation(
        account.key,
        mutation.mutationId,
      ),
    )
    if (pendingRead.kind !== 'present' || pendingRead.value.kind !== 'send') {
      throw new Error('fixture setup broken')
    }
    const inFlight = startMutationAttempt(pendingRead.value)
    const confirmed = confirmSendMutation(
      inFlight,
      sendConfirmation(
        scopedEmailId(account.key, jmapEmailIdFromString('confirmed-email')),
      ),
    )
    unwrapOk(
      await engine.syncPort.replacePendingMutationIfCurrent(
        pendingRead.value,
        inFlight,
      ),
    )
    unwrapOk(
      await engine.syncPort.replacePendingMutationIfCurrent(
        inFlight,
        confirmed,
      ),
    )
    const submitEmail = vi.fn()
    const outbox = new Outbox(
      createFakeJmapClient({ submitEmail }),
      engine.syncPort,
      engine.readRepository,
    )

    await expect(
      outbox.processSendMutation(account.key, 'jmap-acc', mutation.mutationId),
    ).resolves.toEqual({ kind: 'skipped', reason: 'terminal' })
    expect(submitEmail).not.toHaveBeenCalled()
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
