import type { LocalEngineContractHarness } from './harness'
import { defineSyncPortMutationContract } from './sync-port-mutations.contract'
import { defineSyncPortStateContract } from './sync-port-state.contract'

export function defineSyncPortContract(
  harness: LocalEngineContractHarness,
): void {
  defineSyncPortStateContract(harness)
  defineSyncPortMutationContract(harness)
}
