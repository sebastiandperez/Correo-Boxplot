import type { RemoteMembershipChange } from './mail'
import type { RemoteAccountId, RemoteEmailId } from './types'

export type RemoteMutationEvidence =
  | Readonly<{
      kind: 'applied'
      emailId: RemoteEmailId
    }>
  | Readonly<{
      kind: 'inconclusive'
    }>

export type RemoteSendReconciliationRequest = Readonly<{
  remoteAccountId: RemoteAccountId
  idempotencyKey: string
}>

export type RemoteMembershipReconciliationRequest = Readonly<{
  remoteAccountId: RemoteAccountId
  idempotencyKey: string
  emailId: RemoteEmailId
  change: RemoteMembershipChange
}>

/**
 * Account-scoped authoritative evidence lookup for an already-started remote
 * mutation. Implementations may throw RemoteError; an error never proves that
 * the original mutation was not applied.
 */
export interface RemoteMutationReconciler {
  reconcileSend(
    request: RemoteSendReconciliationRequest,
  ): Promise<RemoteMutationEvidence>

  reconcileMembership(
    request: RemoteMembershipReconciliationRequest,
  ): Promise<RemoteMutationEvidence>
}

export function appliedRemoteMutationEvidence(
  emailId: RemoteEmailId,
): RemoteMutationEvidence {
  return { kind: 'applied', emailId }
}

export function inconclusiveRemoteMutationEvidence(): RemoteMutationEvidence {
  return { kind: 'inconclusive' }
}

/** A positive result exists only when authoritative lookup has exactly one ID. */
export function remoteMutationEvidenceFromExactMatches(
  matches: readonly RemoteEmailId[],
): RemoteMutationEvidence {
  const match = matches[0]
  return matches.length === 1 && match !== undefined
    ? appliedRemoteMutationEvidence(match)
    : inconclusiveRemoteMutationEvidence()
}
