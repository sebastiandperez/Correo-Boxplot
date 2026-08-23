import type { JamClient } from 'jmap-jam'
import { JmapMethodError } from '../errors'
import type { QueryOptions } from './email-query'
import type { JmapEmail } from '../types'


export async function queryAndGetEmails(
  jam: JamClient,
  accountId: string,
  mailboxId: string,
  filter?: unknown,
  options?: QueryOptions
): Promise<JmapEmail[]> {
  const queryFilter = typeof filter === 'object' && filter !== null
    ? { inMailbox: mailboxId, ...filter }
    : { inMailbox: mailboxId }

  const queryArgs: Record<string, unknown> = {
    accountId,
    filter: queryFilter,
  }

  if (options?.position !== undefined) queryArgs.position = options.position
  if (options?.limit !== undefined) queryArgs.limit = options.limit
  if (options?.anchor !== undefined) queryArgs.anchor = options.anchor
  if (options?.anchorOffset !== undefined) queryArgs.anchorOffset = options.anchorOffset

  const methodCalls = [
    ['Email/query', queryArgs, 'q1'],
    ['Email/get', {
      accountId,
      '#ids': {
        resultOf: 'q1',
        name: 'Email/query',
        path: '/ids',
      },
      properties: [
        'id', 'blobId', 'threadId', 'sender', 'from', 'replyTo',
        'to', 'cc', 'bcc', 'subject', 'sentAt', 'receivedAt',
        'size', 'preview', 'hasAttachment', 'keywords',
      ],
    }, 'g1']
  ]

  let requestResult
  try {
    const response = await jam.request(methodCalls as any)
    // response is an array of method responses, each like [name, result, clientId]
    // We want the 'g1' result
    const getResponseEntry = (response as any[]).find((r) => r[2] === 'g1')
    requestResult = getResponseEntry ? getResponseEntry[1] : {}
  } catch (err: unknown) {
    throw new JmapMethodError('Email/query+get', 'networkOrServerFail', err instanceof Error ? err.message : String(err))
  }

  const list = requestResult.list || []
  
  return list.map((raw: any) => {
    const keywordsSet = new Set<string>()
    if (raw.keywords) {
      for (const [kw, isSet] of Object.entries(raw.keywords)) {
        if (isSet) keywordsSet.add(kw)
      }
    }

    const mapAddresses = (rawAddrs: any) => {
      if (!rawAddrs || rawAddrs.length === 0) return null
      return Object.freeze(rawAddrs.map((addr: any) => Object.freeze({ name: addr.name, email: addr.email })))
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
      keywords: Object.freeze(keywordsSet),
    })
  })
}
