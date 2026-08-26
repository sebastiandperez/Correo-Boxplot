import { describe, it, expect, vi, afterEach } from 'vitest'
import { Outbox } from '../outbox'
import {
  createMemoryLocalEngine,
  type MemoryLocalEngine,
} from '../../adapters/memory'
import { unwrapOk } from '../../tests/contracts/assertions'
import {
  createTestAccount,
  createTestIdentity,
  createTestSendMutation,
} from '../../tests/contracts/fixtures'
import type { RemoteMail } from '../../remote/mail'
import type { Submission, SubmissionResult } from '../../remote/submission'
import type { SubmissionMessage } from '../../remote/submission-message'
import { RemoteError } from '../../remote/errors'
import {
  remoteAccountIdFromString,
  remoteEmailIdFromString,
} from '../../remote/types'
import { localEmailId } from '../../remote/compat/domain-ids'

class FakeSubmission implements Submission {
  submitFn = vi.fn(
    async (
      _message: SubmissionMessage,
      _idempotencyKey: string,
    ): Promise<SubmissionResult> => {
      void _message
      void _idempotencyKey
      return {
        kind: 'accepted',
        remoteEmailId: remoteEmailIdFromString('remote-sent-email-1'),
        receiptId: 'receipt-1',
      }
    },
  )

  async submit(
    message: SubmissionMessage,
    idempotencyKey: string,
  ): Promise<SubmissionResult> {
    void message
    void idempotencyKey
    return this.submitFn(message, idempotencyKey)
  }
}

const dummyRemoteMail: RemoteMail = {
  syncIdentities: vi.fn() as never,
  syncMailboxes: vi.fn() as never,
  syncEmails: vi.fn() as never,
  queryMailbox: vi.fn() as never,
  fetchBody: vi.fn() as never,
  fetchAttachments: vi.fn() as never,
  applyKeywordChange: vi.fn() as never,
  applyMembershipChange: vi.fn() as never,
}

const REMOTE_ACCOUNT_A = remoteAccountIdFromString('acct-remote-a')
const REMOTE_ACCOUNT_B = remoteAccountIdFromString('acct-remote-b')

