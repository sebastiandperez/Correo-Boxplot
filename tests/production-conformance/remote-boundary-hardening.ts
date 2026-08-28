import { createTauriLocalEngineAdapters } from '../../src/adapters/tauri'
import { LocalEngineIpcClient } from '../../src/ipc/local-engine-ipc-client'
import { RemoteError } from '../../src/remote/errors'
import { FakeRemoteMail, FakeSubmission } from '../../src/remote/testing'
import { remoteAccountIdFromString } from '../../src/remote/types'
import { Outbox } from '../../src/sync/outbox'
import { createTestFixtures } from '../../src/tests/contracts/fixtures'
import {
  productionLocalEngineHarness,
  restartRuntime,
} from './production-local-engine.harness'

export type PersistentRestartHardeningResult = Readonly<{
  passed: boolean
  sameMutationId: boolean
  lifecycleAfterReopen: string
  secondOutboxResult: string
  submissionCallsAfterReopen: number
  fakeSentEmailCreated: boolean
  secondReopenPreserved: boolean
  error?: string
}>

function requireCondition(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

export async function runPersistentOutboxRestartHardening(): Promise<PersistentRestartHardeningResult> {
  const fixtures = createTestFixtures()
  const runtime = await productionLocalEngineHarness.create()
  try {
    const registered = await runtime.syncPort.registerAccount(fixtures.accountA)
    requireCondition(registered.ok, 'Account registration failed')
    const staged = await runtime.syncPort.stageSendMutation(
      fixtures.sendMutationA,
    )
    requireCondition(staged.ok, 'SendMutation staging failed')

    const firstSubmission = new FakeSubmission(async () => {
      throw new RemoteError('submission outcome is unknown', {
        kind: 'network',
        retry: 'reconcile',
        outcome: 'unknown',
        session: 'keep',
      })
    })
    const firstOutbox = new Outbox(
      new FakeRemoteMail(),
      firstSubmission,
      runtime.syncPort,
      runtime.readRepository,
    )
    const firstResult = await firstOutbox.processSendMutation(
      fixtures.accountA.key,
      remoteAccountIdFromString('remote-account|persistent-restart'),
      fixtures.sendMutationA.mutationId,
    )
    requireCondition(
      firstResult.kind === 'needsReconciliation',
      'Ambiguous submission did not require reconciliation',
    )
    requireCondition(
      firstSubmission.calls.length === 1,
      'First submission call count was not 1',
    )

    const beforeRestart = await runtime.readRepository.readPendingMutation(
      fixtures.accountA.key,
      fixtures.sendMutationA.mutationId,
    )
    requireCondition(
      beforeRestart.ok &&
        beforeRestart.value.kind === 'present' &&
        beforeRestart.value.value.lifecycle.status === 'inFlight',
      'Mutation was not durably inFlight before restart',
    )

    await restartRuntime(runtime.runtimeId)
    const reopened = createTauriLocalEngineAdapters(new LocalEngineIpcClient())
    const afterRestart = await reopened.readRepository.readPendingMutation(
      fixtures.accountA.key,
      fixtures.sendMutationA.mutationId,
    )
    requireCondition(
      afterRestart.ok && afterRestart.value.kind === 'present',
      'Mutation was absent after SQLCipher reopen',
    )
    if (!afterRestart.ok || afterRestart.value.kind !== 'present') {
      throw new Error('Mutation lookup narrowed inconsistently after reopen')
    }
    const sameMutationId =
      afterRestart.value.value.mutationId === fixtures.sendMutationA.mutationId
    const lifecycleAfterReopen = afterRestart.value.value.lifecycle.status
    requireCondition(sameMutationId, 'MutationId changed across restart')
    requireCondition(
      lifecycleAfterReopen === 'inFlight',
      'Mutation lifecycle changed across restart',
    )

    const secondSubmission = new FakeSubmission(async () => ({
      kind: 'accepted',
      remoteEmailId: null,
      receiptId: null,
    }))
    const secondOutbox = new Outbox(
      new FakeRemoteMail(),
      secondSubmission,
      reopened.syncPort,
      reopened.readRepository,
    )
    const secondResult = await secondOutbox.processSendMutation(
      fixtures.accountA.key,
      remoteAccountIdFromString('remote-account|persistent-restart'),
      fixtures.sendMutationA.mutationId,
    )
    const secondOutboxResult =
      secondResult.kind === 'skipped' ? secondResult.reason : secondResult.kind
    requireCondition(
      secondResult.kind === 'skipped' &&
        secondResult.reason === 'alreadyInFlight',
      'Reopened Outbox did not skip the inFlight mutation',
    )
    requireCondition(
      secondSubmission.calls.length === 0,
      'Reopened Outbox attempted a duplicate submission',
    )

    const syntheticEmail = await reopened.readRepository.readEmail(
      fixtures.emailA1.id,
    )
    const fakeSentEmailCreated =
      syntheticEmail.ok && syntheticEmail.value.kind === 'present'
    requireCondition(
      !fakeSentEmailCreated,
      'A synthetic sent Email was fabricated',
    )

    const stillInFlight = await reopened.readRepository.readPendingMutation(
      fixtures.accountA.key,
      fixtures.sendMutationA.mutationId,
    )
    requireCondition(
      stillInFlight.ok &&
        stillInFlight.value.kind === 'present' &&
        stillInFlight.value.value.lifecycle.status === 'inFlight',
      'Skipped mutation did not remain inFlight',
    )

    await restartRuntime(runtime.runtimeId)
    const reopenedAgain = createTauriLocalEngineAdapters(
      new LocalEngineIpcClient(),
    )
    const afterSecondRestart =
      await reopenedAgain.readRepository.readPendingMutation(
        fixtures.accountA.key,
        fixtures.sendMutationA.mutationId,
      )
    const secondReopenPreserved =
      afterSecondRestart.ok &&
      afterSecondRestart.value.kind === 'present' &&
      afterSecondRestart.value.value.lifecycle.status === 'inFlight'
    requireCondition(
      secondReopenPreserved,
      'Second SQLCipher reopen lost inFlight state',
    )

    return {
      passed: true,
      sameMutationId,
      lifecycleAfterReopen,
      secondOutboxResult,
      submissionCallsAfterReopen: secondSubmission.calls.length,
      fakeSentEmailCreated,
      secondReopenPreserved,
    }
  } catch (error: unknown) {
    return {
      passed: false,
      sameMutationId: false,
      lifecycleAfterReopen: 'unknown',
      secondOutboxResult: 'unknown',
      submissionCallsAfterReopen: -1,
      fakeSentEmailCreated: false,
      secondReopenPreserved: false,
      error: error instanceof Error ? error.message : String(error),
    }
  } finally {
    await runtime.dispose()
  }
}
