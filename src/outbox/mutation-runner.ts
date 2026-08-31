import type { E2eePort } from '../e2ee/port'
import { encryptSendIntent } from '../e2ee/send-intent'
import type { E2eeErrorKind } from '../e2ee/types'
import type { AccountKey, MutationId } from '../domain/ids'
import {
  confirmEmailUpdateMutation,
  confirmSendMutation,
  failMutationTerminal,
  mutationInstantFromString,
  scheduleMutationRetry,
  sendConfirmation,
  startMutationAttempt,
  type KeywordMutation,
  type MailboxMembershipMutation,
  type MutationInstant,
  type PendingMutation,
  type SendMutation,
} from '../domain/pending-mutation'
import type { ReadRepository } from '../ports/read-repository'
import type { SyncPort } from '../ports/sync-port'
import {
  localEmailId,
  remoteEmailId,
  remoteIdentityId,
  remoteMailboxId,
} from '../remote/compat/domain-ids'
import { serializeBoxplotE2eeEnvelope } from '../remote/mime/boxplot-e2ee'
import {
  RemoteMutationSourceError,
  type AccountScopedRemoteMutationReconciler,
  type RemoteMutationSource,
  type RemoteSubmissionDraft,
} from '../remote/mutation-source'
import { nextRetryInstant } from './retry-policy'
import type {
  MutationExecutionOutcome,
  MutationRunner,
  MutationRunSummary,
} from './types'

export type MutationRunnerDependencies = Readonly<{
  readRepository: ReadRepository
  syncPort: SyncPort
  remoteMutationSource: RemoteMutationSource
  remoteMutationReconciler?: AccountScopedRemoteMutationReconciler
  e2eePort: E2eePort
  refreshAccount?: (accountKey: AccountKey) => Promise<void>
  now?: () => MutationInstant
}>

type PreparedSend =
  | Readonly<{ kind: 'ready'; message: RemoteSubmissionDraft }>
  | Readonly<{ kind: 'e2eeFailure'; error: E2eeErrorKind }>

export class DefaultMutationRunner implements MutationRunner {
  private readonly now: () => MutationInstant

  constructor(private readonly dependencies: MutationRunnerDependencies) {
    this.now = dependencies.now ?? currentMutationInstant
  }

  async runAccount(accountKey: AccountKey): Promise<MutationRunSummary> {
    const result =
      await this.dependencies.readRepository.listPendingMutations(accountKey)
    if (!result.ok)
      throw new Error(`listPendingMutations failed: ${result.error.kind}`)
    if (result.value.kind === 'ownerAbsent') return emptySummary()

    const summary = mutableSummary()
    for (const mutation of result.value.value) {
      const outcome = await this.runMutation(accountKey, mutation.mutationId)
      countOutcome(summary, outcome)
    }
    return summary
  }

  async runMutation(
    accountKey: AccountKey,
    mutationId: MutationId,
  ): Promise<MutationExecutionOutcome> {
    const current = await this.readMutation(accountKey, mutationId)
    if (current === null) return { kind: 'skipped', reason: 'notFound' }

    switch (current.lifecycle.status) {
      case 'confirmed':
        await this.removeConfirmed(current)
        return { kind: 'confirmed' }
      case 'failedTerminal':
        return { kind: 'skipped', reason: 'terminal' }
      case 'inFlight':
        return this.reconcile(current)
      case 'retrying':
        if (current.lifecycle.nextAttemptAt > this.now()) {
          return { kind: 'skipped', reason: 'notDue' }
        }
        break
      case 'pending':
        break
    }

    if (!this.dependencies.remoteMutationSource.isConnected(accountKey)) {
      return { kind: 'skipped', reason: 'notConnected' }
    }

    const prepared =
      current.kind === 'send' ? await this.prepareSend(current) : null
    const inFlight = startMutationAttempt(current)
    const claimed =
      await this.dependencies.syncPort.replacePendingMutationIfCurrent(
        current,
        inFlight,
      )
    if (!claimed.ok) {
      if (claimed.error.kind === 'conflict') {
        return { kind: 'skipped', reason: 'claimConflict' }
      }
      throw new Error(`mutation claim failed: ${claimed.error.kind}`)
    }

    if (inFlight.kind === 'send') {
      if (prepared?.kind === 'e2eeFailure') {
        return this.settleE2eeFailure(inFlight, prepared.error)
      }
      if (prepared?.kind !== 'ready') {
        return this.settleTerminal(inFlight)
      }
      return this.executeSend(inFlight, prepared.message)
    }
    if (inFlight.kind === 'keyword') return this.executeKeyword(inFlight)
    return this.executeMembership(inFlight)
  }

