import type { AuthConfig } from '../transport/http'
import { fetchJmapRaw } from '../transport/http'
import { JmapMethodError } from '../errors'
import type { RawJmapSetResponse } from './types-raw'

export async function patchEmailKeywords(
  apiUrl: string,
  auth: AuthConfig,
  accountId: string,
  emailId: string,
  keywords: Record<string, boolean>,
): Promise<void> {
  let methodResponses
  try {
    methodResponses = await fetchJmapRaw(apiUrl, auth, [
      [
        'Email/set',
        {
          accountId,
          update: {
            [emailId]: {
              keywords,
            },
          },
        },
        'e1',
      ],
    ])
  } catch (err: unknown) {
    throw new JmapMethodError(
      'Email/set',
      'networkOrServerFail',
      err instanceof Error ? err.message : String(err),
    )
  }

  const response = methodResponses.find((r) => r[2] === 'e1')
  const result = (response ? response[1] : {}) as RawJmapSetResponse

  const notUpdated = result.notUpdated
  if (notUpdated && notUpdated[emailId]) {
    const errorDetails = notUpdated[emailId]
    if (errorDetails.type === 'stateMismatch') {
      throw new JmapMethodError(
        'Email/set',
        'stateMismatch',
        errorDetails.description || 'State mismatch when updating keywords',
      )
    }
    throw new JmapMethodError(
      'Email/set',
      errorDetails.type || 'unknown',
      errorDetails.description || 'Failed to update keywords',
    )
  }
}

export async function patchEmailMailboxes(
  apiUrl: string,
  auth: AuthConfig,
  accountId: string,
  emailId: string,
  mailboxIds: Record<string, boolean>,
): Promise<void> {
  let methodResponses
  try {
    methodResponses = await fetchJmapRaw(apiUrl, auth, [
      [
        'Email/set',
        {
          accountId,
          update: {
            [emailId]: {
              mailboxIds,
            },
          },
        },
        'e1',
      ],
    ])
  } catch (err: unknown) {
    throw new JmapMethodError(
      'Email/set',
      'networkOrServerFail',
      err instanceof Error ? err.message : String(err),
    )
  }

  const response = methodResponses.find((r) => r[2] === 'e1')
  const result = (response ? response[1] : {}) as RawJmapSetResponse

  const notUpdated = result.notUpdated
  if (notUpdated && notUpdated[emailId]) {
    const errorDetails = notUpdated[emailId]
    if (errorDetails.type === 'stateMismatch') {
      throw new JmapMethodError(
        'Email/set',
        'stateMismatch',
        errorDetails.description || 'State mismatch when updating mailboxes',
      )
    }
    throw new JmapMethodError(
      'Email/set',
      errorDetails.type || 'unknown',
      errorDetails.description || 'Failed to update mailboxes',
    )
  }
}