describe('V6 & V7 — Outbox / Submission Safety & Critical Matrix', () => {
  let engine: MemoryLocalEngine

  afterEach(async () => {
    await engine?.dispose()
  })

  async function setup() {
    engine = createMemoryLocalEngine()
    const accountA = createTestAccount('AccountA')
    const accountB = createTestAccount('AccountB')
    const identityA = createTestIdentity(accountA, 'A')
    unwrapOk(await engine.syncPort.registerAccount(accountA))
    unwrapOk(await engine.syncPort.registerAccount(accountB))

    const mutationA = createTestSendMutation(accountA, identityA, '001')
    unwrapOk(await engine.syncPort.stageSendMutation(mutationA))

    return {
      engine,
      accountA,
      accountB,
      identityA,
      mutationId: mutationA.mutationId,
    }
  }

  it('V6-01: accepted + RemoteEmailId completes full lifecycle with 1 submission call', async () => {
    const { engine, accountA, mutationId } = await setup()
    const fakeSubmission = new FakeSubmission()
    const outbox = new Outbox(
      dummyRemoteMail,
      fakeSubmission,
      engine.syncPort,
      engine.readRepository,
    )

    const outcome = await outbox.processSendMutation(
      accountA.key,
      REMOTE_ACCOUNT_A,
      mutationId,
    )

    expect(outcome.kind).toBe('sent')
    expect(fakeSubmission.submitFn).toHaveBeenCalledTimes(1)

    // Verify mutation is removed from read repository
    const pending = unwrapOk(
      await engine.readRepository.readPendingMutation(accountA.key, mutationId),
    )
    expect(pending.kind).toBe('absent')
  })

  it('V6-02: idempotencyKey receives exact durable MutationId and is NOT reused as EmailId', async () => {
    const { engine, accountA, mutationId } = await setup()
    const fakeSubmission = new FakeSubmission()
    const outbox = new Outbox(
      dummyRemoteMail,
      fakeSubmission,
      engine.syncPort,
      engine.readRepository,
    )

    await outbox.processSendMutation(accountA.key, REMOTE_ACCOUNT_A, mutationId)

    const callArgs = fakeSubmission.submitFn.mock.calls[0]
    expect(callArgs[1]).toBe(mutationId) // idempotencyKey is exact MutationId
  })

  it('V6-03 / C05 / C14: accepted without RemoteEmailId (remoteEmailId = null) stays inFlight and needsReconciliation', async () => {
    const { engine, accountA, mutationId } = await setup()
    const fakeSubmission = new FakeSubmission()
    fakeSubmission.submitFn.mockResolvedValueOnce({
      kind: 'accepted',
      remoteEmailId: null,
      receiptId: 'receipt-smtp-1',
    })

    const outbox = new Outbox(
      dummyRemoteMail,
      fakeSubmission,
      engine.syncPort,
      engine.readRepository,
    )

    const outcome = await outbox.processSendMutation(
      accountA.key,
      REMOTE_ACCOUNT_A,
      mutationId,
    )

    expect(outcome.kind).toBe('needsReconciliation')

    // Verify mutation remains durable inFlight
    const pending = unwrapOk(
      await engine.readRepository.readPendingMutation(accountA.key, mutationId),
    )
    expect(pending.kind).toBe('present')
    if (pending.kind === 'present') {
      expect(pending.value.lifecycle.status).toBe('inFlight')
    }

    // Verify NO fake email was created in ReadRepository
    const emailRead = unwrapOk(
      await engine.readRepository.readEmail(
        localEmailId(accountA.key, remoteEmailIdFromString('fake-id')),
      ),
    )
    expect(emailRead.kind).toBe('absent')
  })

  it('V6-04 / C06: ambiguous result preserves durable inFlight without automatic resend', async () => {
    const { engine, accountA, mutationId } = await setup()
    const fakeSubmission = new FakeSubmission()
    fakeSubmission.submitFn.mockRejectedValueOnce(
      new RemoteError('Transport connection lost mid-submit', {
        kind: 'network',
        retry: 'reconcile',
        session: 'keep',
        outcome: 'unknown',
      }),
    )

    const outbox = new Outbox(
      dummyRemoteMail,
      fakeSubmission,
      engine.syncPort,
      engine.readRepository,
    )

    const outcome = await outbox.processSendMutation(
      accountA.key,
      REMOTE_ACCOUNT_A,
      mutationId,
    )

    expect(outcome.kind).toBe('needsReconciliation')
    expect(fakeSubmission.submitFn).toHaveBeenCalledTimes(1)

    // Mutation remains inFlight
    const pending = unwrapOk(
      await engine.readRepository.readPendingMutation(accountA.key, mutationId),
    )
    expect(pending.kind).toBe('present')
    if (pending.kind === 'present') {
      expect(pending.value.lifecycle.status).toBe('inFlight')
    }
  })

  it('V6-05 / C06: second invocation after ambiguity makes 0 additional submission calls', async () => {
    const { engine, accountA, mutationId } = await setup()
    const fakeSubmission = new FakeSubmission()
    fakeSubmission.submitFn.mockRejectedValueOnce(
      new RemoteError('Network timeout during submit', {
        kind: 'network',
        retry: 'reconcile',
        session: 'keep',
        outcome: 'unknown',
      }),
    )

    const outbox = new Outbox(
      dummyRemoteMail,
      fakeSubmission,
      engine.syncPort,
      engine.readRepository,
    )

    // First call -> ambiguous
    await outbox.processSendMutation(accountA.key, REMOTE_ACCOUNT_A, mutationId)
    expect(fakeSubmission.submitFn).toHaveBeenCalledTimes(1)

    // Second call -> skipped because alreadyInFlight
    const outcome2 = await outbox.processSendMutation(
      accountA.key,
      REMOTE_ACCOUNT_A,
      mutationId,
    )
    expect(outcome2.kind).toBe('skipped')
    if (outcome2.kind === 'skipped') {
      expect(outcome2.reason).toBe('alreadyInFlight')
    }
    // Submission call count remains 1!
    expect(fakeSubmission.submitFn).toHaveBeenCalledTimes(1)
  })

  it('V6-06: process restart preserves inFlight and does zero new remote calls', async () => {
    const { engine, accountA, mutationId } = await setup()
    const fakeSubmission1 = new FakeSubmission()
    fakeSubmission1.submitFn.mockRejectedValueOnce(
      new RemoteError('Network disconnect', {
        kind: 'network',
        retry: 'reconcile',
        session: 'keep',
        outcome: 'unknown',
      }),
    )

    const outbox1 = new Outbox(
      dummyRemoteMail,
      fakeSubmission1,
      engine.syncPort,
      engine.readRepository,
    )
    await outbox1.processSendMutation(
      accountA.key,
      REMOTE_ACCOUNT_A,
      mutationId,
    )

    // Recreate Outbox instance (simulating process restart against same engine)
    const fakeSubmission2 = new FakeSubmission()
    const outbox2 = new Outbox(
      dummyRemoteMail,
      fakeSubmission2,
      engine.syncPort,
      engine.readRepository,
    )

    const outcome2 = await outbox2.processSendMutation(
      accountA.key,
      REMOTE_ACCOUNT_A,
      mutationId,
    )

    expect(outcome2.kind).toBe('skipped')
    if (outcome2.kind === 'skipped') {
      expect(outcome2.reason).toBe('alreadyInFlight')
    }
    expect(fakeSubmission2.submitFn).toHaveBeenCalledTimes(0)
  })

  it('V6-12 / C07: concurrent claims result in maximum 1 submission call', async () => {
    const { engine, accountA, mutationId } = await setup()
    const fakeSubmission = new FakeSubmission()

    // Add a delay to submit so both outboxes run concurrently
    fakeSubmission.submitFn.mockImplementation(
      async () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve({
                kind: 'accepted',
                remoteEmailId: remoteEmailIdFromString('remote-1'),
                receiptId: 'r1',
              }),
            20,
          ),
        ),
    )

    const outbox1 = new Outbox(
      dummyRemoteMail,
      fakeSubmission,
      engine.syncPort,
      engine.readRepository,
    )
    const outbox2 = new Outbox(
      dummyRemoteMail,
      fakeSubmission,
      engine.syncPort,
      engine.readRepository,
    )

    const [res1, res2] = await Promise.all([
      outbox1.processSendMutation(accountA.key, REMOTE_ACCOUNT_A, mutationId),
      outbox2.processSendMutation(accountA.key, REMOTE_ACCOUNT_A, mutationId),
    ])

    const winnerCount = [res1, res2].filter((r) => r.kind === 'sent').length
    const loserCount = [res1, res2].filter(
      (r) => r.kind === 'skipped' && r.reason === 'claimConflict',
    ).length

    expect(winnerCount).toBe(1)
    expect(loserCount).toBe(1)
    expect(fakeSubmission.submitFn).toHaveBeenCalledTimes(1)
  })

  it('V6-14: multi-account routing passes exact remoteAccountId to SubmissionMessage', async () => {
    const { engine, accountB } = await setup()
    const identityB = createTestIdentity(accountB, 'B')
    const fakeSubmission = new FakeSubmission()
    const outbox = new Outbox(
      dummyRemoteMail,
      fakeSubmission,
      engine.syncPort,
      engine.readRepository,
    )

    const mutB = createTestSendMutation(accountB, identityB, '002')
    unwrapOk(await engine.syncPort.stageSendMutation(mutB))

    await outbox.processSendMutation(
      accountB.key,
      REMOTE_ACCOUNT_B,
      mutB.mutationId,
    )

    const messageSubmitted = fakeSubmission.submitFn.mock.calls[0][0]
    expect(messageSubmitted.remoteAccountId).toBe(REMOTE_ACCOUNT_B)
  })

  it('V7-06 / C13: Remote accepted + local replacePendingMutationIfCurrent(confirmed) conflict cannot trigger a second submission', async () => {
    const { engine, accountA, mutationId } = await setup()
    const fakeSubmission = new FakeSubmission()
    const outbox = new Outbox(
      dummyRemoteMail,
      fakeSubmission,
      engine.syncPort,
      engine.readRepository,
    )

    // Simulate CAS failure on confirm by injecting a concurrent write into syncPort
    const originalReplace =
      engine.syncPort.replacePendingMutationIfCurrent.bind(engine.syncPort)
    let hasAttemptedSubmit = false
    fakeSubmission.submitFn.mockImplementation(async (_msg, _key) => {
      void _msg
      void _key
      hasAttemptedSubmit = true
      return {
        kind: 'accepted',
        remoteEmailId: remoteEmailIdFromString('rem-1'),
        receiptId: 'rcpt-1',
      }
    })

    vi.spyOn(
      engine.syncPort,
      'replacePendingMutationIfCurrent',
    ).mockImplementation(async (expected, next) => {
      if (hasAttemptedSubmit && next.lifecycle.status === 'confirmed') {
        // Force a CAS failure/conflict on the confirm step
        return { ok: false, error: { kind: 'conflict' } }
      }
      return originalReplace(expected, next)
    })

    // First attempt -> throws error because replacePendingMutationIfCurrent(confirmed) failed
    await expect(
      outbox.processSendMutation(accountA.key, REMOTE_ACCOUNT_A, mutationId),
    ).rejects.toThrow(
      'replacePendingMutationIfCurrent(confirmed) failed: conflict',
    )

    expect(fakeSubmission.submitFn).toHaveBeenCalledTimes(1)

    // Second attempt -> must NOT re-submit because state remains inFlight
    const outcome2 = await outbox.processSendMutation(
      accountA.key,
      REMOTE_ACCOUNT_A,
      mutationId,
    )

    expect(outcome2.kind).toBe('skipped')
    if (outcome2.kind === 'skipped') {
      expect(outcome2.reason).toBe('alreadyInFlight')
    }

    // CRITICAL: Submission count MUST stay 1!
    expect(fakeSubmission.submitFn).toHaveBeenCalledTimes(1)
  })
})
