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

/**
 * D-02 compliance: Email and Mailbox Domain never represent provisional
 * objects nor accept a nullable remote ID. Every Email returned from this
 * function MUST have id, blobId, threadId, and receivedAt populated.
 *
 * D-03 compliance: Empty address arrays map to null, not [].
 */
function validateAndMapEmail(raw: RawJmapEmail): JmapEmail | null {
  // D-02: Reject emails missing mandatory identity fields
  if (!raw.id || !raw.blobId || !raw.threadId) {
    console.warn(
      `[email-get] Skipping email with missing identity fields: ` +
        `id=${raw.id}, blobId=${raw.blobId}, threadId=${raw.threadId}`,
    )
    return null
  }

  // D-02: receivedAt is mandatory per Domain spec
  if (!raw.receivedAt || raw.receivedAt.length === 0) {
    console.warn(
      `[email-get] Skipping email ${raw.id}: missing receivedAt (D-02 violation)`,
    )
    return null
  }

  return Object.freeze({
    id: raw.id,
    blobId: raw.blobId,
    threadId: raw.threadId,
    // D-03: null semantics for empty address lists
    sender: mapAddresses(raw.sender),
    from: mapAddresses(raw.from),
    replyTo: mapAddresses(raw.replyTo),
    to: mapAddresses(raw.to),
    cc: mapAddresses(raw.cc),
    bcc: mapAddresses(raw.bcc),
    subject: raw.subject ?? null,
    sentAt: raw.sentAt ?? null,
    receivedAt: raw.receivedAt,
    size:
      typeof raw.size === 'number' &&
      Number.isSafeInteger(raw.size) &&
      raw.size >= 0
        ? raw.size
        : 0,
    preview: raw.preview ?? '',
    hasAttachment: raw.hasAttachment ?? false,
    keywords: Object.freeze({ ...(raw.keywords || {}) }),
  })
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

  // D-02: Filter out any partial/malformed emails instead of passing them through
  const validEmails: JmapEmail[] = []
  for (const raw of list) {
    const mapped = validateAndMapEmail(raw)
    if (mapped !== null) {
      validEmails.push(mapped)
    }
  }

  return validEmails
}
