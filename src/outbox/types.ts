import type { AccountKey, MutationId } from '../domain/ids'

export type MutationSkipReason =
  'notFound' | 'notDue' | 'terminal' | 'claimConflict' | 'notConnected'

export type MutationExecutionOutcome =
  | Readonly<{ kind: 'confirmed' }>
  | Readonly<{ kind: 'retrying' }>
  | Readonly<{ kind: 'failedTerminal' }>
  | Readonly<{ kind: 'needsReconciliation' }>
  | Readonly<{ kind: 'skipped'; reason: MutationSkipReason }>

export type MutationRunSummary = Readonly<{
  attempted: number
  confirmed: number
  retrying: number
  terminal: number
  reconciliation: number
  skipped: number
}>

export interface MutationRunner {
  runAccount(accountKey: AccountKey): Promise<MutationRunSummary>
  runMutation(
    accountKey: AccountKey,
    mutationId: MutationId,
  ): Promise<MutationExecutionOutcome>
}
