import { describe, it, expect, vi } from 'vitest'
import { toDomainAttachmentRefs } from '../to-domain-attachment-refs'
import {
  accountKeyFromString,
  jmapEmailIdFromString,
  scopedEmailId,
} from '../../../domain/ids'
import type { JmapAttachment } from '../../../jmap/types'

const accountKey = accountKeyFromString('acc-1')
const emailId = scopedEmailId(accountKey, jmapEmailIdFromString('email-1'))

function makeRawAttachment(
  overrides: Partial<JmapAttachment> = {},
): JmapAttachment {
  return {
    blobId: 'blob-att-1',
    partId: 'part-1',
    name: 'file.pdf',
    mediaType: 'application/pdf',
    size: 2048,
    disposition: 'attachment',
    cid: null,
    ...overrides,
  }
}

describe('toDomainAttachmentRefs', () => {
  it('maps a well-formed attachment list', () => {
    const refs = toDomainAttachmentRefs(accountKey, emailId, [
      makeRawAttachment(),
    ])

    expect(refs).toHaveLength(1)
    expect(refs[0]).toEqual({
      emailId,
      partId: 'part-1',
      blobId: { accountKey, jmapId: 'blob-att-1' },
      name: 'file.pdf',
      mediaType: 'application/pdf',
      size: 2048,
      disposition: 'attachment',
      cid: null,
    })
  })

  it('returns an empty array for an empty input, materializing "cached []" not "not cached"', () => {
    expect(toDomainAttachmentRefs(accountKey, emailId, [])).toEqual([])
  })

  it('skips (does not fabricate) an attachment with a null partId', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const refs = toDomainAttachmentRefs(accountKey, emailId, [
      makeRawAttachment({ partId: null }),
    ])

    expect(refs).toEqual([])
    expect(warnSpy).toHaveBeenCalled()
  })

  it('skips (does not fabricate) an attachment with a multipart mediaType (Domain rejects it)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const refs = toDomainAttachmentRefs(accountKey, emailId, [
      makeRawAttachment({ mediaType: 'multipart/mixed' }),
    ])

    expect(refs).toEqual([])
    expect(warnSpy).toHaveBeenCalled()
  })

  it('keeps valid attachments and skips only the invalid one in a mixed list', () => {
    const refs = toDomainAttachmentRefs(accountKey, emailId, [
      makeRawAttachment({ partId: 'part-1' }),
      makeRawAttachment({ partId: null }),
      makeRawAttachment({ partId: 'part-3', blobId: 'blob-att-3' }),
    ])

    expect(refs.map((r) => r.partId)).toEqual(['part-1', 'part-3'])
  })
})
