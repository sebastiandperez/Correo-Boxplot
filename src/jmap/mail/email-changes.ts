import type { JamClient } from 'jmap-jam'
import type { JmapDelta } from '../types'
import type { RawJmapChangesResponse } from './types-raw'
import { JmapMethodError, throwJmapRequestError } from '../errors'

export async function getEmailChanges(
  jam: JamClient,
  accountId: string,
  sinceState: string,
): Promise<JmapDelta> {
  let response: RawJmapChangesResponse
  try {
    const requestResult = await jam.request([
      'Email/changes',
      {
        accountId,
        sinceState,
      },
    ])
    response = requestResult[0] as RawJmapChangesResponse
  } catch (err: unknown) {
    throwJmapRequestError('Email/changes', err)
  }

  // JMAP RFC 8621: Email/changes might set canCalculateChanges to false if the state is too old.
  // The 'jmap-jam' throws the method response if it's an error like cannotCalculateChanges.
  // But just in case we need to handle it:
  if ('cannotCalculateChanges' in response) {
    throw new JmapMethodError(
      'Email/changes',
      'cannotCalculateChanges',
      'Server cannot calculate changes from this state.',
    )
  }

  return {
    accountId,
    oldState: response.oldState,
    newState: response.newState,
    hasMoreChanges: response.hasMoreChanges,
    created: Object.freeze([...(response.created || [])]),
    updated: Object.freeze([...(response.updated || [])]),
    destroyed: Object.freeze([...(response.destroyed || [])]),
  }
}
