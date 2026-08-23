import { JamClient } from 'jmap-jam'
import { JmapAuthError, JmapNetworkError } from '../errors'

export type AuthConfig =
  | { type: 'Bearer'; token: string }
  | { type: 'Basic'; token: string }

export function createJamClient(sessionUrl: string, auth: AuthConfig): JamClient {
  const originalFetch = globalThis.fetch

  // We override globalThis.fetch because jmap-jam's JamClient.loadSession
  // hardcodes a call to the global fetch and ignores the 'fetch' option.
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const urlStr = input.toString()
    
    // Only intercept requests to our JMAP server
    if (!urlStr.startsWith(sessionUrl) && !urlStr.includes('/jmap/')) {
      return originalFetch(input, init)
    }

    const fetchInit = init || {}
    const headers = new Headers(fetchInit.headers)

    if (auth.type === 'Basic') {
      const encoded = btoa(auth.token)
      headers.set('Authorization', `Basic ${encoded}`)
    } else {
      headers.set('Authorization', `Bearer ${auth.token}`)
    }

    fetchInit.headers = headers

    let response: Response
    try {
      response = await originalFetch(input, fetchInit)
    } catch (err: unknown) {
      throw new JmapNetworkError('Network error during JMAP request', err)
    }

    if (response.status === 401 || response.status === 403) {
      throw new JmapAuthError(`Authentication failed with status ${response.status}`)
    }

    return response
  }

  return new JamClient({
    sessionUrl,
    bearerToken: auth.type === 'Bearer' ? auth.token : 'dummy',
    // We still pass custom fetch just in case jmap-jam uses it in the future
    fetch: globalThis.fetch,
  })
}