  private async prepareSend(mutation: SendMutation): Promise<PreparedSend> {
    const intent = mutation.intent
    if (intent.securityMode === 'plain') {
      return {
        kind: 'ready',
        message: submissionDraft(intent, {
          kind: 'plain',
          text: intent.body.text,
          html: intent.body.html,
        }),
      }
    }

    const encrypted = await encryptSendIntent(
      this.dependencies.e2eePort,
      intent,
    )
    if (!encrypted.ok)
      return { kind: 'e2eeFailure', error: encrypted.error.kind }
    return {
      kind: 'ready',
      message: submissionDraft(intent, {
        kind: 'boxplotE2ee',
        payload: serializeBoxplotE2eeEnvelope(encrypted.value),
      }),
    }
  }

  private async executeSend(
    mutation: SendMutation,
    message: RemoteSubmissionDraft,
  ): Promise<MutationExecutionOutcome> {
    try {
      const result = await this.dependencies.remoteMutationSource.submit(
        mutation.accountKey,
        message,
        mutation.mutationId,
      )
      if (result.remoteEmailId === null) return { kind: 'needsReconciliation' }
      const confirmed = confirmSendMutation(
        mutation,
        sendConfirmation(
          localEmailId(mutation.accountKey, result.remoteEmailId),
        ),
      )
      return (await this.confirmAndRemove(mutation, confirmed))
        ? { kind: 'confirmed' }
        : { kind: 'needsReconciliation' }
    } catch (error: unknown) {
      return this.settleRemoteFailure(mutation, error)
    }
  }

  private async executeKeyword(
    mutation: KeywordMutation,
  ): Promise<MutationExecutionOutcome> {
    try {
      await this.dependencies.remoteMutationSource.applyKeywordChange(
        mutation.accountKey,
        remoteEmailId(mutation.emailId),
        { add: [...mutation.change.add], remove: [...mutation.change.remove] },
      )
      const confirmed = confirmEmailUpdateMutation(mutation)
      return (await this.confirmAndRemove(mutation, confirmed))
        ? { kind: 'confirmed' }
        : { kind: 'needsReconciliation' }
    } catch (error: unknown) {
      return this.settleRemoteFailure(mutation, error)
    }
  }

  private async executeMembership(
    mutation: MailboxMembershipMutation,
  ): Promise<MutationExecutionOutcome> {
    try {
      await this.dependencies.remoteMutationSource.applyMembershipChange(
        mutation.accountKey,
        remoteEmailId(mutation.emailId),
        {
          add: mutation.change.add.map(remoteMailboxId),
          remove: mutation.change.remove.map(remoteMailboxId),
        },
      )
      const confirmed = confirmEmailUpdateMutation(mutation)
      return (await this.confirmAndRemove(mutation, confirmed))
        ? { kind: 'confirmed' }
        : { kind: 'needsReconciliation' }
    } catch (error: unknown) {
      return this.settleRemoteFailure(mutation, error)
    }
  }

