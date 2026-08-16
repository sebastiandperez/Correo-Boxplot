import { describe, expect, it } from 'vitest'

import {
  attachmentPartIdFromString,
  attachmentRef,
  type AttachmentPartId,
  type AttachmentRef,
} from '../attachment-ref'
import {
  accountKeyFromString,
  jmapBlobIdFromString,
  jmapEmailIdFromString,
  jmapMailboxIdFromString,
  scopedBlobId,
  scopedEmailId,
  scopedMailboxId,
} from '../ids'

type OptionalKeys<Value> = {
  [Key in keyof Value]-?: Record<never, never> extends Pick<Value, Key>
    ? Key
    : never
}[keyof Value]

function expectNever<Value extends never>(value?: Value): void {
  void value
}

const accountKey = accountKeyFromString('account')
const emailId = scopedEmailId(accountKey, jmapEmailIdFromString('email'))
const blobId = scopedBlobId(accountKey, jmapBlobIdFromString('blob'))
const validRef: AttachmentRef = {
  emailId,
  partId: attachmentPartIdFromString('1'),
  blobId,
  name: null,
  mediaType: 'application/octet-stream',
  size: 0,
  disposition: null,
  cid: null,
}

describe('D-10 compile-time invariants', () => {
  it('keeps AttachmentPartId nominally distinct', () => {
    const partId = attachmentPartIdFromString('1')

    // @ts-expect-error Raw strings require attachmentPartIdFromString.
    const rawPartId: AttachmentPartId = '1'
    // @ts-expect-error AccountKey is not an AttachmentPartId.
    const accountAsPartId: AttachmentPartId = accountKey

    expect([partId, rawPartId, accountAsPartId]).toHaveLength(3)
  })

  it('requires every AttachmentRef field', () => {
    expectNever<OptionalKeys<AttachmentRef>>()

    const { emailId: omittedEmailId, ...withoutEmailId } = validRef
    const { partId: omittedPartId, ...withoutPartId } = validRef
    const { blobId: omittedBlobId, ...withoutBlobId } = validRef
    const { name: omittedName, ...withoutName } = validRef
    const { mediaType: omittedMediaType, ...withoutMediaType } = validRef
    const { size: omittedSize, ...withoutSize } = validRef
    const { disposition: omittedDisposition, ...withoutDisposition } = validRef
    const { cid: omittedCid, ...withoutCid } = validRef

    // @ts-expect-error AttachmentRef requires emailId.
    const missingEmailId: AttachmentRef = withoutEmailId
    // @ts-expect-error AttachmentRef requires partId.
    const missingPartId: AttachmentRef = withoutPartId
    // @ts-expect-error AttachmentRef requires blobId.
    const missingBlobId: AttachmentRef = withoutBlobId
    // @ts-expect-error AttachmentRef requires name, even when null.
    const missingName: AttachmentRef = withoutName
    // @ts-expect-error AttachmentRef requires mediaType.
    const missingMediaType: AttachmentRef = withoutMediaType
    // @ts-expect-error AttachmentRef requires size.
    const missingSize: AttachmentRef = withoutSize
    // @ts-expect-error AttachmentRef requires disposition, even when null.
    const missingDisposition: AttachmentRef = withoutDisposition
    // @ts-expect-error AttachmentRef requires cid, even when null.
    const missingCid: AttachmentRef = withoutCid

    expect([
      omittedEmailId,
      omittedPartId,
      omittedBlobId,
      omittedName,
      omittedMediaType,
      omittedSize,
      omittedDisposition,
      omittedCid,
      missingEmailId,
      missingPartId,
      missingBlobId,
      missingName,
      missingMediaType,
      missingSize,
      missingDisposition,
      missingCid,
    ]).toHaveLength(16)
  })

  it('rejects identities from the wrong semantic categories', () => {
    const mailboxId = scopedMailboxId(
      accountKey,
      jmapMailboxIdFromString('mailbox'),
    )

    // @ts-expect-error AttachmentRef.emailId requires ScopedEmailId.
    const mailboxAsEmail: AttachmentRef = { ...validRef, emailId: mailboxId }
    // @ts-expect-error AttachmentRef.blobId requires ScopedBlobId.
    const emailAsBlob: AttachmentRef = { ...validRef, blobId: emailId }
    // @ts-expect-error AttachmentRef.emailId cannot be a raw string.
    const rawEmail: AttachmentRef = { ...validRef, emailId: 'email' }
    // @ts-expect-error AttachmentRef.blobId cannot be a raw string.
    const rawBlob: AttachmentRef = { ...validRef, blobId: 'blob' }

    expect([mailboxAsEmail, emailAsBlob, rawEmail, rawBlob]).toHaveLength(4)
  })

  it('uses null rather than undefined for absent metadata', () => {
    expect(() =>
      attachmentRef({ ...validRef, name: null, disposition: null, cid: null }),
    ).not.toThrow()

    // @ts-expect-error AttachmentRef.name uses null, not undefined.
    const undefinedName: AttachmentRef = { ...validRef, name: undefined }
    const undefinedDisposition: AttachmentRef = {
      ...validRef,
      // @ts-expect-error AttachmentRef.disposition uses null, not undefined.
      disposition: undefined,
    }
    // @ts-expect-error AttachmentRef.cid uses null, not undefined.
    const undefinedCid: AttachmentRef = { ...validRef, cid: undefined }

    expect([undefinedName, undefinedDisposition, undefinedCid]).toHaveLength(3)
  })

  it('keeps every AttachmentRef field readonly', () => {
    const value = attachmentRef(validRef)

    if (false) {
      // @ts-expect-error AttachmentRef.emailId is readonly.
      value.emailId = emailId
      // @ts-expect-error AttachmentRef.partId is readonly.
      value.partId = attachmentPartIdFromString('2')
      // @ts-expect-error AttachmentRef.blobId is readonly.
      value.blobId = blobId
      // @ts-expect-error AttachmentRef.name is readonly.
      value.name = null
      // @ts-expect-error AttachmentRef.mediaType is readonly.
      value.mediaType = 'text/plain'
      // @ts-expect-error AttachmentRef.size is readonly.
      value.size = 1
      // @ts-expect-error AttachmentRef.disposition is readonly.
      value.disposition = 'inline'
      // @ts-expect-error AttachmentRef.cid is readonly.
      value.cid = 'cid'
    }

    expect(value).toBeDefined()
  })

  it('rejects inline infrastructure and unrelated metadata concepts', () => {
    // @ts-expect-error AttachmentRef has no independent Attachment ID.
    attachmentRef({ ...validRef, attachmentId: 'attachment' })
    // @ts-expect-error Account scope comes from emailId and blobId.
    attachmentRef({ ...validRef, accountKey })
    // @ts-expect-error AttachmentRef does not retain a live Email.
    attachmentRef({ ...validRef, email: null })
    // @ts-expect-error AttachmentRef does not retain a Blob entity.
    attachmentRef({ ...validRef, blob: null })
    // @ts-expect-error AttachmentRef stores no bytes.
    attachmentRef({ ...validRef, bytes: new Uint8Array() })
    // @ts-expect-error AttachmentRef stores no binary data.
    attachmentRef({ ...validRef, data: '' })
    // @ts-expect-error AttachmentRef stores no base64 payload.
    attachmentRef({ ...validRef, base64: '' })
    // @ts-expect-error Filesystem paths are infrastructure concerns.
    attachmentRef({ ...validRef, localPath: '/tmp/file' })
    // @ts-expect-error Download URLs are constructed by infrastructure.
    attachmentRef({ ...validRef, downloadUrl: 'https://example.test' })
    // @ts-expect-error Download status is not AttachmentRef metadata.
    attachmentRef({ ...validRef, downloadStatus: 'notDownloaded' })
    // @ts-expect-error Fetch timestamps are outside AttachmentRef.
    attachmentRef({ ...validRef, fetchedAt: 'now' })
    // @ts-expect-error Cache timestamps are outside AttachmentRef.
    attachmentRef({ ...validRef, cachedAt: 'now' })
    // @ts-expect-error Update timestamps are outside AttachmentRef.
    attachmentRef({ ...validRef, updatedAt: 'now' })
    // @ts-expect-error Charset is outside attachment metadata MVP.
    attachmentRef({ ...validRef, charset: 'utf-8' })
    // @ts-expect-error Language is outside attachment metadata MVP.
    attachmentRef({ ...validRef, language: ['en'] })
    // @ts-expect-error Content-Location is outside attachment metadata MVP.
    attachmentRef({ ...validRef, location: 'file' })
    // @ts-expect-error MIME headers are transport details.
    attachmentRef({ ...validRef, headers: [] })
    // @ts-expect-error AttachmentRef is a leaf and has no subparts.
    attachmentRef({ ...validRef, subParts: [] })
    // @ts-expect-error JMAP bodyValues are transport details.
    attachmentRef({ ...validRef, bodyValues: {} })
    // @ts-expect-error MIME bodyStructure is outside AttachmentRef.
    attachmentRef({ ...validRef, bodyStructure: null })
    // @ts-expect-error Disposition/CID are authoritative instead of isInline.
    attachmentRef({ ...validRef, isInline: false })
    // @ts-expect-error Downloadability is not stored Domain state.
    attachmentRef({ ...validRef, isDownloadable: true })
    // @ts-expect-error Email.hasAttachment remains independent.
    attachmentRef({ ...validRef, hasAttachment: true })
    // @ts-expect-error Collection availability is outside an individual ref.
    attachmentRef({ ...validRef, attachmentAvailability: 'loaded' })

    expect(true).toBe(true)
  })
})
