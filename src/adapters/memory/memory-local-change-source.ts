import type {
  LocalChangeBatch,
  LocalChangeHint,
  LocalChangeListener,
  LocalChangeSource,
} from '../../ports/local-change-source'

export class MemoryChangeHub {
  private readonly listeners = new Map<number, LocalChangeListener>()
  private nextListenerId = 0

  subscribe(listener: LocalChangeListener): () => void {
    const id = this.nextListenerId
    this.nextListenerId += 1
    this.listeners.set(id, listener)

    return () => {
      this.listeners.delete(id)
    }
  }

  publish(hints: readonly [LocalChangeHint, ...LocalChangeHint[]]): void {
    const batch: LocalChangeBatch = { hints: [...hints] }

    for (const listener of [...this.listeners.values()]) {
      try {
        listener(batch)
      } catch {
        // A notification consumer cannot affect committed state or peers.
      }
    }
  }

  clear(): void {
    this.listeners.clear()
  }
}

export class MemoryLocalChangeSource implements LocalChangeSource {
  constructor(private readonly hub: MemoryChangeHub) {}

  async subscribe(listener: LocalChangeListener) {
    const unsubscribe = this.hub.subscribe(listener)
    let active = true

    return {
      ok: true as const,
      value: {
        unsubscribe(): void {
          if (active) {
            active = false
            unsubscribe()
          }
        },
      },
    }
  }
}
