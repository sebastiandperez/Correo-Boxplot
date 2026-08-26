import type { SyncPort } from '../ports/sync-port'
import type { ReadRepository } from '../ports/read-repository'
import type { JmapClient } from '../jmap/client'
import type { AccountKey, MutationId } from '../domain/ids'
import type { MutationInstant, SendMutation } from '../domain/pending-mutation'
import {
  confirmSendMutation,
  failMutationTerminal,
  mutationInstantFromString,
  scheduleMutationRetry,
  sendConfirmation,
  startMutationAttempt,
} from '../domain/pending-mutation'
import { jmapEmailIdFromString, scopedEmailId } from '../domain/ids'
import {
  isRetryable,
  JmapError,
  JmapNetworkError,
  JmapSubmissionAmbiguousError,
} from '../jmap/errors'
import { mapSendIntentToJmapDraft } from '../jmap/mail/draft-mapper'

export type SendMutationOutcome =
  | Readonly<{ kind: 'sent' }>
  | Readonly<{ kind: 'needsReconciliation' }>
  | Readonly<{
      kind: 'skipped'
      reason:
        'notFound' | 'notDue' | 'alreadyInFlight' | 'terminal' | 'claimConflict'
    }>

type MutationLookup =
  | Readonly<{ kind: 'found'; mutation: SendMutation }>
  | Readonly<{ kind: 'notFound' }>
  | Readonly<{ kind: 'notDue' }>
  | Readonly<{ kind: 'alreadyInFlight' }>
  | Readonly<{ kind: 'terminal' }>

export class Outbox {
  constructor(
    private readonly client: JmapClient,
    private readonly syncPort: SyncPort,
    private readonly readRepository: ReadRepository,
    private readonly now: () => MutationInstant = currentMutationInstant,
  ) {}

  /**
   * Processes one durably staged SendMutation, identified by mutationId.
   * Reads the current committed snapshot itself (never trusts a
   * caller-supplied mutation object) so every CAS transition is against
   * the real state, not a stale copy — this is what makes
   * replacePendingMutationIfCurrent's compare-and-swap meaningful.
   *
   * Returns a discriminated outcome rather than resolving silently on a
   * no-op: a caller asking to send a mutationId that was never staged (or
   * already handled) needs to be able to tell that apart from an actual
   * send, instead of a Worker blindly reporting SEND_SUCCESS either way.
   *
   * If the process crashes mid-flight, the mutation is left inFlight or
   * retrying — never silently dropped — guaranteeing eventual consistency
   * without optimistic data corruption. Reconciling a surviving inFlight
   * mutation against an ambiguous remote outcome (did the send actually
   * happen?) is OUTBOX-01 / C-14, still open — this only covers the
   * straight-line success/retry/terminal paths.
   */
  async processSendMutation(
    accountKey: AccountKey,
    jmapAccountId: string,
    mutationId: MutationId,
  ): Promise<SendMutationOutcome> {
    const lookup = await this.readCurrentSendMutation(accountKey, mutationId)
    if (lookup.kind !== 'found') {
      return { kind: 'skipped', reason: lookup.kind }
    }
    const expected = lookup.mutation

    const inFlight = startMutationAttempt(expected)
    const claimed = await this.syncPort.replacePendingMutationIfCurrent(
      expected,
      inFlight,
    )
    if (!claimed.ok) {
      if (claimed.error.kind === 'conflict') {
        return { kind: 'skipped', reason: 'claimConflict' }
      }
      throw new Error(
        `replacePendingMutationIfCurrent(inFlight) failed: ${claimed.error.kind}`,
      )
    }

    const draft = mapSendIntentToJmapDraft(inFlight.intent)

    let result
    try {
      result = await this.client.submitEmail(
        jmapAccountId,
        draft,
        inFlight.intent.identityId.jmapId,
      )
    } catch (err: unknown) {
      if (isAmbiguousSubmissionFailure(err)) {
        // The server may have accepted the request. Preserve durable
        // inFlight state so no automatic caller can submit it again.
        return { kind: 'needsReconciliation' }
      }
      await this.settleKnownFailure(inFlight, err)
      throw err
    }

    const confirmed = confirmSendMutation(
      inFlight,
      sendConfirmation(
        scopedEmailId(accountKey, jmapEmailIdFromString(result.emailId)),
      ),
    )
    const confirmResult = await this.syncPort.replacePendingMutationIfCurrent(
      inFlight,
      confirmed,
    )
    if (!confirmResult.ok) {
      throw new Error(
        `replacePendingMutationIfCurrent(confirmed) failed: ${confirmResult.error.kind}`,
      )
    }

    const removeResult = await this.syncPort.removeConfirmedMutation(
      accountKey,
      mutationId,
    )
    if (!removeResult.ok) {
      throw new Error(
        `removeConfirmedMutation failed: ${removeResult.error.kind}`,
      )
    }

    return { kind: 'sent' }
  }

  private async settleKnownFailure(
    inFlight: SendMutation,
    err: unknown,
  ): Promise<void> {
    const next = isRetryable(err)
      ? scheduleMutationRetry(inFlight, this.now())
      : failMutationTerminal(inFlight)

    const result = await this.syncPort.replacePendingMutationIfCurrent(
      inFlight,
      next,
    )
    if (!result.ok) {
      throw new Error(
        `replacePendingMutationIfCurrent(${next.lifecycle.status}) failed: ${result.error.kind}`,
      )
    }
  }

  private async readCurrentSendMutation(
    accountKey: AccountKey,
    mutationId: MutationId,
  ): Promise<MutationLookup> {
    const result = await this.readRepository.readPendingMutation(
      accountKey,
      mutationId,
    )
    if (!result.ok) {
      throw new Error(`readPendingMutation failed: ${result.error.kind}`)
    }

    switch (result.value.kind) {
      case 'ownerAbsent':
        throw new Error(`Account ${accountKey} is not registered locally`)
      case 'absent':
        return { kind: 'notFound' }
      case 'present':
        if (result.value.value.kind !== 'send') {
          throw new Error(
            `Mutation ${mutationId} is not a SendMutation (kind: ${result.value.value.kind})`,
          )
        }
        switch (result.value.value.lifecycle.status) {
          case 'pending':
            return { kind: 'found', mutation: result.value.value }
          case 'retrying':
            return result.value.value.lifecycle.nextAttemptAt <= this.now()
              ? { kind: 'found', mutation: result.value.value }
              : { kind: 'notDue' }
          case 'inFlight':
            return { kind: 'alreadyInFlight' }
          case 'confirmed':
          case 'failedTerminal':
            return { kind: 'terminal' }
        }
    }
  }
}

/**
 * A simple immediate retry policy: schedule the next attempt "now" and let
 * whatever drives the Outbox loop (not yet implemented — OUTBOX-01) decide
 * actual backoff spacing. Exponential backoff belongs to that scheduler,
 * not to this per-mutation state transition.
 */
function currentMutationInstant(): MutationInstant {
  return mutationInstantFromString(new Date().toISOString())
}

function isAmbiguousSubmissionFailure(error: unknown): boolean {
  return (
    error instanceof JmapSubmissionAmbiguousError ||
    error instanceof JmapNetworkError ||
    !(error instanceof JmapError)
  )
}
