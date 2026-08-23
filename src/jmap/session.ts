import type { JamClient } from 'jmap-jam'
import type { JmapSession } from './types'
import { JmapMethodError } from './errors'

const URN_MAIL = 'urn:ietf:params:jmap:mail'

/**
 * Discovers and validates the JMAP session for the given client.
 * Validates that the account exists and has the required mail capabilities.
 */
export async function discoverSession(jam: JamClient): Promise<JmapSession> {
  const session = await jam.session

  if (!session) {
    throw new JmapMethodError('openSession', 'invalidSession', 'Failed to retrieve JMAP session object.')
  }

  // Find the primary account for mail
  const primaryAccounts = session.primaryAccounts || {}
  const mailAccountId = primaryAccounts[URN_MAIL]

  if (!mailAccountId) {
    throw new JmapMethodError(
      'openSession',
      'missingCapability',
      'Server does not support JMAP Mail or no primary account configured.',
    )
  }

  const account = session.accounts?.[mailAccountId]
  if (!account) {
    throw new JmapMethodError(
      'openSession',
      'invalidSession',
      `Primary account ${mailAccountId} not found in session.accounts.`,
    )
  }

  // Extract endpoints
  const apiUrl = session.apiUrl || ''
  const downloadUrl = session.downloadUrl || ''
  const uploadUrl = session.uploadUrl || ''
  const eventSourceUrl = session.eventSourceUrl || ''
  
  const capabilities = session.capabilities || {}

  // If using local Stalwart docker, URLs might contain boxplot.local which we might need to rewrite
  // but that's infrastructural and should preferably be handled at the transport layer if needed.
  // For now we pass them as provided by the server.

  return {
    apiUrl,
    downloadUrl,
    uploadUrl,
    eventSourceUrl,
    primaryAccounts,
    capabilities,
  }
}
