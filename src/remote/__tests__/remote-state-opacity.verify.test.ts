import { describe, it, expect } from 'vitest'
import { remoteSyncStateFromString } from '../types'
import { localCollectionState } from '../compat/domain-ids'

describe('V3 — Remote State Opacity', () => {
  const opaqueStates = [
    '',
    '0',
    '00001',
    '10',
    '{"uidValidity":8,"uidNext":51}',
    'state:a:b:c',
    '🔥',
  ]

  it('V3-01: Exact state preservation across factory and compat mapper', () => {
    for (const rawState of opaqueStates) {
      const remoteState = remoteSyncStateFromString(rawState)
      expect(remoteState).toBe(rawState)

      const domainState = localCollectionState(remoteState)
      expect(domainState).toBe(rawState)
    }
  })

  it('V3-02: Empty string remains a valid opaque state if contract permits it', () => {
    const emptyState = remoteSyncStateFromString('')
    expect(emptyState).toBe('')
    const domainState = localCollectionState(emptyState)
    expect(domainState).toBe('')
  })

  it('V3-03: No lexical/numeric ordering assumption on RemoteSyncState', () => {
    const stateA = remoteSyncStateFromString('10')
    const stateB = remoteSyncStateFromString('9')

    // RemoteSyncState is opaque string, no numeric comparison methods exist on RemoteSyncState.
    // They are compared for strict equality only.
    expect(stateA === stateB).toBe(false)
    expect(typeof stateA).toBe('string')
  })

  it('V3-04: JSON-looking state remains an unparsed opaque string', () => {
    const jsonStateStr = '{"uidValidity":8,"uidNext":51}'
    const state = remoteSyncStateFromString(jsonStateStr)

    expect(state).toBe(jsonStateStr)
    expect(typeof state).toBe('string')
  })
})
