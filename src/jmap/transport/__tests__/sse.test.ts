import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { connectSSE } from '../sse'

describe('JMAP SSE Transport (fetch based)', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('should read SSE chunks and parse StateChange payload', async () => {
    const mockStateChange = {
      '@type': 'StateChange',
      changed: {
        'acc1': {
          Email: 'state123',
          Mailbox: 'state456'
        }
      }
    }

    // Mock fetch to simulate an SSE stream
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: {
        getReader: () => {
          let chunks = [
            `event: state\ndata: ${JSON.stringify(mockStateChange)}\n\n`,
            null // EOF
          ]
          return {
            read: async () => {
              const chunk = chunks.shift()
              if (chunk === null) return { done: true }
              return { done: false, value: new TextEncoder().encode(chunk) }
            }
          }
        }
      }
    })

    const onStateChange = vi.fn()
    const onError = vi.fn()

    const cleanup = connectSSE({
      eventSourceUrl: 'https://test/events',
      auth: { type: 'Bearer', token: 'test-token' },
      onStateChange,
      onError
    })

    // Wait a bit for the async reader loop to process the chunks
    await new Promise(r => setTimeout(r, 10))

    expect(onStateChange).toHaveBeenCalledTimes(1)
    expect(onStateChange).toHaveBeenCalledWith(mockStateChange)
    expect(onError).not.toHaveBeenCalled()
    
    cleanup()
  })

  it('should ignore malformed JSON or other events', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: {
        getReader: () => {
          let chunks = [
            `event: ping\ndata: 123\n\n`, // ignore ping
            `event: state\ndata: { bad json }\n\n`, // ignore bad json
            null // EOF
          ]
          return {
            read: async () => {
              const chunk = chunks.shift()
              if (chunk === null) return { done: true }
              return { done: false, value: new TextEncoder().encode(chunk) }
            }
          }
        }
      }
    })

    const onStateChange = vi.fn()

    connectSSE({
      eventSourceUrl: 'https://test/events',
      auth: { type: 'Basic', token: 'test-token' },
      onStateChange
    })

    await new Promise(r => setTimeout(r, 10))

    expect(onStateChange).not.toHaveBeenCalled()
  })
})
