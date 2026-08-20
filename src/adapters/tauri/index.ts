import type { LocalEngineIpcClient } from '../../ipc/local-engine-ipc-client'
import { TauriLocalChangeSource } from './tauri-local-change-source'
import { TauriReadRepository } from './tauri-read-repository'
import { TauriSyncPort } from './tauri-sync-port'

export { TauriLocalChangeSource } from './tauri-local-change-source'
export { TauriReadRepository } from './tauri-read-repository'
export { TauriSyncPort } from './tauri-sync-port'

export function createTauriLocalEngineAdapters(client: LocalEngineIpcClient) {
  return {
    readRepository: new TauriReadRepository(client),
    syncPort: new TauriSyncPort(client),
    localChangeSource: new TauriLocalChangeSource(client),
  }
}
