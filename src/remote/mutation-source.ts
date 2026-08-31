import type { AccountKey } from '../domain/ids'
import type { RemoteKeywordChange, RemoteMembershipChange } from './mail'
import type { RemoteError } from './errors'
import type { SubmissionMessage } from './submission-message'
import type { SubmissionResult } from './submission'
import type { RemoteEmailId } from './types'
import type { RemoteMutationEvidence } from './reconciliation'

export type RemoteMutationSourceFailure =
  | Readonly<{ kind: 'notConnected' }>
  | Readonly<{ kind: 'cancelled' }>
  | Readonly<{ kind: 'remote'; error: RemoteError }>
  | Readonly<{ kind: 'unexpected' }>

export class RemoteMutationSourceError extends Error {
  constructor(readonly failure: RemoteMutationSourceFailure) {
    super(`Remote mutation source failed: ${failure.kind}`)
    this.name = 'RemoteMutationSourceError'
  }
}

export type RemoteSubmissionDraft = Omit<SubmissionMessage, 'remoteAccountId'>

/** Account-scoped mutation capability backed by the active product session. */
export interface RemoteMutationSource {
  isConnected(accountKey: AccountKey): boolean

  submit(
    accountKey: AccountKey,
    message: RemoteSubmissionDraft,
    idempotencyKey: string,
  ): Promise<SubmissionResult>

  applyKeywordChange(
    accountKey: AccountKey,
    emailId: RemoteEmailId,
    change: RemoteKeywordChange,
  ): Promise<void>

  applyMembershipChange(
    accountKey: AccountKey,
    emailId: RemoteEmailId,
    change: RemoteMembershipChange,
  ): Promise<void>
}

/** Application-scoped access to the reconciler owned by the active session. */
export interface AccountScopedRemoteMutationReconciler {
  reconcileSend(
    accountKey: AccountKey,
    idempotencyKey: string,
  ): Promise<RemoteMutationEvidence>

  reconcileMembership(
    accountKey: AccountKey,
    idempotencyKey: string,
    emailId: RemoteEmailId,
    change: RemoteMembershipChange,
  ): Promise<RemoteMutationEvidence>
}
