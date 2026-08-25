import type { AuthConfig } from '../transport/http'
import { fetchJmapRaw } from '../transport/http'
import { JmapMethodError } from '../errors'
import type { QueryOptions } from './email-query'
import type { JmapEmail } from '../types'
import type { RawJmapEmail } from './types-raw'
import { validateAndMapEmail } from './email-get'

export async function queryAndGetEmails(
  apiUrl: string,
  auth: AuthConfig,
  accountId: string,
  mailboxId: string,
  filter?: unknown,
  options?: QueryOptions,
): Promise<JmapEmail[]> {
  const queryFilter =
    typeof filter === 'object' && filter !== null
      ? { inMailbox: mailboxId, ...filter }
      : { inMailbox: mailboxId }

  const queryArgs: Record<string, unknown> = {
    accountId,
    filter: queryFilter,
  }

  if (options?.position !== undefined) queryArgs.position = options.position
  if (options?.limit !== undefined) queryArgs.limit = options.limit
  if (options?.anchor !== undefined) queryArgs.anchor = options.anchor
  if (options?.anchorOffset !== undefined)
    queryArgs.anchorOffset = options.anchorOffset

  const methodCalls = [
    ['Email/query', queryArgs, 'q1'],
    [
      'Email/get',
      {
        accountId,
        '#ids': {
          resultOf: 'q1',
          name: 'Email/query',
          path: '/ids',
        },
        properties: [
          'id',
          'blobId',
          'threadId',
          'sender',
          'from',
          'replyTo',
          'to',
          'cc',
          'bcc',
          'subject',
          'sentAt',
          'receivedAt',
          'size',
          'preview',
          'hasAttachment',
          'keywords',
          'mailboxIds',
        ],
      },
      'g1',
    ],
  ] as const

  let requestResult
  try {
    const response = await fetchJmapRaw(apiUrl, auth, methodCalls)
    const getResponseEntry = response.find((entry) => entry[2] === 'g1')
    requestResult = getResponseEntry
      ? (getResponseEntry[1] as { list?: RawJmapEmail[] })
      : {}
  } catch (err: unknown) {
    throw new JmapMethodError(
      'Email/query+get',
      'networkOrServerFail',
      err instanceof Error ? err.message : String(err),
    )
  }

  const list = requestResult.list || []

  // D-02: reuse the same validation as getEmails() instead of duplicating a
  // second, looser mapping — a partial/malformed email is skipped here too.
  const validEmails: JmapEmail[] = []
  for (const raw of list) {
    const mapped = validateAndMapEmail(raw)
    if (mapped !== null) {
      validEmails.push(mapped)
    }
  }

  return validEmails
}
