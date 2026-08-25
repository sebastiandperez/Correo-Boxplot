import type { JmapSession } from './types'
import type { AuthConfig } from './transport/http'
import { createAuthenticatedFetch } from './transport/http'
import { JmapMethodError, JmapAuthError, JmapNetworkError } from './errors'

const URN_MAIL = 'urn:ietf:params:jmap:mail'
const URN_WEBSOCKET = 'urn:ietf:params:jmap:websocket'

/**
 * Discovers and validates the JMAP session at sessionUrl.
 *
 * Deliberately does NOT use JamClient.session: jmap-jam@0.13.3 ignores any
 * injected fetch (its ClientConfig has no `fetch` option) and its
 * loadSession() never checks response.ok before parsing the body, so a real
 * 401/403 with a valid JSON error body would be silently treated as if it
 * were the session object. Performing the fetch here, through
 * createAuthenticatedFetch, makes the auth/network error classification and
 * the "never mutate globalThis.fetch" invariant actually apply to session
 * discovery.
 */
export async function discoverSession(
  sessionUrl: string,
  auth: AuthConfig,
): Promise<JmapSession> {
  const authenticatedFetch = createAuthenticatedFetch(sessionUrl, auth)

  let response: Response
  try {
    response = await authenticatedFetch(sessionUrl, {
      headers: { Accept: 'application/json' },
    })
  } catch (err: unknown) {
    if (err instanceof JmapAuthError || err instanceof JmapNetworkError) {
      throw err
    }
    throw new JmapNetworkError(
      'Network error during JMAP session discovery',
      err,
    )
  }

  if (!response.ok) {
    throw new JmapMethodError(
      'openSession',
      'networkOrServerFail',
      `Session discovery failed with status ${response.status}`,
    )
  }

  let raw: unknown
  try {
    raw = await response.json()
  } catch {
    throw new JmapMethodError(
      'openSession',
      'invalidSession',
      'Failed to parse the JMAP session response as JSON.',
    )
  }

  const session = raw as Record<string, unknown> | null | undefined
  if (!session) {
    throw new JmapMethodError(
      'openSession',
      'invalidSession',
      'Failed to retrieve JMAP session object.',
    )
  }

  // Find the primary account for mail
  const primaryAccounts =
    (session.primaryAccounts as Record<string, string> | undefined) || {}
  const mailAccountId = primaryAccounts[URN_MAIL]

  if (!mailAccountId) {
    throw new JmapMethodError(
      'openSession',
      'missingCapability',
      'Server does not support JMAP Mail or no primary account configured.',
    )
  }

  const accounts = session.accounts as Record<string, unknown> | undefined
  const account = accounts?.[mailAccountId]
  if (!account) {
    throw new JmapMethodError(
      'openSession',
      'invalidSession',
      `Primary account ${mailAccountId} not found in session.accounts.`,
    )
  }

  // Extract endpoints
  const apiUrl = (session.apiUrl as string | undefined) || ''
  const downloadUrl = (session.downloadUrl as string | undefined) || ''
  const uploadUrl = (session.uploadUrl as string | undefined) || ''
  const eventSourceUrl = (session.eventSourceUrl as string | undefined) || ''

  if (!apiUrl || !downloadUrl || !uploadUrl || !eventSourceUrl) {
    throw new JmapMethodError(
      'openSession',
      'invalidSession',
      'Server returned empty URLs for essential endpoints (apiUrl, downloadUrl, uploadUrl, or eventSourceUrl).',
    )
  }

  const capabilities =
    (session.capabilities as Record<string, unknown> | undefined) || {}

  // RFC 8887 push endpoint (ADR-006): extracted from the websocket
  // capability, never from eventSourceUrl (that's the unrelated SSE
  // endpoint jmap-jam's EventSource support would use).
  const webSocketCapability = capabilities[URN_WEBSOCKET] as
    Record<string, unknown> | undefined
  const webSocketUrl =
    typeof webSocketCapability?.url === 'string'
      ? webSocketCapability.url
      : null

  return {
    apiUrl,
    downloadUrl,
    uploadUrl,
    eventSourceUrl,
    webSocketUrl,
    primaryAccounts,
    capabilities,
  }
}
