import type { JamClient } from 'jmap-jam'
import { JmapMethodError } from '../errors'
import type { RawJmapQueryResponse } from './types-raw'

type EmailQueryRequest = (
  call: readonly unknown[],
) => Promise<readonly [RawJmapQueryResponse]>

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
): Promise<string[]> {
  const queryFilter =
    typeof filter === 'object' && filter !== null
      ? { inMailbox: mailboxId, ...filter }
      : { inMailbox: mailboxId }

  const args: Record<string, unknown> = {
    accountId,
    filter: queryFilter,
  }

  if (options?.position !== undefined) args.position = options.position
  if (options?.limit !== undefined) args.limit = options.limit
  if (options?.anchor !== undefined) args.anchor = options.anchor
  if (options?.anchorOffset !== undefined)
    args.anchorOffset = options.anchorOffset

  let response: RawJmapQueryResponse
  try {
    const requestQuery = jam.request.bind(jam) as unknown as EmailQueryRequest
    const [result] = await requestQuery(['Email/query', args])
    response = result as RawJmapQueryResponse
  } catch (err: unknown) {
    throw new JmapMethodError(
      'Email/query',
      'networkOrServerFail',
      err instanceof Error ? err.message : String(err),
    )
  }

  return response.ids || []
}
