import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TokenManager } from '../token-manager'

describe('TokenManager (Memory Only)', () => {
  let manager: TokenManager

  beforeEach(() => {
    vi.useFakeTimers()
    manager = new TokenManager()
  })

  afterEach(() => {
    manager.clearToken()
    vi.restoreAllMocks()
  })

  it('should store and retrieve a token in memory', () => {
    manager.setToken('test-token')
    expect(manager.getToken()).toBe('test-token')
  })

  it('should clear token without notifying listeners', () => {
    const spy = vi.fn()
    manager.onTokenExpired(spy)
    
    manager.setToken('test-token')
    manager.clearToken()

    expect(manager.getToken()).toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })

  it('should notify listeners and clear token on timeout', () => {
    const spy = vi.fn()
    manager.onTokenExpired(spy)

    manager.setToken('test-token', 60) // expires in 60s
    expect(manager.getToken()).toBe('test-token')

    // Fast forward 59 seconds
    vi.advanceTimersByTime(59 * 1000)
    expect(manager.getToken()).toBe('test-token')
    expect(spy).not.toHaveBeenCalled()

    // Fast forward remaining 1 second
    vi.advanceTimersByTime(1000)
    expect(manager.getToken()).toBeNull()
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('should allow force invalidation', () => {
    const spy = vi.fn()
    manager.onTokenExpired(spy)

    manager.setToken('test-token', 3600)
    manager.invalidate()

    expect(manager.getToken()).toBeNull()
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('should allow unsubscribing listeners', () => {
    const spy = vi.fn()
    const unsubscribe = manager.onTokenExpired(spy)

    manager.setToken('test-token', 60)
    unsubscribe()

    vi.advanceTimersByTime(60 * 1000)
    
    expect(manager.getToken()).toBeNull()
    expect(spy).not.toHaveBeenCalled() // because we unsubscribed
  })

  it('should survive if a listener throws an error', () => {
    const badSpy = vi.fn().mockImplementation(() => { throw new Error('Boom') })
    const goodSpy = vi.fn()

    manager.onTokenExpired(badSpy)
    manager.onTokenExpired(goodSpy)

    manager.setToken('test', 10)
    vi.advanceTimersByTime(10000)

    expect(badSpy).toHaveBeenCalled()
    expect(goodSpy).toHaveBeenCalled() // executed despite the first throwing
  })
})
