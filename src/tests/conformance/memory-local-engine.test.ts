import { defineLocalChangeSourceContract } from '../contracts/local-change-source.contract'
import { defineLocalEngineSystemContract } from '../contracts/local-engine-system.contract'
import { defineReadRepositoryContract } from '../contracts/read-repository.contract'
import { defineSyncPortContract } from '../contracts/sync-port.contract'
import { memoryLocalEngineHarness } from '../support/memory/memory-local-engine.harness'

defineReadRepositoryContract(memoryLocalEngineHarness)
defineSyncPortContract(memoryLocalEngineHarness)
defineLocalChangeSourceContract(memoryLocalEngineHarness)
defineLocalEngineSystemContract(memoryLocalEngineHarness)