  private async settleRemoteFailure(
    mutation: PendingMutation,
    error: unknown,
  ): Promise<MutationExecutionOutcome> {
    if (!(error instanceof RemoteMutationSourceError)) {
      return { kind: 'needsReconciliation' }
    }
    if (error.failure.kind === 'notConnected') {
      return this.settleRetry(mutation)
    }
    if (error.failure.kind !== 'remote') {
      return { kind: 'needsReconciliation' }
    }
    const remote = error.failure.error
    if (remote.outcome === 'unknown' || remote.retry === 'reconcile') {
      return { kind: 'needsReconciliation' }
    }
    if (
      remote.outcome === 'knownNotApplied' &&
      (remote.retry === 'safeImmediate' || remote.retry === 'safeBackoff')
    ) {
      return this.settleRetry(mutation)
    }
    return this.settleTerminal(mutation)
  }

  private settleE2eeFailure(
    mutation: SendMutation,
    error: E2eeErrorKind,
  ): Promise<MutationExecutionOutcome> {
    return error === 'unavailable'
      ? this.settleRetry(mutation)
      : this.settleTerminal(mutation)
  }

  private async settleRetry(
    mutation: PendingMutation,
  ): Promise<MutationExecutionOutcome> {
    const next = scheduleMutationRetry(
      mutation,
      nextRetryInstant(mutation.lifecycle.attemptCount, this.now()),
    )
    return (await this.replace(mutation, next))
      ? { kind: 'retrying' }
      : { kind: 'needsReconciliation' }
  }

  private async settleTerminal(
    mutation: PendingMutation,
  ): Promise<MutationExecutionOutcome> {
    const next = failMutationTerminal(mutation)
    return (await this.replace(mutation, next))
      ? { kind: 'failedTerminal' }
      : { kind: 'needsReconciliation' }
  }

  private async reconcile(
    mutation: PendingMutation,
  ): Promise<MutationExecutionOutcome> {
    if (mutation.kind === 'send') return this.reconcileSend(mutation)
    if (mutation.kind === 'mailboxMembership') {
      return this.reconcileMembership(mutation)
    }
    if (
      this.dependencies.refreshAccount === undefined ||
      !this.dependencies.remoteMutationSource.isConnected(mutation.accountKey)
    ) {
      return { kind: 'needsReconciliation' }
    }
    try {
      await this.dependencies.refreshAccount(mutation.accountKey)
      const current = await this.dependencies.readRepository.readEmail(
        mutation.emailId,
      )
      if (!current.ok) return { kind: 'needsReconciliation' }
      if (current.value.kind === 'absent') return this.settleTerminal(mutation)
      const keywords = current.value.value.keywords
      const applied =
        [...mutation.change.add].every((value) => keywords.has(value)) &&
        [...mutation.change.remove].every((value) => !keywords.has(value))
      if (!applied) return this.settleRetry(mutation)
      const confirmed = confirmEmailUpdateMutation(mutation)
      return (await this.confirmAndRemove(mutation, confirmed))
        ? { kind: 'confirmed' }
        : { kind: 'needsReconciliation' }
    } catch {
      return { kind: 'needsReconciliation' }
    }
  }

  private async reconcileSend(
    mutation: SendMutation,
  ): Promise<MutationExecutionOutcome> {
    const reconciler = this.dependencies.remoteMutationReconciler
    if (reconciler === undefined) return { kind: 'needsReconciliation' }
    try {
      const evidence = await reconciler.reconcileSend(
        mutation.accountKey,
        mutation.mutationId,
      )
      if (evidence.kind === 'inconclusive') {
        return { kind: 'needsReconciliation' }
      }
      const confirmed = confirmSendMutation(
        mutation,
        sendConfirmation(localEmailId(mutation.accountKey, evidence.emailId)),
      )
      return (await this.confirmAndRemove(mutation, confirmed))
        ? { kind: 'confirmed' }
        : { kind: 'needsReconciliation' }
    } catch {
      return { kind: 'needsReconciliation' }
    }
  }

