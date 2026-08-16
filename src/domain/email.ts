import type { EmailAddressList } from './address'
import type { ScopedBlobId, ScopedEmailId, ScopedThreadId } from './ids'

export type KeywordSet = ReadonlySet<string>

type EmailFields = {
  id: ScopedEmailId
  blobId: ScopedBlobId
  threadId: ScopedThreadId

  sender: EmailAddressList
  from: EmailAddressList
  replyTo: EmailAddressList
  to: EmailAddressList
  cc: EmailAddressList
  bcc: EmailAddressList

  subject: string | null
  sentAt: string | null
  receivedAt: string

  size: number
  preview: string
  hasAttachment: boolean

  keywords: KeywordSet
}

export type EmailInput = Readonly<EmailFields>
export type Email = Readonly<EmailFields>

export function keywordSet(values: Iterable<string>): KeywordSet {
  const result = new Set<string>()

  for (const value of values) {
    if (value.length === 0) {
      throw new TypeError('Keyword must not be empty')
    }

    result.add(value)
  }

  return result
}

function snapshotAddressList(value: EmailAddressList): EmailAddressList {
  return value === null ? null : [...value]
}

export function email(input: EmailInput): Email {
  const accountKey = input.id.accountKey

  if (
    input.blobId.accountKey !== accountKey ||
    input.threadId.accountKey !== accountKey
  ) {
    throw new TypeError(
      'Email id, blobId, and threadId must belong to the same AccountKey',
    )
  }

  if (!Number.isSafeInteger(input.size) || input.size < 0) {
    throw new TypeError('Email size must be a non-negative safe integer')
  }

  if (input.receivedAt.length === 0) {
    throw new TypeError('Email receivedAt must not be empty')
  }

  if (input.sentAt === '') {
    throw new TypeError('Email sentAt must be null or non-empty')
  }

  return {
    id: input.id,
    blobId: input.blobId,
    threadId: input.threadId,

    sender: snapshotAddressList(input.sender),
    from: snapshotAddressList(input.from),
    replyTo: snapshotAddressList(input.replyTo),
    to: snapshotAddressList(input.to),
    cc: snapshotAddressList(input.cc),
    bcc: snapshotAddressList(input.bcc),

    subject: input.subject,
    sentAt: input.sentAt,
    receivedAt: input.receivedAt,

    size: input.size,
    preview: input.preview,
    hasAttachment: input.hasAttachment,

    keywords: keywordSet(input.keywords),
  }
}
