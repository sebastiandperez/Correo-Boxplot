import type { JmapStateChange } from '../types'
import type { AuthConfig } from './http'

export interface WebSocketPushOptions {
  /** The WebSocket URL advertised by the JMAP Session. */
  wsUrl: string
  auth: AuthConfig
  onStateChange: (change: JmapStateChange) => void
  onError?: (err: Error) => void
  onDisconnect?: () => void
}

/**
 * RFC 8887 push is deliberately disabled in the browser runtime.
 *
 * The browser WebSocket API cannot attach an Authorization header. Encoding
 * Bearer or Basic credentials in the URL would leak them through histories,
 * proxies and logs, so this boundary fails closed until an authenticated
 * transport is available. HTTP JMAP remains fully operational.
 */
export function connectWebSocket(options: WebSocketPushOptions): () => void {
  void options
  return () => {}
}
