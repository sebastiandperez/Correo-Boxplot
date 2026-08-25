import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { connectWebSocket } from '../websocket'
import type { JmapStateChange } from '../../types'

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static OPEN = 1
  static CLOSED = 3

  url: string
  readyState = FakeWebSocket.OPEN
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.()
  }

  // test helpers to drive the fake from outside
  triggerOpen() {
    this.onopen?.()
  }
  triggerMessage(data: unknown) {
    this.onmessage?.({ data })
  }
  triggerError() {
    this.onerror?.()
  }
  triggerCloseFromServer() {
    this.readyState = FakeWebSocket.CLOSED
    this.onclose?.()
  }
}

describe('connectWebSocket', () => {
  let disconnect: (() => void) | null = null

  beforeEach(() => {
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.useFakeTimers()
  })

  afterEach(() => {
    disconnect?.()
    disconnect = null
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  function latest(): FakeWebSocket {
    const ws = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
    if (!ws) throw new Error('no FakeWebSocket instance created')
    return ws
  }

  it('sends WebSocketPushEnable once the socket opens', () => {
    disconnect = connectWebSocket({
      wsUrl: 'wss://mail.test/ws',
      auth: { type: 'Bearer', token: 'tok' },
      onStateChange: vi.fn(),
    })

    latest().triggerOpen()

    expect(latest().sent).toHaveLength(1)
    const sent = JSON.parse(latest().sent[0])
    expect(sent).toEqual({
      '@type': 'WebSocketPushEnable',
      dataTypes: null,
      pushState: null,
    })
  })

  it('builds the URL with the Bearer token as access_token', () => {
    disconnect = connectWebSocket({
      wsUrl: 'wss://mail.test/ws',
      auth: { type: 'Bearer', token: 'tok123' },
      onStateChange: vi.fn(),
    })

    const url = new URL(latest().url)
    expect(url.searchParams.get('access_token')).toBe('tok123')
  })

  it('builds the URL with the Basic token base64-encoded as auth', () => {
    disconnect = connectWebSocket({
      wsUrl: 'wss://mail.test/ws',
      auth: { type: 'Basic', token: 'user:pass' },
      onStateChange: vi.fn(),
    })

    const url = new URL(latest().url)
    expect(url.searchParams.get('auth')).toBe(btoa('user:pass'))
  })

  it('parses a StateChange message and invokes onStateChange', () => {
    const onStateChange = vi.fn<(change: JmapStateChange) => void>()
    disconnect = connectWebSocket({
      wsUrl: 'wss://mail.test/ws',
      auth: { type: 'Bearer', token: 'tok' },
      onStateChange,
    })

    latest().triggerOpen()
    latest().triggerMessage(
      JSON.stringify({
        '@type': 'StateChange',
        changed: { acc1: { Email: 's1' } },
      }),
    )

    expect(onStateChange).toHaveBeenCalledWith({
      '@type': 'StateChange',
      changed: { acc1: { Email: 's1' } },
    })
  })

  it('ignores non-StateChange message types without calling onStateChange or onError', () => {
    const onStateChange = vi.fn()
    const onError = vi.fn()
    disconnect = connectWebSocket({
      wsUrl: 'wss://mail.test/ws',
      auth: { type: 'Bearer', token: 'tok' },
      onStateChange,
      onError,
    })

    latest().triggerOpen()
    latest().triggerMessage(
      JSON.stringify({ '@type': 'RequestError', type: 'unknownMethod' }),
    )

    expect(onStateChange).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it('invokes onError (without crashing) on malformed JSON', () => {
    const onError = vi.fn()
    disconnect = connectWebSocket({
      wsUrl: 'wss://mail.test/ws',
      auth: { type: 'Bearer', token: 'tok' },
      onStateChange: vi.fn(),
      onError,
    })

    latest().triggerOpen()
    expect(() => latest().triggerMessage('not json {')).not.toThrow()

    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error)
  })

  it('invokes onError on a native WebSocket error event', () => {
    const onError = vi.fn()
    disconnect = connectWebSocket({
      wsUrl: 'wss://mail.test/ws',
      auth: { type: 'Bearer', token: 'tok' },
      onStateChange: vi.fn(),
      onError,
    })

    latest().triggerError()

    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error)
  })

  it('invokes onDisconnect and reconnects with exponential backoff on unexpected close', () => {
    const onDisconnect = vi.fn()
    disconnect = connectWebSocket({
      wsUrl: 'wss://mail.test/ws',
      auth: { type: 'Bearer', token: 'tok' },
      onStateChange: vi.fn(),
      onDisconnect,
    })

    expect(FakeWebSocket.instances).toHaveLength(1)

    latest().triggerCloseFromServer()
    expect(onDisconnect).toHaveBeenCalledTimes(1)

    // First reconnect after ~1000ms (BASE_RECONNECT_MS)
    vi.advanceTimersByTime(999)
    expect(FakeWebSocket.instances).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(FakeWebSocket.instances).toHaveLength(2)

    // Second reconnect after ~2000ms (backoff doubled)
    latest().triggerCloseFromServer()
    expect(onDisconnect).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(1999)
    expect(FakeWebSocket.instances).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(FakeWebSocket.instances).toHaveLength(3)
  })

  it('resets backoff to base delay after a successful reconnect (onopen)', () => {
    disconnect = connectWebSocket({
      wsUrl: 'wss://mail.test/ws',
      auth: { type: 'Bearer', token: 'tok' },
      onStateChange: vi.fn(),
    })

    latest().triggerCloseFromServer()
    vi.advanceTimersByTime(1000)
    expect(FakeWebSocket.instances).toHaveLength(2)

    latest().triggerOpen() // successful reconnect resets delay to BASE_RECONNECT_MS

    latest().triggerCloseFromServer()
    vi.advanceTimersByTime(999)
    expect(FakeWebSocket.instances).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(FakeWebSocket.instances).toHaveLength(3)
  })

  it('disconnect() stops reconnection and does not invoke onDisconnect for the intentional close', () => {
    const onDisconnect = vi.fn()
    disconnect = connectWebSocket({
      wsUrl: 'wss://mail.test/ws',
      auth: { type: 'Bearer', token: 'tok' },
      onStateChange: vi.fn(),
      onDisconnect,
    })

    disconnect()
    disconnect = null

    vi.advanceTimersByTime(60_000)
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(onDisconnect).not.toHaveBeenCalled()
  })
})
