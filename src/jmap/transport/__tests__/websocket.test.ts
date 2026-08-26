import { describe, expect, it, vi } from 'vitest'
import { connectWebSocket } from '../websocket'

describe('connectWebSocket fail-closed recovery boundary', () => {
  it.each([
    { type: 'Bearer' as const, token: 'bearer-canary-secret' },
    { type: 'Basic' as const, token: 'user:basic-canary-secret' },
  ])('does not create a credential-bearing socket for $type auth', (auth) => {
    const WebSocketConstructor = vi.fn()
    vi.stubGlobal('WebSocket', WebSocketConstructor)

    const disconnect = connectWebSocket({
      wsUrl: 'wss://mail.test/ws?existing=safe',
      auth,
      onStateChange: vi.fn(),
    })

    expect(WebSocketConstructor).not.toHaveBeenCalled()
    expect(() => disconnect()).not.toThrow()
    vi.unstubAllGlobals()
  })

  it('does not emit push callbacks or invent reconnection work', () => {
    const onStateChange = vi.fn()
    const onError = vi.fn()
    const onDisconnect = vi.fn()

    const disconnect = connectWebSocket({
      wsUrl: 'wss://mail.test/ws',
      auth: { type: 'Bearer', token: 'canary' },
      onStateChange,
      onError,
      onDisconnect,
    })
    disconnect()

    expect(onStateChange).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    expect(onDisconnect).not.toHaveBeenCalled()
  })
})
