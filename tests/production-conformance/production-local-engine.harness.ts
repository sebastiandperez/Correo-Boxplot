import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

import { createTauriLocalEngineAdapters } from '../../src/adapters/tauri'
import { LocalEngineIpcClient } from '../../src/ipc/local-engine-ipc-client'
import type {
  LocalEngineContractHarness,
  LocalEngineContractRuntime,
} from '../../src/tests/contracts/harness'

type RuntimeRequest = Readonly<{ runtimeId: string }>
type SettleEvent = Readonly<{ token: string }>

let nextSettleToken = 1

async function settle(): Promise<void> {
  const token = `settle-${nextSettleToken}`
  nextSettleToken += 1
  let resolveDelivery: (() => void) | undefined
  const delivered = new Promise<void>((resolve) => {
    resolveDelivery = resolve
  })
  const unlisten = await listen<SettleEvent>('conformance-settled', (event) => {
    if (event.payload.token === token) resolveDelivery?.()
  })
  try {
    await invoke('conformance_settle', { request: { token } })
    await delivered
  } finally {
    unlisten()
  }
}

export type ProductionContractRuntime = LocalEngineContractRuntime &
  Readonly<{ runtimeId: string }>

export const productionLocalEngineHarness = {
  name: 'Production Tauri Local Engine',
  async create(): Promise<ProductionContractRuntime> {
    const runtimeId = await invoke<string>('conformance_create_runtime')
    const adapters = createTauriLocalEngineAdapters(new LocalEngineIpcClient())
    let active = true
    return {
      runtimeId,
      ...adapters,
      settle,
      async dispose(): Promise<void> {
        if (!active) return
        active = false
        await invoke('conformance_dispose_runtime', {
          request: { runtimeId } satisfies RuntimeRequest,
        })
      },
    }
  },
} satisfies LocalEngineContractHarness

export async function restartRuntime(runtimeId: string): Promise<void> {
  await invoke('conformance_restart_runtime', {
    request: { runtimeId } satisfies RuntimeRequest,
  })
}

export async function wrongKeyIsRejected(runtimeId: string): Promise<boolean> {
  return invoke<boolean>('conformance_wrong_key_rejected', {
    request: { runtimeId } satisfies RuntimeRequest,
  })
}
