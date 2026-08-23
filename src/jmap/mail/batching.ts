import type { AuthConfig } from '../transport/http'
import { fetchJmapRaw } from '../transport/http'
import { JmapMethodError } from '../errors'
import type { QueryOptions } from './email-query'
import type { JmapEmail } from '../types'
import type { RawJmapEmail, RawJmapEmailAddress } from './types-raw'

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
        ],
      },
      'g1',
    ],
  ] as const

  let requestResult
  try {
    const response = await fetchJmapRaw(apiUrl, auth, methodCalls)
    const getResponseEntry = response.find((entry) => entry[2] === 'g1')
    requestResult = getResponseEntry ? (getResponseEntry[1] as { list?: RawJmapEmail[] }) : {}
  } catch (err: unknown) {
    throw new JmapMethodError(
      'Email/query+get',
      'networkOrServerFail',
      err instanceof Error ? err.message : String(err),
    )
  }

  const list = requestResult.list || []

  return list.map((raw) => {
    const mapAddresses = (
      rawAddrs: readonly RawJmapEmailAddress[] | null | undefined,
    ) => {
      if (!rawAddrs || rawAddrs.length === 0) return null
      return Object.freeze(
        rawAddrs.map((addr) =>
          Object.freeze({ name: addr.name, email: addr.email }),
        ),
      )
    }

    return Object.freeze({
      id: raw.id,
      blobId: raw.blobId,
      threadId: raw.threadId,
      sender: mapAddresses(raw.sender),
      from: mapAddresses(raw.from),
      replyTo: mapAddresses(raw.replyTo),
      to: mapAddresses(raw.to),
      cc: mapAddresses(raw.cc),
      bcc: mapAddresses(raw.bcc),
      subject: raw.subject ?? null,
      sentAt: raw.sentAt ?? null,
      receivedAt: raw.receivedAt,
      size: raw.size ?? 0,
      preview: raw.preview ?? '',
      hasAttachment: raw.hasAttachment ?? false,
      keywords: Object.freeze({ ...(raw.keywords || {}) }),
    })
  })
}
