import type { JmapStateChange } from '../types'
import type { AuthConfig } from './http'

export interface SseOptions {
  eventSourceUrl: string
  auth: AuthConfig
  onStateChange: (change: JmapStateChange) => void
  onError?: (err: Error) => void
}

/**
 * Connects to the JMAP EventSource endpoint using the standard Fetch API.
 * We use `fetch` instead of the native `EventSource` to allow custom headers
 * (like Authorization: Basic/Bearer) which native EventSource doesn't support,
 * and which we need to bypass Stalwart authentication issues.
 *
 * @returns A function to cancel the connection and abort the fetch.
 */
export function connectSSE(options: SseOptions): () => void {
  const abortController = new AbortController()

  async function start() {
    try {
      const authHeader =
        options.auth.type === 'Basic'
          ? `Basic ${btoa(options.auth.token)}`
          : `Bearer ${options.auth.token}`

      const response = await fetch(options.eventSourceUrl, {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          Authorization: authHeader,
        },
        signal: abortController.signal,
      })

      if (!response.ok) {
        throw new Error(`SSE Connection failed with status ${response.status}`)
      }

      if (!response.body) {
        throw new Error('SSE response lacks body')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split('\n\n')

        // The last element is either an empty string (if it ended exactly with \n\n)
        // or a partial chunk. We leave it in the buffer.
        buffer = events.pop() || ''

        for (const event of events) {
          if (!event.trim()) continue

          const lines = event.split('\n')
          let eventType = 'message'
          let eventData = ''

          for (const line of lines) {
            if (line.startsWith('event:')) {
              eventType = line.substring(6).trim()
            } else if (line.startsWith('data:')) {
              eventData += line.substring(5).trim()
            }
          }

          // According to RFC 8620, JMAP state changes are sent as 'state' events
          if (eventType === 'state' && eventData) {
            try {
              const parsed = JSON.parse(eventData)

              // Validate shape roughly to match JmapStateChange
              if (
                parsed &&
                typeof parsed === 'object' &&
                parsed['@type'] === 'StateChange'
              ) {
                options.onStateChange(parsed as JmapStateChange)
              }
            } catch {
              // Ignore malformed JSON payloads to prevent crashing the worker
            }
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        // Disconnected intentionally
        return
      }
      if (options.onError) {
        options.onError(err instanceof Error ? err : new Error(String(err)))
      }
    }
  }

  // Start connection asynchronously
  start()

  return () => {
    abortController.abort()
  }
}
