import { describe, expect, it, vi } from 'vitest'

import { createSeededMemoryApplication } from '../../app/__tests__/application-fixture'
import { emailAddress } from '../../domain/address'
import { mutationIdFromString } from '../../domain/ids'
import {
  mutationInstantFromString,
  scheduleMutationRetry,
  sendMutation,
  startMutationAttempt,
} from '../../domain/pending-mutation'
import { sendIntent } from '../../domain/send-intent'
import type { E2eePort } from '../../e2ee/port'
import { RemoteError } from '../../remote/errors'
import type {
  RemoteKeywordChange,
  RemoteMembershipChange,
} from '../../remote/mail'
import {
  RemoteMutationSourceError,
  type RemoteMutationSource,
  type RemoteSubmissionDraft,
} from '../../remote/mutation-source'
import type { SubmissionResult } from '../../remote/submission'
import type { RemoteEmailId } from '../../remote/types'
import { remoteEmailIdFromString } from '../../remote/types'
import { unwrapOk } from '../../tests/contracts/assertions'
import {
  createTestKeywordMutation,
  createTestMailboxMembershipMutation,
  createTestSendMutation,
} from '../../tests/contracts/fixtures'
import { DefaultMutationRunner } from '../mutation-runner'

class FakeMutationSource implements RemoteMutationSource {
  connected = true
  readonly submissions: Array<{
    accountKey: string
    message: RemoteSubmissionDraft
    idempotencyKey: string
  }> = []
  readonly keywordCalls: Array<{
    emailId: string
    change: RemoteKeywordChange
  }> = []
  readonly membershipCalls: Array<{
    emailId: string
    change: RemoteMembershipChange
  }> = []
  submitResult: SubmissionResult = {
    kind: 'accepted',
    remoteEmailId: remoteEmailIdFromString('sent-1'),
    receiptId: 'receipt-1',
  }
  submitFailure: unknown = null
  keywordFailure: unknown = null
  membershipFailure: unknown = null

  isConnected(): boolean {
    return this.connected
  }

  async submit(
    accountKey: string,
    message: RemoteSubmissionDraft,
    idempotencyKey: string,
  ): Promise<SubmissionResult> {
    this.submissions.push({ accountKey, message, idempotencyKey })
    if (this.submitFailure !== null) throw this.submitFailure
    return this.submitResult
  }

  async applyKeywordChange(
    _accountKey: string,
    emailId: RemoteEmailId,
    change: RemoteKeywordChange,
  ): Promise<void> {
    this.keywordCalls.push({ emailId, change })
    if (this.keywordFailure !== null) throw this.keywordFailure
  }

  async applyMembershipChange(
    _accountKey: string,
    emailId: RemoteEmailId,
    change: RemoteMembershipChange,
  ): Promise<void> {
    this.membershipCalls.push({ emailId, change })
    if (this.membershipFailure !== null) throw this.membershipFailure
  }
}

function e2eePort(
  encryptFor: E2eePort['encryptFor'] = vi.fn().mockResolvedValue({
    ok: true,
    value: {
      version: 1,
      algorithm: 'boxplot-crypto-box-v1',
      sender: 'sender-A@example.test',
      recipient: 'recipient-e2ee@example.test',
      senderPublicKey: 'sender-key',
      recipientPublicKey: 'recipient-key',
      nonce: 'nonce',
      ciphertext: 'ciphertext-only',
    },
  }),
): E2eePort {
  const unavailable = vi.fn().mockResolvedValue({
    ok: false,
    error: { kind: 'unavailable' },
  })
  return {
    encryptFor,
    ensureLocalIdentity: unavailable,
    trustPeerPublicKey: unavailable,
    peerKeyStatus: unavailable,
    decryptFrom: unavailable,
  }
}

const NOW = mutationInstantFromString('2026-08-30T12:00:00.000Z')

