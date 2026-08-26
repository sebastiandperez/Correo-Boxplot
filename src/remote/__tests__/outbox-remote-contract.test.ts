import { afterEach, describe, expect, it } from 'vitest'
import { createMemoryLocalEngine } from '../../adapters/memory'
import type { MemoryLocalEngine } from '../../adapters/memory'
import { mutationInstantFromString } from '../../domain/pending-mutation'
import { Outbox } from '../../sync/outbox'
import { unwrapOk } from '../../tests/contracts/assertions'
import {
  createTestAccount,
  createTestIdentity,
  createTestSendMutation,
} from '../../tests/contracts/fixtures'
import { RemoteError } from '../errors'
import { FakeRemoteMail, FakeSubmission } from '../testing'
import { remoteAccountIdFromString, remoteEmailIdFromString } from '../types'

const REMOTE_ACCOUNT = remoteAccountIdFromString('remote-account')

describe('Outbox protocol-neutral Submission contract', () => {
  let engine: MemoryLocalEngine

  afterEach(async () => engine?.dispose())

  async function setup(
    handler: ConstructorParameters<typeof FakeSubmission>[0],
  ) {
    engine = createMemoryLocalEngine()
    const account = createTestAccount('outbox-remote')
    const identity = createTestIdentity(account, 'outbox-remote')
    const mutation = createTestSendMutation(account, identity, 'outbox-remote')
    unwrapOk(await engine.syncPort.registerAccount(account))
    unwrapOk(await engine.syncPort.stageSendMutation(mutation))
    const submission = new FakeSubmission(handler)
    const outbox = new Outbox(
      new FakeRemoteMail(),
      submission,
      engine.syncPort,
      engine.readRepository,
      () => mutationInstantFromString('2026-01-01T00:00:00Z'),
    )
    return { account, mutation, submission, outbox }
  }

  it('confirms accepted submission with a remote ID and uses MutationId as idempotency key', async () => {
    const { account, mutation, submission, outbox } = await setup(async () => ({
      kind: 'accepted',
      remoteEmailId: remoteEmailIdFromString('accepted'),
      receiptId: 'receipt',
    }))
    await expect(
      outbox.processSendMutation(
        account.key,
        REMOTE_ACCOUNT,
        mutation.mutationId,
      ),
    ).resolves.toEqual({ kind: 'sent' })
    expect(submission.calls).toHaveLength(1)
    expect(submission.calls[0].idempotencyKey).toBe(mutation.mutationId)
    expect(submission.calls[0].message.remoteIdentityId).toBe(
      mutation.intent.identityId.jmapId,
    )
  })

  it('does not fabricate an Email ID when accepted has no remote ID', async () => {
    const { account, mutation, outbox } = await setup(async () => ({
      kind: 'accepted',
      remoteEmailId: null,
      receiptId: 'receipt-only',
    }))
    await expect(
      outbox.processSendMutation(
        account.key,
        REMOTE_ACCOUNT,
        mutation.mutationId,
      ),
    ).resolves.toEqual({ kind: 'needsReconciliation' })
    const stored = unwrapOk(
      await engine.readRepository.readPendingMutation(
        account.key,
        mutation.mutationId,
      ),
    )
    expect(stored.kind).toBe('present')
    if (stored.kind === 'present') {
      expect(stored.value.lifecycle.status).toBe('inFlight')
    }
  })

  it('keeps an ambiguous outcome inFlight and never blindly resubmits it', async () => {
    const { account, mutation, submission, outbox } = await setup(async () => {
      throw new RemoteError('ambiguous', {
        kind: 'network',
        retry: 'reconcile',
        session: 'keep',
        outcome: 'unknown',
      })
    })
    await expect(
      outbox.processSendMutation(
        account.key,
        REMOTE_ACCOUNT,
        mutation.mutationId,
      ),
    ).resolves.toEqual({ kind: 'needsReconciliation' })
    await expect(
      outbox.processSendMutation(
        account.key,
        REMOTE_ACCOUNT,
        mutation.mutationId,
      ),
    ).resolves.toEqual({ kind: 'skipped', reason: 'alreadyInFlight' })
    expect(submission.calls).toHaveLength(1)
  })

  it('schedules retry-safe failure but terminally fails auth/rejection', async () => {
    for (const scenario of [
      {
        error: new RemoteError('retry', {
          kind: 'unavailable',
          retry: 'safeBackoff',
          session: 'keep',
          outcome: 'knownNotApplied',
        }),
        status: 'retrying',
      },
      {
        error: new RemoteError('auth', {
          kind: 'auth',
          retry: 'never',
          session: 'expire',
          outcome: 'knownNotApplied',
        }),
        status: 'failedTerminal',
      },
      {
        error: new RemoteError('rejected', {
          kind: 'rejected',
          retry: 'never',
          session: 'keep',
          outcome: 'knownNotApplied',
        }),
        status: 'failedTerminal',
      },
    ] as const) {
      const { account, mutation, outbox } = await setup(async () => {
        throw scenario.error
      })
      await expect(
        outbox.processSendMutation(
          account.key,
          REMOTE_ACCOUNT,
          mutation.mutationId,
        ),
      ).rejects.toBe(scenario.error)
      const stored = unwrapOk(
        await engine.readRepository.readPendingMutation(
          account.key,
          mutation.mutationId,
        ),
      )
      expect(stored.kind).toBe('present')
      if (stored.kind === 'present') {
        expect(stored.value.lifecycle.status).toBe(scenario.status)
      }
      await engine.dispose()
    }
  })
})
