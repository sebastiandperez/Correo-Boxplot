import type { LocalChangeSource } from '../../ports/local-change-source'
import type { ReadRepository } from '../../ports/read-repository'
import type { SyncPort } from '../../ports/sync-port'

export interface LocalEngineContractHarness {
  /** Human-readable runtime name used only in test labels. */
  readonly name: string

  /**
   * Creates a clean isolated runtime with no Account, Mailbox, Email,
   * PendingMutation, or active subscription inherited from another test.
   */
  create(): Promise<LocalEngineContractRuntime>
}

export interface LocalEngineContractRuntime {
  readonly readRepository: ReadRepository
  readonly syncPort: SyncPort
  readonly localChangeSource: LocalChangeSource

  /**
   * Drains notification delivery already caused by completed Port operations.
   * This test-only control does not mutate state, fabricate hints, start remote
   * work, advance sync, or retry Outbox work.
   */
  settle(): Promise<void>

  /**
   * Releases this test runtime and its active resources for isolated cleanup.
   * This lifecycle control defines no production Port semantics.
   */
  dispose(): Promise<void>
}
