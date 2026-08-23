import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { JamClientAdapter } from '../adapter'
import { JmapAuthError, JmapMethodError, JmapNetworkError } from '../errors'

describe('JamClientAdapter - openSession', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
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

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://example.com/.well-known/jmap',
      json: async () => mockSessionResponse,
      text: async () => JSON.stringify(mockSessionResponse),
    } as unknown as Response)

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
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      url: 'https://example.com/.well-known/jmap',
    } as unknown as Response)

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
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new TypeError('Failed to fetch'))

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

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://example.com/.well-known/jmap',
      json: async () => mockSessionResponse,
      text: async () => JSON.stringify(mockSessionResponse),
    } as unknown as Response)

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

  it('should throw JmapMethodError when primary account is not found in accounts object', async () => {
    const mockSessionResponse = {
      capabilities: {
        'urn:ietf:params:jmap:mail': {},
      },
      accounts: {
        // Empty accounts object!
      },
      primaryAccounts: {
        'urn:ietf:params:jmap:mail': 'missing-account',
      },
      apiUrl: 'https://example.com/api',
    }

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://example.com/.well-known/jmap',
      json: async () => mockSessionResponse,
      text: async () => JSON.stringify(mockSessionResponse),
    } as unknown as Response)

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
