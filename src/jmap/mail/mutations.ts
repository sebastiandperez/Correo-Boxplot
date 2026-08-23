import type { JamClient } from 'jmap-jam'
import { JmapMethodError } from '../errors'

export async function patchEmailKeywords(
  jam: JamClient,
  accountId: string,
  emailId: string,
  keywords: Record<string, boolean>
): Promise<void> {
  let response
  try {
    const requestResult = await jam.request(['Email/set', {
      accountId,
      update: {
        [emailId]: {
          keywords,
        }
      }
    } as any])
    response = requestResult[0]
  } catch (err: unknown) {
    throw new JmapMethodError('Email/set', 'networkOrServerFail', err instanceof Error ? err.message : String(err))
  }

  const notUpdated = (response as any).notUpdated
  if (notUpdated && notUpdated[emailId]) {
    const errorDetails = notUpdated[emailId]
    if (errorDetails.type === 'stateMismatch') {
      throw new JmapMethodError('Email/set', 'stateMismatch', errorDetails.description || 'State mismatch when updating keywords')
    }
    throw new JmapMethodError('Email/set', errorDetails.type || 'unknown', errorDetails.description || 'Failed to update keywords')
  }
}

export async function patchEmailMailboxes(
  jam: JamClient,
  accountId: string,
  emailId: string,
  mailboxIds: Record<string, boolean>
): Promise<void> {
  let response
  try {
    const requestResult = await jam.request(['Email/set', {
      accountId,
      update: {
        [emailId]: {
          mailboxIds,
        }
      }
    } as any])
    response = requestResult[0]
  } catch (err: unknown) {
    throw new JmapMethodError('Email/set', 'networkOrServerFail', err instanceof Error ? err.message : String(err))
  }

  const notUpdated = (response as any).notUpdated
  if (notUpdated && notUpdated[emailId]) {
    const errorDetails = notUpdated[emailId]
    if (errorDetails.type === 'stateMismatch') {
      throw new JmapMethodError('Email/set', 'stateMismatch', errorDetails.description || 'State mismatch when updating mailboxes')
    }
    throw new JmapMethodError('Email/set', errorDetails.type || 'unknown', errorDetails.description || 'Failed to update mailboxes')
  }
}
