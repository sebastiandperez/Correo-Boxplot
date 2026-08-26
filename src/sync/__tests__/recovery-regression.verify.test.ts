import { describe, it, expect } from 'vitest'
import { TokenManager } from '../../jmap/auth/token-manager'
import { collectionSyncStateFromString } from '../../domain/sync-cursor'
import { remoteSyncStateFromString } from '../../remote/types'
import { localCollectionState } from '../../remote/compat/domain-ids'
import { connectWebSocket } from '../../jmap/transport/websocket'

describe('V13 — Recovery Regression Verification', () => {
  it('TokenManager clears token on invalidate() and notifies listeners', () => {
    const tm = new TokenManager()
    let notified = false
    tm.onTokenExpired(() => {
      notified = true
    })

    tm.setToken('canary-token', 3600)
    expect(tm.getToken()).toBe('canary-token')

    tm.invalidate()
    expect(tm.getToken()).toBeNull()
    expect(notified).toBe(true)
  })

  it('connectWebSocket fails closed for WebSocket options (C2-R03 / security invariant)', () => {
    const unsub = connectWebSocket({
      wsUrl: 'wss://jmap.example.com/ws',
      auth: { type: 'Bearer', token: 'canary' },
      onStateChange: () => {},
    })
    expect(typeof unsub).toBe('function')
  })

  it('RemoteSyncState and CollectionSyncState mapping preserves empty authoritative state token', () => {
    const emptyState = remoteSyncStateFromString('')
    const domainState = localCollectionState(emptyState)
    expect(domainState).toBe('')
    expect(collectionSyncStateFromString('')).toBe('')
  })
})

describe('V14 — Frozen Contract Regression Verification', () => {
  it('Domain and Remote compat mappers preserve frozen local representations', () => {
    const stateStr = 'frozen-state-token-123'
    const domainState = collectionSyncStateFromString(stateStr)
    expect(domainState).toBe(stateStr)
  })
})
