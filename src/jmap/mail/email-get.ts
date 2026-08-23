import type { JamClient } from 'jmap-jam'
import type { JmapEmail, JmapEmailAddress } from '../types'
import type { RawJmapEmail, RawJmapEmailAddress } from './types-raw'
import { JmapMethodError } from '../errors'

const EMAIL_PROPERTIES = [
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
] as const

function mapAddresses(
  raw: RawJmapEmailAddress[] | null | undefined,
): readonly JmapEmailAddress[] | null {
  if (!raw || raw.length === 0) return null
  return Object.freeze(
    raw.map((addr) => Object.freeze({ name: addr.name, email: addr.email })),
  )
}

export async function getEmails(
  jam: JamClient,
  accountId: string,
  emailIds: string[],
): Promise<JmapEmail[]> {
  if (emailIds.length === 0) return []

  let response
  try {
    const [result] = await jam.request([
      'Email/get',
      {
        accountId,
        ids: emailIds,
        properties: EMAIL_PROPERTIES,
      },
    ])
    response = result
  } catch (err: unknown) {
    throw new JmapMethodError(
      'Email/get',
      'networkOrServerFail',
      err instanceof Error ? err.message : String(err),
    )
  }

  const list = (response.list || []) as RawJmapEmail[]

  return list.map((raw) => {
    // Keywords might be an object { "$seen": true, "$flagged": true }
    // We convert it to a Set, or just keep it as a readonly Set if we map it
    const keywordsSet = new Set<string>()
    if (raw.keywords) {
      for (const [kw, isSet] of Object.entries(raw.keywords)) {
        if (isSet) keywordsSet.add(kw)
      }
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
