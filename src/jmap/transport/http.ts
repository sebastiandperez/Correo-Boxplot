import { JamClient } from 'jmap-jam'
import { JmapAuthError, JmapNetworkError } from '../errors'

export type AuthConfig =
  { type: 'Bearer'; token: string } | { type: 'Basic'; token: string }

/**
 * Creates a fetch wrapper that injects Authorization headers ONLY for
 * requests whose URL starts with the given baseUrl. Never touches globalThis.fetch.
 */
export function createAuthenticatedFetch(
  baseUrl: string,
  auth: AuthConfig,
): typeof fetch {
  return async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const urlStr = input instanceof Request ? input.url : input.toString()

    // Only inject auth for requests to our JMAP server
    if (!urlStr.startsWith(baseUrl)) {
      return fetch(input, init)
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
      response = await fetch(input, fetchInit)
    } catch (err: unknown) {
      throw new JmapNetworkError('Network error during JMAP request', err)
    }

    if (response.status === 401 || response.status === 403) {
      throw new JmapAuthError(
        `Authentication failed with status ${response.status}`,
      )
    }

    return response
  }
}

export function createJamClient(
  sessionUrl: string,
  auth: AuthConfig,
): JamClient {
  const authenticatedFetch = createAuthenticatedFetch(sessionUrl, auth)

  return new JamClient({
    sessionUrl,
    bearerToken: auth.type === 'Bearer' ? auth.token : 'dummy',
    fetch: authenticatedFetch,
  })
}

/**
 * Sends a raw JMAP request with multiple method calls directly via fetch.
 * Used for batching operations where jmap-jam's typed API is too restrictive.
 * This bypasses jmap-jam entirely for the actual HTTP call.
 */
export async function fetchJmapRaw(
  apiUrl: string,
  auth: AuthConfig,
  methodCalls: ReadonlyArray<
    readonly [string, Record<string, unknown>, string]
  >,
  using: string[] = [
    'urn:ietf:params:jmap:core',
    'urn:ietf:params:jmap:mail',
    'urn:ietf:params:jmap:submission',
  ],
): Promise<ReadonlyArray<readonly [string, Record<string, unknown>, string]>> {
  const authHeader =
    auth.type === 'Basic' ? `Basic ${btoa(auth.token)}` : `Bearer ${auth.token}`

  let response: Response
  try {
    response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      body: JSON.stringify({
        using,
        methodCalls,
      }),
    })
  } catch (err: unknown) {
    throw new JmapNetworkError('Network error during JMAP batch request', err)
  }

  if (response.status === 401 || response.status === 403) {
    throw new JmapAuthError(
      `Authentication failed with status ${response.status}`,
    )
  }

  if (!response.ok) {
    throw new JmapNetworkError(
      `JMAP batch request failed with status ${response.status}`,
    )
  }

  const body = await response.json()
  return body.methodCalls as ReadonlyArray<
    readonly [string, Record<string, unknown>, string]
  >
}
