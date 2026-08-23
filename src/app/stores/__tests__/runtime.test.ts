import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useRuntimeStore } from '../runtime'

describe('Runtime Store (A-01, A-07)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('initializes with default states: opening, anonymous, offline', () => {
    const runtime = useRuntimeStore()
    expect(runtime.local).toBe('opening')
    expect(runtime.auth).toBe('anonymous')
    expect(runtime.connectivity).toBe('offline')
    expect(runtime.isLocalReady).toBe(false)
    expect(runtime.isOnline).toBe(false)
  })

  it('updates local state correctly and evaluates isLocalReady', () => {
    const runtime = useRuntimeStore()
    runtime.setLocal('ready')
    expect(runtime.local).toBe('ready')
    expect(runtime.isLocalReady).toBe(true)

    runtime.setLocal('error')
    expect(runtime.local).toBe('error')
    expect(runtime.isLocalReady).toBe(false)
  })

  it('updates auth state correctly and evaluates isAuthenticated', () => {
    const runtime = useRuntimeStore()
    runtime.setAuth('authenticating')
    expect(runtime.auth).toBe('authenticating')
    expect(runtime.isAuthenticated).toBe(false)

    runtime.setAuth('authenticated')
    expect(runtime.auth).toBe('authenticated')
    expect(runtime.isAuthenticated).toBe(true)

    runtime.setAuth('expired')
    expect(runtime.auth).toBe('expired')
    expect(runtime.isAuthenticated).toBe(false)
  })

  it('updates connectivity state independently of local and auth cycles', () => {
    const runtime = useRuntimeStore()
    runtime.setConnectivity('online')
    expect(runtime.connectivity).toBe('online')
    expect(runtime.isOnline).toBe(true)

    runtime.setConnectivity('offline')
    expect(runtime.connectivity).toBe('offline')
    expect(runtime.isOnline).toBe(false)
  })

  it('validates that LocalReady + RemoteAnonymous is valid and non-blocking (0-C)', () => {
    const runtime = useRuntimeStore()
    runtime.setLocal('ready')
    runtime.setAuth('anonymous')
    runtime.setConnectivity('offline')

    expect(runtime.isLocalReadyAndAnonymous).toBe(true)
    expect(runtime.local).toBe('ready')
    expect(runtime.auth).toBe('anonymous')
  })

  it('resets runtime state to initial values', () => {
    const runtime = useRuntimeStore()
    runtime.setLocal('ready')
    runtime.setAuth('authenticated')
    runtime.setConnectivity('online')

    runtime.reset()
    expect(runtime.local).toBe('opening')
    expect(runtime.auth).toBe('anonymous')
    expect(runtime.connectivity).toBe('offline')
  })
})
