import type { LocalEngineIpcClient } from '../../ipc/local-engine-ipc-client'
import type {
  LocalChangeListener,
  LocalChangeSource,
} from '../../ports/local-change-source'
import { error, mapTransportFailure, ok } from './adapter-results'
import { decodeLocalChangeBatch } from './domain-ipc-codecs'

export class TauriLocalChangeSource implements LocalChangeSource {
  constructor(private readonly client: LocalEngineIpcClient) {}

  async subscribe(listener: LocalChangeListener) {
    let active = true
    try {
      const unlisten = await this.client.listenLocalStateChanged((value) => {
        if (!active) return
        try {
          listener(decodeLocalChangeBatch(value))
        } catch {
          // Malformed events and consumer failures cannot affect other listeners.
        }
      })
      return ok({
        unsubscribe(): void {
          if (!active) return
          active = false
          try {
            unlisten()
          } catch {
            // The P-03 unsubscribe contract is non-throwing.
          }
        },
      })
    } catch (cause) {
      active = false
      return error(mapTransportFailure(cause))
    }
  }
}
