import { sameScopedEmailId, type ScopedBlobId, type ScopedEmailId } from './ids'

declare const attachmentPartIdBrand: unique symbol

export type AttachmentPartId = string & {
  readonly [attachmentPartIdBrand]: 'AttachmentPartId'
}

export type AttachmentRef = Readonly<{
  emailId: ScopedEmailId
  partId: AttachmentPartId
  blobId: ScopedBlobId
  name: string | null
  mediaType: string
  size: number
  disposition: string | null
  cid: string | null
}>

export function attachmentPartIdFromString(value: string): AttachmentPartId {
  return value as AttachmentPartId
}

export function attachmentRef(input: AttachmentRef): AttachmentRef {
  if (input.emailId.accountKey !== input.blobId.accountKey) {
    throw new TypeError(
      'AttachmentRef emailId and blobId must belong to the same AccountKey',
    )
  }

  if (input.mediaType.length === 0) {
    throw new TypeError('AttachmentRef mediaType must not be empty')
  }

  if (input.mediaType.toLowerCase().startsWith('multipart/')) {
    throw new TypeError('AttachmentRef mediaType must not be multipart')
  }

  if (!Number.isSafeInteger(input.size) || input.size < 0) {
    throw new TypeError(
      'AttachmentRef size must be a non-negative safe integer',
    )
  }

  return {
    emailId: input.emailId,
    partId: input.partId,
    blobId: input.blobId,
    name: input.name,
    mediaType: input.mediaType,
    size: input.size,
    disposition: input.disposition,
    cid: input.cid,
  }
}

export function sameAttachmentRefIdentity(
  left: AttachmentRef,
  right: AttachmentRef,
): boolean {
  return (
    sameScopedEmailId(left.emailId, right.emailId) &&
    left.partId === right.partId
  )
}