describe('DefaultMutationRunner', () => {
  it('claims and confirms a plain send once with its stable mutation ID', async () => {
    const { engine, fixtures } = await createSeededMemoryApplication()
    const mutation = createTestSendMutation(
      fixtures.accountA,
      fixtures.identityA,
      'plain',
    )
    unwrapOk(await engine.syncPort.stageSendMutation(mutation))
    const remote = new FakeMutationSource()
    const crypto = e2eePort()
    const runner = new DefaultMutationRunner({
      readRepository: engine.readRepository,
      syncPort: engine.syncPort,
      remoteMutationSource: remote,
      e2eePort: crypto,
      now: () => NOW,
    })

    expect(
      await runner.runMutation(fixtures.accountA.key, mutation.mutationId),
    ).toEqual({ kind: 'confirmed' })
    expect(remote.submissions).toHaveLength(1)
    expect(remote.submissions[0].idempotencyKey).toBe(mutation.mutationId)
    expect(remote.submissions[0].message.body).toEqual({
      kind: 'plain',
      text: mutation.intent.body.text,
      html: mutation.intent.body.html,
    })
    expect(crypto.encryptFor).not.toHaveBeenCalled()
    expect(
      unwrapOk(
        await engine.readRepository.readPendingMutation(
          fixtures.accountA.key,
          mutation.mutationId,
        ),
      ).kind,
    ).toBe('absent')
  })

  it('encrypts E2EE exactly once and never submits plaintext', async () => {
    const { engine, fixtures } = await createSeededMemoryApplication()
    const canary = 'E2EE_SEND_SECRET_PLAINTEXT_94153'
    const intent = sendIntent({
      securityMode: 'boxplotE2eeV1',
      identity: fixtures.identityA,
      to: [emailAddress(null, 'recipient-e2ee@example.test')],
      cc: [],
      bcc: [],
      subject: 'Encrypted',
      body: { text: canary, html: null },
    })
    const mutation = sendMutation({
      mutationId: mutationIdFromString('e2ee-send'),
      accountKey: fixtures.accountA.key,
      createdAt: NOW,
      intent,
    })
    unwrapOk(await engine.syncPort.stageSendMutation(mutation))
    const remote = new FakeMutationSource()
    const crypto = e2eePort()
    const runner = new DefaultMutationRunner({
      readRepository: engine.readRepository,
      syncPort: engine.syncPort,
      remoteMutationSource: remote,
      e2eePort: crypto,
      now: () => NOW,
    })

    expect(
      await runner.runMutation(fixtures.accountA.key, mutation.mutationId),
    ).toEqual({ kind: 'confirmed' })
    expect(crypto.encryptFor).toHaveBeenCalledTimes(1)
    expect(remote.submissions).toHaveLength(1)
    expect(remote.submissions[0].message.body.kind).toBe('boxplotE2ee')
    expect(JSON.stringify(remote.submissions[0].message)).not.toContain(canary)
  })

  it('terminalizes unsupported E2EE locally and performs no submit or key setup', async () => {
    const { engine, fixtures } = await createSeededMemoryApplication()
    const intent = sendIntent({
      securityMode: 'boxplotE2eeV1',
      identity: fixtures.identityA,
      to: [emailAddress(null, 'one@example.test')],
      cc: [emailAddress(null, 'two@example.test')],
      bcc: [],
      subject: '',
      body: { text: '', html: null },
    })
    const mutation = sendMutation({
      mutationId: mutationIdFromString('bad-e2ee'),
      accountKey: fixtures.accountA.key,
      createdAt: NOW,
      intent,
    })
    unwrapOk(await engine.syncPort.stageSendMutation(mutation))
    const remote = new FakeMutationSource()
    const crypto = e2eePort()
    const runner = new DefaultMutationRunner({
      readRepository: engine.readRepository,
      syncPort: engine.syncPort,
      remoteMutationSource: remote,
      e2eePort: crypto,
      now: () => NOW,
    })

    expect(
      await runner.runMutation(fixtures.accountA.key, mutation.mutationId),
    ).toEqual({ kind: 'failedTerminal' })
    expect(remote.submissions).toHaveLength(0)
    expect(crypto.encryptFor).not.toHaveBeenCalled()
    expect(crypto.ensureLocalIdentity).not.toHaveBeenCalled()
    expect(crypto.trustPeerPublicKey).not.toHaveBeenCalled()
  })

  it.each([
    ['unavailable', 'retrying'],
    ['keyUnavailable', 'failedTerminal'],
    ['peerKeyUnavailable', 'failedTerminal'],
  ] as const)(
    'settles E2EE %s with the documented %s policy and no submit',
    async (errorKind, expectedOutcome) => {
      const { engine, fixtures } = await createSeededMemoryApplication()
      const intent = sendIntent({
        securityMode: 'boxplotE2eeV1',
        identity: fixtures.identityA,
        to: [emailAddress(null, 'recipient-e2ee@example.test')],
        cc: [],
        bcc: [],
        subject: '',
        body: { text: '', html: null },
      })
      const mutation = sendMutation({
        mutationId: mutationIdFromString(`e2ee-${errorKind}`),
        accountKey: fixtures.accountA.key,
        createdAt: NOW,
        intent,
      })
      unwrapOk(await engine.syncPort.stageSendMutation(mutation))
      const remote = new FakeMutationSource()
      const crypto = e2eePort(
        vi.fn().mockResolvedValue({
          ok: false,
          error: { kind: errorKind },
        }),
      )
      const runner = new DefaultMutationRunner({
        readRepository: engine.readRepository,
        syncPort: engine.syncPort,
        remoteMutationSource: remote,
        e2eePort: crypto,
        now: () => NOW,
      })

      expect(
        await runner.runMutation(fixtures.accountA.key, mutation.mutationId),
      ).toEqual({ kind: expectedOutcome })
      expect(remote.submissions).toHaveLength(0)
      expect(crypto.ensureLocalIdentity).not.toHaveBeenCalled()
      expect(crypto.trustPeerPublicKey).not.toHaveBeenCalled()
    },
  )

  it('schedules deterministic retry only for known-not-applied retryable failures', async () => {
    const { engine, fixtures } = await createSeededMemoryApplication()
    const mutation = createTestSendMutation(
      fixtures.accountA,
      fixtures.identityA,
      'retry',
    )
    unwrapOk(await engine.syncPort.stageSendMutation(mutation))
    const remote = new FakeMutationSource()
    remote.submitFailure = new RemoteMutationSourceError({
      kind: 'remote',
      error: new RemoteError('offline', {
        kind: 'network',
        retry: 'safeBackoff',
        session: 'keep',
        outcome: 'knownNotApplied',
      }),
    })
    const runner = new DefaultMutationRunner({
      readRepository: engine.readRepository,
      syncPort: engine.syncPort,
      remoteMutationSource: remote,
      e2eePort: e2eePort(),
      now: () => NOW,
    })

    expect(
      await runner.runMutation(fixtures.accountA.key, mutation.mutationId),
    ).toEqual({ kind: 'retrying' })
    const stored = unwrapOk(
      await engine.readRepository.readPendingMutation(
        fixtures.accountA.key,
        mutation.mutationId,
      ),
    )
    expect(stored.kind === 'present' && stored.value.lifecycle).toEqual({
      status: 'retrying',
      attemptCount: 1,
      nextAttemptAt: '2026-08-30T12:00:05.000Z',
    })
  })

  it('terminalizes known-not-applied non-retryable failures', async () => {
    const { engine, fixtures } = await createSeededMemoryApplication()
    const mutation = createTestSendMutation(
      fixtures.accountA,
      fixtures.identityA,
      'terminal',
    )
    unwrapOk(await engine.syncPort.stageSendMutation(mutation))
    const remote = new FakeMutationSource()
    remote.submitFailure = new RemoteMutationSourceError({
      kind: 'remote',
      error: new RemoteError('rejected', {
        kind: 'rejected',
        retry: 'never',
        session: 'keep',
        outcome: 'knownNotApplied',
      }),
    })
    const runner = new DefaultMutationRunner({
      readRepository: engine.readRepository,
      syncPort: engine.syncPort,
      remoteMutationSource: remote,
      e2eePort: e2eePort(),
      now: () => NOW,
    })
    expect(
      await runner.runMutation(fixtures.accountA.key, mutation.mutationId),
    ).toEqual({ kind: 'failedTerminal' })
    expect(
      await runner.runMutation(fixtures.accountA.key, mutation.mutationId),
    ).toEqual({ kind: 'skipped', reason: 'terminal' })
    expect(remote.submissions).toHaveLength(1)
  })

  it('skips future retry and executes a due retry with one attempt increment', async () => {
    const { engine, fixtures } = await createSeededMemoryApplication()
    const mutation = createTestSendMutation(
      fixtures.accountA,
      fixtures.identityA,
      'due',
    )
    unwrapOk(await engine.syncPort.stageSendMutation(mutation))
    const inFlight = startMutationAttempt(mutation)
    const future = scheduleMutationRetry(
      inFlight,
      mutationInstantFromString('2026-08-30T12:01:00.000Z'),
    )
    unwrapOk(
      await engine.syncPort.replacePendingMutationIfCurrent(mutation, inFlight),
    )
    unwrapOk(
      await engine.syncPort.replacePendingMutationIfCurrent(inFlight, future),
    )
    const remote = new FakeMutationSource()
    const runner = new DefaultMutationRunner({
      readRepository: engine.readRepository,
      syncPort: engine.syncPort,
      remoteMutationSource: remote,
      e2eePort: e2eePort(),
      now: () => NOW,
    })
    expect(
      await runner.runMutation(fixtures.accountA.key, mutation.mutationId),
    ).toEqual({ kind: 'skipped', reason: 'notDue' })
    expect(remote.submissions).toHaveLength(0)

    const due = scheduleMutationRetry(
      startMutationAttempt(future),
      mutationInstantFromString('2026-08-30T11:59:00.000Z'),
    )
    unwrapOk(
      await engine.syncPort.replacePendingMutationIfCurrent(
        future,
        startMutationAttempt(future),
      ),
    )
    const current = unwrapOk(
      await engine.readRepository.readPendingMutation(
        fixtures.accountA.key,
        mutation.mutationId,
      ),
    )
    if (current.kind !== 'present') throw new Error('mutation missing')
    unwrapOk(
      await engine.syncPort.replacePendingMutationIfCurrent(current.value, due),
    )
    expect(
      await runner.runMutation(fixtures.accountA.key, mutation.mutationId),
    ).toEqual({ kind: 'confirmed' })
    expect(remote.submissions).toHaveLength(1)
  })

  it('preserves unknown and accepted-without-ID sends inFlight without replay', async () => {
    for (const mode of ['unknown', 'nullId'] as const) {
      const { engine, fixtures } = await createSeededMemoryApplication()
      const mutation = createTestSendMutation(
        fixtures.accountA,
        fixtures.identityA,
        mode,
      )
      unwrapOk(await engine.syncPort.stageSendMutation(mutation))
      const remote = new FakeMutationSource()
      if (mode === 'unknown') {
        remote.submitFailure = new RemoteMutationSourceError({
          kind: 'remote',
          error: new RemoteError('ambiguous', {
            kind: 'network',
            retry: 'reconcile',
            session: 'expire',
            outcome: 'unknown',
          }),
        })
      } else {
        remote.submitResult = {
          kind: 'accepted',
          remoteEmailId: null,
          receiptId: 'receipt-is-not-an-email-id',
        }
      }
      const runner = new DefaultMutationRunner({
        readRepository: engine.readRepository,
        syncPort: engine.syncPort,
        remoteMutationSource: remote,
        e2eePort: e2eePort(),
        now: () => NOW,
      })
      expect(
        await runner.runMutation(fixtures.accountA.key, mutation.mutationId),
      ).toEqual({ kind: 'needsReconciliation' })
      expect(
        await runner.runMutation(fixtures.accountA.key, mutation.mutationId),
      ).toEqual({ kind: 'needsReconciliation' })
      expect(remote.submissions).toHaveLength(1)
    }
  })

  it('executes keyword and membership changes once and removes confirmed mutations', async () => {
    const { engine, fixtures } = await createSeededMemoryApplication()
    const keyword = createTestKeywordMutation(
      fixtures.accountA,
      fixtures.emailA1,
      'keyword',
    )
    const membership = createTestMailboxMembershipMutation(
      fixtures.accountA,
      fixtures.emailA1,
      'membership',
      [fixtures.archiveA],
      [fixtures.inboxA],
    )
    unwrapOk(await engine.syncPort.applyOptimisticKeywordMutation(keyword))
    unwrapOk(
      await engine.syncPort.applyOptimisticMailboxMembershipMutation(
        membership,
      ),
    )
    const remote = new FakeMutationSource()
    const runner = new DefaultMutationRunner({
      readRepository: engine.readRepository,
      syncPort: engine.syncPort,
      remoteMutationSource: remote,
      e2eePort: e2eePort(),
      now: () => NOW,
    })

    expect(
      await runner.runMutation(fixtures.accountA.key, keyword.mutationId),
    ).toEqual({ kind: 'confirmed' })
    expect(
      await runner.runMutation(fixtures.accountA.key, membership.mutationId),
    ).toEqual({ kind: 'confirmed' })
    expect(remote.keywordCalls).toHaveLength(1)
    expect(remote.membershipCalls).toHaveLength(1)
  })

  it('reconciles keywords by authoritative state but never guesses an ambiguous MOVE', async () => {
    const { engine, fixtures } = await createSeededMemoryApplication()
    const keyword = createTestKeywordMutation(
      fixtures.accountA,
      fixtures.emailA1,
      'reconcile-keyword',
    )
    const membership = createTestMailboxMembershipMutation(
      fixtures.accountA,
      fixtures.emailA1,
      'reconcile-membership',
      [fixtures.archiveA],
      [fixtures.inboxA],
    )
    unwrapOk(await engine.syncPort.applyOptimisticKeywordMutation(keyword))
    unwrapOk(
      await engine.syncPort.applyOptimisticMailboxMembershipMutation(
        membership,
      ),
    )
    unwrapOk(
      await engine.syncPort.replacePendingMutationIfCurrent(
        keyword,
        startMutationAttempt(keyword),
      ),
    )
    unwrapOk(
      await engine.syncPort.replacePendingMutationIfCurrent(
        membership,
        startMutationAttempt(membership),
      ),
    )
    const remote = new FakeMutationSource()
    const refresh = vi.fn().mockResolvedValue(undefined)
    const runner = new DefaultMutationRunner({
      readRepository: engine.readRepository,
      syncPort: engine.syncPort,
      remoteMutationSource: remote,
      e2eePort: e2eePort(),
      refreshAccount: refresh,
      now: () => NOW,
    })

    expect(
      await runner.runMutation(fixtures.accountA.key, keyword.mutationId),
    ).toEqual({ kind: 'confirmed' })
    expect(
      await runner.runMutation(fixtures.accountA.key, membership.mutationId),
    ).toEqual({ kind: 'needsReconciliation' })
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(remote.membershipCalls).toHaveLength(0)
  })

  it('uses CAS as the duplicate-execution barrier for concurrent runners', async () => {
    const { engine, fixtures } = await createSeededMemoryApplication()
    const mutation = createTestSendMutation(
      fixtures.accountA,
      fixtures.identityA,
      'race',
    )
    unwrapOk(await engine.syncPort.stageSendMutation(mutation))
    const remote = new FakeMutationSource()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const originalSubmit = remote.submit.bind(remote)
    remote.submit = async (...args) => {
      await gate
      return originalSubmit(...args)
    }
    const dependencies = {
      readRepository: engine.readRepository,
      syncPort: engine.syncPort,
      remoteMutationSource: remote,
      e2eePort: e2eePort(),
      now: () => NOW,
    }
    const first = new DefaultMutationRunner(dependencies).runMutation(
      fixtures.accountA.key,
      mutation.mutationId,
    )
    const second = new DefaultMutationRunner(dependencies).runMutation(
      fixtures.accountA.key,
      mutation.mutationId,
    )
    await Promise.resolve()
    release()
    const outcomes = await Promise.all([first, second])
    expect(outcomes).toContainEqual({ kind: 'confirmed' })
    expect(
      outcomes.some(
        (value) =>
          value.kind === 'skipped' || value.kind === 'needsReconciliation',
      ),
    ).toBe(true)
    expect(remote.submissions).toHaveLength(1)
  })

  it('does not claim or call remote while disconnected', async () => {
    const { engine, fixtures } = await createSeededMemoryApplication()
    const mutation = createTestSendMutation(
      fixtures.accountA,
      fixtures.identityA,
      'offline',
    )
    unwrapOk(await engine.syncPort.stageSendMutation(mutation))
    const remote = new FakeMutationSource()
    remote.connected = false
    const runner = new DefaultMutationRunner({
      readRepository: engine.readRepository,
      syncPort: engine.syncPort,
      remoteMutationSource: remote,
      e2eePort: e2eePort(),
      now: () => NOW,
    })
    expect(
      await runner.runMutation(fixtures.accountA.key, mutation.mutationId),
    ).toEqual({ kind: 'skipped', reason: 'notConnected' })
    expect(remote.submissions).toHaveLength(0)
    const stored = unwrapOk(
      await engine.readRepository.readPendingMutation(
        fixtures.accountA.key,
        mutation.mutationId,
      ),
    )
    expect(stored.kind === 'present' && stored.value.lifecycle.status).toBe(
      'pending',
    )
  })

  it('reports one committed snapshot without spinning on future retries or terminal entries', async () => {
    const { engine, fixtures } = await createSeededMemoryApplication()
    const send = createTestSendMutation(
      fixtures.accountA,
      fixtures.identityA,
      'summary',
    )
    unwrapOk(await engine.syncPort.stageSendMutation(send))
    const remote = new FakeMutationSource()
    remote.submitResult = {
      kind: 'accepted',
      remoteEmailId: null,
      receiptId: 'ambiguous',
    }
    const runner = new DefaultMutationRunner({
      readRepository: engine.readRepository,
      syncPort: engine.syncPort,
      remoteMutationSource: remote,
      e2eePort: e2eePort(),
      now: () => NOW,
    })
    expect(await runner.runAccount(fixtures.accountA.key)).toEqual({
      attempted: 1,
      confirmed: 0,
      retrying: 0,
      terminal: 0,
      reconciliation: 1,
      skipped: 0,
    })
    expect(remote.submissions).toHaveLength(1)
  })
})
