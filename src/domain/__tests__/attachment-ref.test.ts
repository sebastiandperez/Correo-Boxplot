import { describe, expect, it } from 'vitest'

import {
  attachmentPartIdFromString,
  attachmentRef,
  sameAttachmentRefIdentity,
  type AttachmentRef,
} from '../attachment-ref'
import {
  accountKeyFromString,
  jmapBlobIdFromString,
  jmapEmailIdFromString,
  sameScopedBlobId,
  scopedBlobId,
  scopedEmailId,
  type AccountKey,
} from '../ids'

const accountA = accountKeyFromString('account-a')
const accountB = accountKeyFromString('account-b')

function emailId(value = 'email', accountKey: AccountKey = accountA) {
  return scopedEmailId(accountKey, jmapEmailIdFromString(value))
}

function blobId(value = 'blob', accountKey: AccountKey = accountA) {
  return scopedBlobId(accountKey, jmapBlobIdFromString(value))
}

function attachmentInput(): AttachmentRef {
  return {
    emailId: emailId(),
    partId: attachmentPartIdFromString('1'),
    blobId: blobId(),
    name: 'contract.pdf',
    mediaType: 'application/pdf',
    size: 512,
    disposition: 'attachment',
    cid: null,
  }
}

describe('AttachmentPartId', () => {
  it.each(['1', '', '  Part.A  '])('preserves %j exactly', (value) => {
    expect(attachmentPartIdFromString(value)).toBe(value)
  })
})

describe('AttachmentRef construction', () => {
  it('constructs a regular attachment with the exact core shape', () => {
    const input = attachmentInput()
    const result = attachmentRef(input)

    expect(result).toEqual(input)
    expect(Object.keys(result).sort()).toEqual(
      [
        'emailId',
        'partId',
        'blobId',
        'name',
        'mediaType',
        'size',
        'disposition',
        'cid',
      ].sort(),
    )
  })

  it('represents inline metadata without implementing rendering', () => {
    const result = attachmentRef({
      ...attachmentInput(),
      name: 'logo.png',
      mediaType: 'image/png',
      size: 1_024,
      disposition: 'inline',
      cid: 'logo@example',
    })

    expect(result).toMatchObject({
      name: 'logo.png',
      mediaType: 'image/png',
      size: 1_024,
      disposition: 'inline',
      cid: 'logo@example',
    })
  })

  it('preserves null nullable metadata', () => {
    const result = attachmentRef({
      ...attachmentInput(),
      name: null,
      disposition: null,
      cid: null,
    })

    expect(result.name).toBeNull()
    expect(result.disposition).toBeNull()
    expect(result.cid).toBeNull()
  })

  it('preserves empty nullable metadata distinctly from null', () => {
    const result = attachmentRef({
      ...attachmentInput(),
      name: '',
      disposition: '',
      cid: '',
    })

    expect(result.name).toBe('')
    expect(result.disposition).toBe('')
    expect(result.cid).toBe('')
  })

  it('preserves name, disposition and CID without normalization', () => {
    const result = attachmentRef({
      ...attachmentInput(),
      name: '  Report.PDF  ',
      disposition: '  Something-New  ',
      cid: ' <Logo@EXAMPLE> ',
    })

    expect(result.name).toBe('  Report.PDF  ')
    expect(result.disposition).toBe('  Something-New  ')
    expect(result.cid).toBe(' <Logo@EXAMPLE> ')
  })

  it('accepts Email and Blob IDs from the same Account', () => {
    expect(() => attachmentRef(attachmentInput())).not.toThrow()
  })

  it('rejects a Blob ID from another Account', () => {
    expect(() =>
      attachmentRef({ ...attachmentInput(), blobId: blobId('blob', accountB) }),
    ).toThrowError(TypeError)
  })

  it.each([0, 1, 512, Number.MAX_SAFE_INTEGER])('accepts size %s', (size) => {
    expect(attachmentRef({ ...attachmentInput(), size }).size).toBe(size)
  })

  it.each([
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])('rejects invalid size %s', (size) => {
    expect(() => attachmentRef({ ...attachmentInput(), size })).toThrowError(
      TypeError,
    )
  })

  it.each([
    'application/pdf',
    'image/png',
    'text/plain',
    'application/octet-stream',
    '  Application/Custom  ',
  ])('accepts and preserves mediaType %j', (mediaType) => {
    expect(attachmentRef({ ...attachmentInput(), mediaType }).mediaType).toBe(
      mediaType,
    )
  })

  it.each([
    '',
    'multipart/mixed',
    'Multipart/Alternative',
    'MULTIPART/RELATED',
  ])('rejects mediaType %j', (mediaType) => {
    expect(() =>
      attachmentRef({ ...attachmentInput(), mediaType }),
    ).toThrowError(TypeError)
  })
})

describe('AttachmentRef identity', () => {
  it('uses only Email identity and part ID', () => {
    const left = attachmentRef(attachmentInput())
    const right = attachmentRef({
      ...attachmentInput(),
      blobId: blobId('other-blob'),
      name: 'changed.bin',
      mediaType: 'application/octet-stream',
      size: 0,
      disposition: 'something-new',
      cid: 'changed@example',
    })

    expect(sameAttachmentRefIdentity(left, right)).toBe(true)
  })

  it('distinguishes different part IDs within the same Email', () => {
    const left = attachmentRef(attachmentInput())
    const right = attachmentRef({
      ...attachmentInput(),
      partId: attachmentPartIdFromString('2'),
    })

    expect(sameAttachmentRefIdentity(left, right)).toBe(false)
  })

  it('distinguishes different Emails with the same part ID', () => {
    const left = attachmentRef(attachmentInput())
    const right = attachmentRef({
      ...attachmentInput(),
      emailId: emailId('other-email'),
    })

    expect(sameAttachmentRefIdentity(left, right)).toBe(false)
  })

  it('distinguishes equal textual Email IDs under different Accounts', () => {
    const left = attachmentRef(attachmentInput())
    const right = attachmentRef({
      ...attachmentInput(),
      emailId: emailId('email', accountB),
      blobId: blobId('blob', accountB),
    })

    expect(sameAttachmentRefIdentity(left, right)).toBe(false)
  })

  it('allows one Blob to back multiple parts without merging identities', () => {
    const partA = attachmentRef({
      ...attachmentInput(),
      partId: attachmentPartIdFromString('A'),
    })
    const partC = attachmentRef({
      ...attachmentInput(),
      partId: attachmentPartIdFromString('C'),
    })

    expect(sameScopedBlobId(partA.blobId, partC.blobId)).toBe(true)
    expect(sameAttachmentRefIdentity(partA, partC)).toBe(false)
  })
})
