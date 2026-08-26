import type { JamClient } from 'jmap-jam'
import type { JmapQueryResult, QueryOptions } from '../types'
import type { RawJmapQueryResponse } from './types-raw'
import { throwJmapRequestError } from '../errors'

export type { QueryOptions } from '../types'

export async function queryEmails(
  jam: JamClient,
  accountId: string,
  mailboxId: string,
  filter?: unknown,
  options?: QueryOptions,
): Promise<JmapQueryResult> {
  const queryFilter =
    typeof filter === 'object' && filter !== null
      ? { inMailbox: mailboxId, ...filter }
      : { inMailbox: mailboxId }

  const requestBody = {
    accountId,
    filter: queryFilter,
    ...(options?.position !== undefined ? { position: options.position } : {}),
    ...(options?.limit !== undefined ? { limit: options.limit } : {}),
    ...(options?.anchor !== undefined ? { anchor: options.anchor } : {}),
    ...(options?.anchorOffset !== undefined
      ? { anchorOffset: options.anchorOffset }
      : {}),
  }

  let response: RawJmapQueryResponse
  try {
    const [result] = await jam.request(['Email/query', requestBody])
    response = result as RawJmapQueryResponse
  } catch (err: unknown) {
    throwJmapRequestError('Email/query', err)
  }

  return {
    ids: response.ids || [],
    queryState: response.queryState || '',
    total: response.total ?? 0,
    position: response.position ?? 0,
    canCalculateChanges: response.canCalculateChanges ?? false,
  }
}
