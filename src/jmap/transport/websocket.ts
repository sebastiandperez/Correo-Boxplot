import type { JmapStateChange } from '../types'
import type { AuthConfig } from './http'

export interface WebSocketPushOptions {
  /** The WebSocket URL from the JMAP Session (typically wss://...) */
  wsUrl: string
  auth: AuthConfig
  onStateChange: (change: JmapStateChange) => void
  onError?: (err: Error) => void
  onDisconnect?: () => void
}

const BASE_RECONNECT_MS = 1000
const MAX_RECONNECT_MS = 30000

/**
 * Connects to the JMAP WebSocket endpoint for push notifications.
 * Sends WebSocketPushEnable after connection, parses StateChange events,
 * and implements reconnect with exponential backoff.
 *
 * @returns A function to disconnect and stop reconnecting.
 */
export function connectWebSocket(options: WebSocketPushOptions): () => void {
  let ws: WebSocket | null = null
  let reconnectDelay = BASE_RECONNECT_MS
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let intentionalClose = false

  function buildWsUrl(): string {
    const url = new URL(options.wsUrl)
    // Inject auth as subprotocol or query param depending on server support
    // JMAP RFC 8887 allows passing the token via the Authorization header
    // but WebSocket API doesn't support custom headers.
    // For Stalwart with Basic auth, we can pass via URL param.
    if (options.auth.type === 'Basic') {
      url.searchParams.set('auth', btoa(options.auth.token))
    } else {
      url.searchParams.set('access_token', options.auth.token)
    }
    return url.toString()
  }

  function connect() {
    if (intentionalClose) return

    try {
      ws = new WebSocket(buildWsUrl())
    } catch {
      scheduleReconnect()
      return
    }

    ws.onopen = () => {
      reconnectDelay = BASE_RECONNECT_MS

      // RFC 8887 §4.1: Send WebSocketPushEnable to start receiving push
      ws?.send(
        JSON.stringify({
          '@type': 'WebSocketPushEnable',
          dataTypes: null, // null = all types
          pushState: null,
        }),
      )
    }

    ws.onmessage = (event: MessageEvent) => {
      if (typeof event.data !== 'string') return

      try {
        const parsed = JSON.parse(event.data) as Record<string, unknown>

        if (parsed['@type'] === 'StateChange' && parsed['changed']) {
          options.onStateChange(parsed as unknown as JmapStateChange)
        }
        // Silently ignore other message types (e.g. Response, RequestError)
      } catch {
        // Malformed JSON — log but don't crash
      }
    }

    ws.onerror = () => {
      // The error event gives no useful info in the browser WebSocket API.
      // onclose will fire after this, which handles reconnect.
    }

    ws.onclose = () => {
      ws = null
      if (!intentionalClose) {
        if (options.onDisconnect) {
          options.onDisconnect()
        }
        scheduleReconnect()
      }
    }
  }

  function scheduleReconnect() {
    if (intentionalClose) return

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_MS)
      connect()
    }, reconnectDelay)
  }

  function disconnect() {
    intentionalClose = true
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (ws) {
      ws.onclose = null // Prevent reconnect trigger
      ws.close()
      ws = null
    }
  }

  // Start initial connection
  connect()

  return disconnect
}
