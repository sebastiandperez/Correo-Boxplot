import { createMemoryLocalEngine } from '../../../adapters/memory'
import type { LocalEngineContractHarness } from '../../contracts/harness'

export const memoryLocalEngineHarness: LocalEngineContractHarness = {
  name: 'Memory Local Engine',
  async create() {
    return createMemoryLocalEngine()
  },
}