  private async reconcileMembership(
    mutation: MailboxMembershipMutation,
  ): Promise<MutationExecutionOutcome> {
    const reconciler = this.dependencies.remoteMutationReconciler
    if (reconciler === undefined) return { kind: 'needsReconciliation' }
    try {
      const evidence = await reconciler.reconcileMembership(
        mutation.accountKey,
        mutation.mutationId,
        remoteEmailId(mutation.emailId),
        {
          add: mutation.change.add.map(remoteMailboxId),
          remove: mutation.change.remove.map(remoteMailboxId),
        },
      )
      if (evidence.kind === 'inconclusive') {
        return { kind: 'needsReconciliation' }
      }
      const confirmed = confirmEmailUpdateMutation(mutation)
      return (await this.confirmAndRemove(mutation, confirmed))
        ? { kind: 'confirmed' }
        : { kind: 'needsReconciliation' }
    } catch {
      return { kind: 'needsReconciliation' }
    }
  }

  private async readMutation(
    accountKey: AccountKey,
    mutationId: MutationId,
  ): Promise<PendingMutation | null> {
    const result = await this.dependencies.readRepository.readPendingMutation(
      accountKey,
      mutationId,
    )
    if (!result.ok)
      throw new Error(`readPendingMutation failed: ${result.error.kind}`)
    return result.value.kind === 'present' ? result.value.value : null
  }

  private async confirmAndRemove(
    expected: PendingMutation,
    confirmed: PendingMutation,
  ): Promise<boolean> {
    if (!(await this.replace(expected, confirmed))) return false
    await this.removeConfirmed(confirmed)
    return true
  }

  private async replace(
    expected: PendingMutation,
    next: PendingMutation,
  ): Promise<boolean> {
    const result =
      await this.dependencies.syncPort.replacePendingMutationIfCurrent(
        expected,
        next,
      )
    if (!result.ok && result.error.kind === 'conflict') return false
    if (!result.ok)
      throw new Error(`mutation settlement failed: ${result.error.kind}`)
    return true
  }

  private async removeConfirmed(mutation: PendingMutation): Promise<void> {
    const result = await this.dependencies.syncPort.removeConfirmedMutation(
      mutation.accountKey,
      mutation.mutationId,
    )
    if (!result.ok && result.error.kind !== 'conflict') {
      throw new Error(`removeConfirmedMutation failed: ${result.error.kind}`)
    }
  }
}

function submissionDraft(
  intent: SendMutation['intent'],
  body: RemoteSubmissionDraft['body'],
): RemoteSubmissionDraft {
  return {
    remoteIdentityId: remoteIdentityId(intent.identityId),
    from: { ...intent.from },
    to: intent.to.map((value) => ({ ...value })),
    cc: intent.cc.map((value) => ({ ...value })),
    bcc: intent.bcc.map((value) => ({ ...value })),
    replyTo: intent.replyTo.map((value) => ({ ...value })),
    subject: intent.subject,
    body,
  }
}

function currentMutationInstant(): MutationInstant {
  return mutationInstantFromString(new Date().toISOString())
}

function mutableSummary() {
  return {
    attempted: 0,
    confirmed: 0,
    retrying: 0,
    terminal: 0,
    reconciliation: 0,
    skipped: 0,
  }
}

function emptySummary(): MutationRunSummary {
  return mutableSummary()
}

function countOutcome(
  summary: ReturnType<typeof mutableSummary>,
  outcome: MutationExecutionOutcome,
): void {
  if (outcome.kind === 'skipped') {
    summary.skipped += 1
    return
  }
  summary.attempted += 1
  if (outcome.kind === 'confirmed') summary.confirmed += 1
  if (outcome.kind === 'retrying') summary.retrying += 1
  if (outcome.kind === 'failedTerminal') summary.terminal += 1
  if (outcome.kind === 'needsReconciliation') summary.reconciliation += 1
}
