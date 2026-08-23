import type { JamClient } from 'jmap-jam'
import type { JmapQueryResult } from '../types'
import type { RawJmapQueryResponse } from './types-raw'
import { JmapMethodError } from '../errors'

export interface QueryOptions {
  position?: number
  limit?: number
  anchor?: string
  anchorOffset?: number
}

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
    throw new JmapMethodError(
      'Email/query',
      'networkOrServerFail',
      err instanceof Error ? err.message : String(err),
    )
  }

  return {
    ids: response.ids || [],
    queryState: response.queryState || '',
    total: response.total ?? 0,
    position: response.position ?? 0,
    canCalculateChanges: response.canCalculateChanges ?? false,
  }
}
