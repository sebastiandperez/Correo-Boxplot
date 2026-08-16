import type { LocalChangeSource } from '../../ports/local-change-source'
import type { ReadRepository } from '../../ports/read-repository'
import type { SyncPort } from '../../ports/sync-port'
import {
  MemoryChangeHub,
  MemoryLocalChangeSource,
} from './memory-local-change-source'
import { MemoryReadRepository } from './memory-read-repository'
import { MemoryState } from './memory-state'
import { MemorySyncPort } from './memory-sync-port'

export type MemoryLocalEngine = Readonly<{
  readRepository: ReadRepository
  syncPort: SyncPort
  localChangeSource: LocalChangeSource
  settle(): Promise<void>
  dispose(): Promise<void>
}>

export function createMemoryLocalEngine(): MemoryLocalEngine {
  const state = new MemoryState()
  const changes = new MemoryChangeHub()

  return {
    readRepository: new MemoryReadRepository(state),
    syncPort: new MemorySyncPort(state, changes),
    localChangeSource: new MemoryLocalChangeSource(changes),
    async settle(): Promise<void> {},
    async dispose(): Promise<void> {
      changes.clear()
    },
  }
}
