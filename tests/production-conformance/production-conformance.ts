import { defineLocalChangeSourceContract } from '../../src/tests/contracts/local-change-source.contract'
import { defineLocalEngineSystemContract } from '../../src/tests/contracts/local-engine-system.contract'
import { defineReadRepositoryContract } from '../../src/tests/contracts/read-repository.contract'
import { defineSyncPortContract } from '../../src/tests/contracts/sync-port.contract'
import { createTestFixtures } from '../../src/tests/contracts/fixtures'
import { runRegisteredTests } from './browser-vitest-shim'
import {
  productionLocalEngineHarness,
  restartRuntime,
  type ProductionContractRuntime,
  wrongKeyIsRejected,
} from './production-local-engine.harness'

defineReadRepositoryContract(productionLocalEngineHarness)
defineSyncPortContract(productionLocalEngineHarness)
defineLocalChangeSourceContract(productionLocalEngineHarness)
defineLocalEngineSystemContract(productionLocalEngineHarness)

type SmokeResult = Readonly<{ name: string; passed: boolean; error?: string }>

async function smoke(
  name: string,
  body: () => Promise<void>,
): Promise<SmokeResult> {
  try {
    await body()
    return { name, passed: true }
  } catch (error) {
    return {
      name,
      passed: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function runProductionSmoke(): Promise<readonly SmokeResult[]> {
  const { accountA } = createTestFixtures()
  let runtime: ProductionContractRuntime | undefined
  const results: SmokeResult[] = []

  results.push(
    await smoke('PS-01 restart preserves encrypted state', async () => {
      runtime = await productionLocalEngineHarness.create()
      const registered = await runtime.syncPort.registerAccount(accountA)
      if (!registered.ok)
        throw new Error(`register failed: ${registered.error.kind}`)
      await restartRuntime(runtime.runtimeId)
      const read = await runtime.readRepository.readAccount(accountA.key)
      if (!read.ok || read.value.kind !== 'present')
        throw new Error('Account did not survive restart')
    }),
  )

  results.push(
    await smoke('PS-04 wrong SQLCipher key is rejected', async () => {
      if (
        runtime === undefined ||
        !(await wrongKeyIsRejected(runtime.runtimeId))
      ) {
        throw new Error('wrong key was not rejected')
      }
    }),
  )

  results.push(
    await smoke('PS-03 event permits committed-state reread', async () => {
      if (runtime === undefined) throw new Error('runtime unavailable')
      let observed = false
      const subscription = await runtime.localChangeSource.subscribe(() => {
        observed = true
      })
      if (!subscription.ok) throw new Error('subscription unavailable')
      await runtime.syncPort.registerAccount(createTestFixtures().accountB)
      await runtime.settle()
      subscription.value.unsubscribe()
      const read = await runtime.readRepository.readAccount(
        createTestFixtures().accountB.key,
      )
      if (!observed || !read.ok || read.value.kind !== 'present') {
        throw new Error('event/reread chain failed')
      }
    }),
  )

  results.push(
    await smoke('PS-02 fresh runtime is isolated', async () => {
      await runtime?.dispose()
      runtime = await productionLocalEngineHarness.create()
      const read = await runtime.readRepository.listAccounts()
      if (!read.ok || read.value.length !== 0)
        throw new Error('fresh runtime inherited state')
    }),
  )

  results.push(
    await smoke('PS-05 uninitialized state maps to unavailable', async () => {
      if (runtime === undefined) throw new Error('runtime unavailable')
      const adapters = runtime
      await runtime.dispose()
      runtime = undefined
      const read = await adapters.readRepository.listAccounts()
      if (read.ok || read.error.kind !== 'unavailable') {
        throw new Error('uninitialized engine did not map to unavailable')
      }
    }),
  )

  await runtime?.dispose()
  return results
}

async function main(): Promise<void> {
  const contracts = await runRegisteredTests()
  const smokeResults = await runProductionSmoke()
  const result = {
    contracts,
    smoke: smokeResults,
    productionCommandCount: 25,
  }
  Object.assign(window, { __PROD_CONFORMANCE_RESULT__: result })
  document.body.textContent = JSON.stringify(result)
  window.dispatchEvent(new Event('prod-conformance-complete'))
}

void main().catch((error: unknown) => {
  const result = {
    fatal:
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error),
  }
  Object.assign(window, { __PROD_CONFORMANCE_RESULT__: result })
  document.body.textContent = JSON.stringify(result)
  window.dispatchEvent(new Event('prod-conformance-complete'))
})
