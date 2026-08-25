import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  createAuthenticatedFetch,
  fetchJmapRaw,
  createJamClient,
} from '../http'
import { JmapAuthError, JmapNetworkError } from '../../errors'

function jsonResponse(
  status: number,
  body: unknown,
  ok = status >= 200 && status < 300,
): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

describe('createAuthenticatedFetch', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('injects a Bearer Authorization header for requests to baseUrl', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(200, {}))

    const authedFetch = createAuthenticatedFetch('https://mail.test/api', {
      type: 'Bearer',
      token: 'abc123',
    })

    await authedFetch('https://mail.test/api/session')

    const [, init] = fetchSpy.mock.calls[0]
    const headers = new Headers((init as RequestInit).headers)
    expect(headers.get('Authorization')).toBe('Bearer abc123')
  })

  it('injects a Basic Authorization header when configured for Basic auth', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(200, {}))

    const authedFetch = createAuthenticatedFetch('https://mail.test/api', {
      type: 'Basic',
      token: 'user:pass',
    })

    await authedFetch('https://mail.test/api/session')

    const [, init] = fetchSpy.mock.calls[0]
    const headers = new Headers((init as RequestInit).headers)
    const expected = 'Basic ' + btoa('user:pass')
    expect(headers.get('Authorization')).toBe(expected)
  })

  it('does NOT inject Authorization for requests outside baseUrl', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(200, {}))

    const authedFetch = createAuthenticatedFetch('https://mail.test/api', {
      type: 'Bearer',
      token: 'abc123',
    })

    await authedFetch('https://other.test/resource')

    const [, init] = fetchSpy.mock.calls[0]
    expect(init).toBeUndefined()
  })

  it('never mutates globalThis.fetch', async () => {
    const originalFetch = globalThis.fetch
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, {}))

    const authedFetch = createAuthenticatedFetch('https://mail.test/api', {
      type: 'Bearer',
      token: 'abc123',
    })
    await authedFetch('https://mail.test/api/session')

    expect(globalThis.fetch).not.toBe(authedFetch)
    vi.restoreAllMocks()
    expect(globalThis.fetch).toBe(originalFetch)
  })

  it('throws JmapAuthError on 401', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(401, { error: 'invalid_token' }, false),
    )
    const authedFetch = createAuthenticatedFetch('https://mail.test/api', {
      type: 'Bearer',
      token: 'expired',
    })

    await expect(authedFetch('https://mail.test/api/session')).rejects.toThrow(
      JmapAuthError,
    )
  })

  it('throws JmapAuthError on 403', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(403, { error: 'forbidden' }, false),
    )
    const authedFetch = createAuthenticatedFetch('https://mail.test/api', {
      type: 'Bearer',
      token: 'abc',
    })

    await expect(authedFetch('https://mail.test/api/session')).rejects.toThrow(
      JmapAuthError,
    )
  })

  it('throws JmapNetworkError when fetch itself rejects', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new TypeError('Failed to fetch'),
    )
    const authedFetch = createAuthenticatedFetch('https://mail.test/api', {
      type: 'Bearer',
      token: 'abc',
    })

    await expect(authedFetch('https://mail.test/api/session')).rejects.toThrow(
      JmapNetworkError,
    )
  })

  it('passes through non-401/403 responses (e.g. 200, 500) unchanged', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(500, { error: 'boom' }, false),
    )
    const authedFetch = createAuthenticatedFetch('https://mail.test/api', {
      type: 'Bearer',
      token: 'abc',
    })

    const response = await authedFetch('https://mail.test/api/session')
    expect(response.status).toBe(500)
  })
})

describe('fetchJmapRaw', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const auth = { type: 'Bearer', token: 'abc' } as const
  const methodCalls = [['Email/set', { accountId: 'a1' }, 'e1']] as const

  it('reads methodResponses from the JMAP response envelope (RFC 8620), not methodCalls', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(200, {
        methodResponses: [['Email/set', { updated: { e1: null } }, 'e1']],
      }),
    )

    const result = await fetchJmapRaw(
      'https://mail.test/api',
      auth,
      methodCalls,
    )

    expect(result).toEqual([['Email/set', { updated: { e1: null } }, 'e1']])
  })

  it('throws a typed error if the server responds with the old/wrong methodCalls key', async () => {
    // Reproduces the historical bug: a server (or a stale mock) that returns
    // `methodCalls` instead of `methodResponses` must fail loudly, not
    // resolve to undefined and let callers crash with a raw TypeError.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(200, {
        methodCalls: [['Email/set', {}, 'e1']],
      }),
    )

    await expect(
      fetchJmapRaw('https://mail.test/api', auth, methodCalls),
    ).rejects.toThrow(JmapNetworkError)
  })

  it('throws a typed error when methodResponses is missing entirely', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(200, {}))

    await expect(
      fetchJmapRaw('https://mail.test/api', auth, methodCalls),
    ).rejects.toThrow(JmapNetworkError)
  })

  it('throws JmapAuthError on 401', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(401, {}, false),
    )

    await expect(
      fetchJmapRaw('https://mail.test/api', auth, methodCalls),
    ).rejects.toThrow(JmapAuthError)
  })

  it('throws JmapNetworkError on non-ok, non-401/403 status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(500, {}, false),
    )

    await expect(
      fetchJmapRaw('https://mail.test/api', auth, methodCalls),
    ).rejects.toThrow(JmapNetworkError)
  })

  it('throws JmapNetworkError when fetch rejects', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new TypeError('Failed to fetch'),
    )

    await expect(
      fetchJmapRaw('https://mail.test/api', auth, methodCalls),
    ).rejects.toThrow(JmapNetworkError)
  })

  it('throws JmapNetworkError when the body is not valid JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token')
      },
      text: async () => 'not json',
    } as unknown as Response)

    await expect(
      fetchJmapRaw('https://mail.test/api', auth, methodCalls),
    ).rejects.toThrow(JmapNetworkError)
  })
})

describe('createJamClient', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not produce an unhandled rejection when the session fetch fails', async () => {
    // JamClient fetches its session eagerly in the constructor using the raw
    // global fetch (jmap-jam ignores any injected fetch). If nothing
    // consumes that rejection, Node/the browser reports an unhandled
    // rejection even though our own discoverSession() never reads
    // jam.session. createJamClient must swallow it defensively.
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new TypeError('Failed to fetch'),
    )

    const unhandled = vi.fn()
    process.once('unhandledRejection', unhandled)

    createJamClient('https://mail.test/.well-known/jmap', {
      type: 'Bearer',
      token: 'abc',
    })

    await new Promise((resolve) => setTimeout(resolve, 0))
    process.removeListener('unhandledRejection', unhandled)

    expect(unhandled).not.toHaveBeenCalled()
  })
})
