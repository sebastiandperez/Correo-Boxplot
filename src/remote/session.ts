import type { RemoteMail } from './mail'
import type { RemoteMutationReconciler } from './reconciliation'
import type { Submission } from './submission'
import type { RemoteAccountId } from './types'

export type RemoteAccountDescriptor = Readonly<{
  id: RemoteAccountId
  capabilities: readonly string[]
}>

export interface RemoteSession {
  readonly accounts: readonly RemoteAccountDescriptor[]
  readonly mail: RemoteMail
  readonly submission: Submission
  /** Optional until a protocol supplies authoritative reconciliation evidence. */
  readonly reconciler?: RemoteMutationReconciler
  close(): Promise<void>
}
