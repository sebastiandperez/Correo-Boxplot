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
  // NOTE: jmap-jam 0.13.3's ClientConfig has no `fetch` option — its
  // internal loadSession()/request() always call the raw global `fetch`,
  // authenticated only via `bearerToken` (see node_modules/.pnpm/jmap-jam@0.13.3/
  // node_modules/jmap-jam/src/client.ts). Passing a custom fetch here would be
  // silently ignored, so we don't. Consequence: AuthConfig.type === 'Basic'
  // is NOT honored by calls routed through JamClient.request() (getMailboxes,
  // getIdentities, queryEmails, getEmails, getEmailChanges, getEmailBody,
  // getEmailAttachments) — only Bearer works there. Session discovery bypasses
  // jam.session entirely (see session.ts) and uses createAuthenticatedFetch
  // directly, so it supports both Bearer and Basic correctly.
  const jam = new JamClient({
    sessionUrl,
    bearerToken: auth.type === 'Bearer' ? auth.token : 'dummy',
  })

  // JamClient eagerly starts fetching the session in its own constructor
  // (JamClient.loadSession()), independently of discoverSession() above,
  // which never reads jam.session. Any other jmap-jam method that does
  // (request(), uploadBlob(), downloadBlob(), connectEventSource()) still
  // awaits it normally and sees rejections. Without this, an auth/network
  // failure at construction time would surface as an unhandled promise
  // rejection nobody is listening for.
  jam.session.catch(() => {})

  return jam
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

  let body: unknown
  try {
    body = await response.json()
  } catch (err: unknown) {
    throw new JmapNetworkError(
      'Failed to parse JMAP batch response as JSON',
      err,
    )
  }

  const methodResponses = (body as Record<string, unknown>)?.methodResponses
  if (!Array.isArray(methodResponses)) {
    throw new JmapNetworkError('JMAP batch response is missing methodResponses')
  }

  return methodResponses as ReadonlyArray<
    readonly [string, Record<string, unknown>, string]
  >
}
