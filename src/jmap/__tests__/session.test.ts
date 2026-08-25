import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { JamClientAdapter } from '../adapter'
import { JmapAuthError, JmapMethodError, JmapNetworkError } from '../errors'

describe('JamClientAdapter - openSession', () => {
  beforeEach(() => {
    // Use vi.stubGlobal instead of raw globalThis.fetch assignment.
    // This ensures Vitest properly restores the original after each test
    // and prevents cross-test token/fetch leakage.
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should successfully discover a valid session', async () => {
    const mockSessionResponse = {
      capabilities: {
        'urn:ietf:params:jmap:core': {},
        'urn:ietf:params:jmap:mail': {},
      },
      accounts: {
        'account-1': {
          name: 'test@example.com',
          isPersonal: true,
          isReadOnly: false,
          accountCapabilities: {
            'urn:ietf:params:jmap:mail': {},
          },
        },
      },
      primaryAccounts: {
        'urn:ietf:params:jmap:mail': 'account-1',
      },
      username: 'test@example.com',
      apiUrl: 'https://example.com/api',
      downloadUrl: 'https://example.com/download',
      uploadUrl: 'https://example.com/upload',
      eventSourceUrl: 'https://example.com/events',
      state: 'state-1',
    }

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        url: 'https://example.com/.well-known/jmap',
        json: async () => mockSessionResponse,
        text: async () => JSON.stringify(mockSessionResponse),
      } as unknown as Response),
    )

    const adapter = new JamClientAdapter(
      'https://example.com/.well-known/jmap',
      {
        type: 'Bearer',
        token: 'valid-token',
      },
    )

    const session = await adapter.openSession()

    expect(session.apiUrl).toBe('https://example.com/api')
    expect(session.primaryAccounts['urn:ietf:params:jmap:mail']).toBe(
      'account-1',
    )
  })

  it('should throw JmapAuthError on 401 response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        url: 'https://example.com/.well-known/jmap',
        json: async () => {
          throw new Error('401 Unauthorized')
        },
        text: async () => '401 Unauthorized',
      } as unknown as Response),
    )

    const adapter = new JamClientAdapter(
      'https://example.com/.well-known/jmap',
      {
        type: 'Basic',
        token: 'user:pass',
      },
    )

    await expect(adapter.openSession()).rejects.toThrow(JmapAuthError)
  })

  it('should throw JmapNetworkError on network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    )

    const adapter = new JamClientAdapter(
      'https://example.com/.well-known/jmap',
      {
        type: 'Bearer',
        token: 'valid-token',
      },
    )

    await expect(adapter.openSession()).rejects.toThrow(JmapNetworkError)
  })

  it('should throw JmapMethodError when missing mail capability', async () => {
    const mockSessionResponse = {
      capabilities: {
        'urn:ietf:params:jmap:core': {},
      },
      accounts: {
        'account-1': {
          name: 'test@example.com',
        },
      },
      primaryAccounts: {
        'urn:ietf:params:jmap:core': 'account-1',
      },
      apiUrl: 'https://example.com/api',
    }

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        url: 'https://example.com/.well-known/jmap',
        json: async () => mockSessionResponse,
        text: async () => JSON.stringify(mockSessionResponse),
      } as unknown as Response),
    )

    const adapter = new JamClientAdapter(
      'https://example.com/.well-known/jmap',
      {
        type: 'Bearer',
        token: 'valid-token',
      },
    )

    await expect(adapter.openSession()).rejects.toThrow(JmapMethodError)
    await expect(adapter.openSession()).rejects.toThrow(
      /Server does not support JMAP Mail/,
    )
  })

  it('should throw JmapAuthError on a real 401 response with a valid JSON error body', async () => {
    // Regression: the old implementation relied on jam.session (jmap-jam's
    // own fetch, which never checks response.ok) and only classified auth
    // failures by matching '401'/'403'/'Unauthorized' in a thrown error's
    // message. A real server's 401 response usually has a VALID JSON body
    // (not one that throws inside .json()), which used to be silently
    // accepted as if it were the session object and misclassified further
    // down as 'missingCapability'. discoverSession must now check
    // response.status directly via createAuthenticatedFetch.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        url: 'https://example.com/.well-known/jmap',
        json: async () => ({ error: 'invalid_token' }),
        text: async () => JSON.stringify({ error: 'invalid_token' }),
      } as unknown as Response),
    )

    const adapter = new JamClientAdapter(
      'https://example.com/.well-known/jmap',
      { type: 'Bearer', token: 'expired-token' },
    )

    await expect(adapter.openSession()).rejects.toThrow(JmapAuthError)
  })

  it('sends the configured Authorization header when discovering the session', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://example.com/.well-known/jmap',
      json: async () => ({
        capabilities: { 'urn:ietf:params:jmap:mail': {} },
        accounts: { 'account-1': { name: 'test@example.com' } },
        primaryAccounts: { 'urn:ietf:params:jmap:mail': 'account-1' },
        apiUrl: 'https://example.com/api',
        downloadUrl: 'https://example.com/download',
        uploadUrl: 'https://example.com/upload',
        eventSourceUrl: 'https://example.com/events',
      }),
      text: async () => '',
    } as unknown as Response)
    vi.stubGlobal('fetch', fetchMock)

    const adapter = new JamClientAdapter(
      'https://example.com/.well-known/jmap',
      { type: 'Bearer', token: 'valid-token' },
    )

    await adapter.openSession()

    const [, init] = fetchMock.mock.calls[0]
    const headers = new Headers((init as RequestInit).headers)
    expect(headers.get('Authorization')).toBe('Bearer valid-token')
  })

  it('extracts webSocketUrl from the websocket capability, not eventSourceUrl', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        url: 'https://example.com/.well-known/jmap',
        json: async () => ({
          capabilities: {
            'urn:ietf:params:jmap:mail': {},
            'urn:ietf:params:jmap:websocket': { url: 'wss://example.com/ws' },
          },
          accounts: { 'account-1': { name: 'test@example.com' } },
          primaryAccounts: { 'urn:ietf:params:jmap:mail': 'account-1' },
          apiUrl: 'https://example.com/api',
          downloadUrl: 'https://example.com/download',
          uploadUrl: 'https://example.com/upload',
          eventSourceUrl: 'https://example.com/events',
        }),
        text: async () => '',
      } as unknown as Response),
    )

    const adapter = new JamClientAdapter(
      'https://example.com/.well-known/jmap',
      { type: 'Bearer', token: 'valid-token' },
    )

    const session = await adapter.openSession()
    expect(session.webSocketUrl).toBe('wss://example.com/ws')
    expect(session.webSocketUrl).not.toBe(session.eventSourceUrl)
  })

  it('webSocketUrl is null when the server does not advertise the websocket capability', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        url: 'https://example.com/.well-known/jmap',
        json: async () => ({
          capabilities: { 'urn:ietf:params:jmap:mail': {} },
          accounts: { 'account-1': { name: 'test@example.com' } },
          primaryAccounts: { 'urn:ietf:params:jmap:mail': 'account-1' },
          apiUrl: 'https://example.com/api',
          downloadUrl: 'https://example.com/download',
          uploadUrl: 'https://example.com/upload',
          eventSourceUrl: 'https://example.com/events',
        }),
        text: async () => '',
      } as unknown as Response),
    )

    const adapter = new JamClientAdapter(
      'https://example.com/.well-known/jmap',
      { type: 'Bearer', token: 'valid-token' },
    )

    const session = await adapter.openSession()
    expect(session.webSocketUrl).toBeNull()
  })

  it('should throw JmapMethodError when primary account is not found in accounts object', async () => {
    const mockSessionResponse = {
      capabilities: {
        'urn:ietf:params:jmap:mail': {},
      },
      accounts: {},
      primaryAccounts: {
        'urn:ietf:params:jmap:mail': 'missing-account',
      },
      apiUrl: 'https://example.com/api',
    }

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        url: 'https://example.com/.well-known/jmap',
        json: async () => mockSessionResponse,
        text: async () => JSON.stringify(mockSessionResponse),
      } as unknown as Response),
    )

    const adapter = new JamClientAdapter(
      'https://example.com/.well-known/jmap',
      {
        type: 'Bearer',
        token: 'valid-token',
      },
    )

    await expect(adapter.openSession()).rejects.toThrow(JmapMethodError)
    await expect(adapter.openSession()).rejects.toThrow(
      /Primary account missing-account not found/,
    )
  })
})
