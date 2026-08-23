import { describe, it, expect } from 'vitest'
import { extractEmailBody } from '../body-normalizer'
import { extractAttachments } from '../attachment-normalizer'
import type {
  RawJmapEmailBodyPart,
  RawJmapEmailBodyValue,
} from '../../mail/types-raw'

describe('JMAP Normalizers', () => {
  describe('extractEmailBody', () => {
    it('should extract plain text body if only text is present', () => {
      const bodyStructure: RawJmapEmailBodyPart = {
        type: 'text/plain',
        partId: 'p1',
      }
      const bodyValues: Record<string, RawJmapEmailBodyValue> = {
        p1: { value: 'Hello World' },
      }

      const result = extractEmailBody('e1', bodyStructure, bodyValues)
      expect(result).not.toBeNull()
      expect(result?.emailId).toBe('e1')
      expect(result?.text).toBe('Hello World')
      expect(result?.html).toBeNull()
    })

    it('should extract html body from multipart/alternative', () => {
      const bodyStructure: RawJmapEmailBodyPart = {
        type: 'multipart/alternative',
        subParts: [
          { type: 'text/plain', partId: 'p1' },
          { type: 'text/html', partId: 'p2' },
        ],
      }
      const bodyValues: Record<string, RawJmapEmailBodyValue> = {
        p1: { value: 'Hello Text' },
        p2: { value: '<p>Hello HTML</p>' },
      }

      const result = extractEmailBody('e2', bodyStructure, bodyValues)
      expect(result?.html).toBe('<p>Hello HTML</p>')
      expect(result?.text).toBe('Hello Text') // Extracted both as requested
    })

    it('should return null if body is truncated', () => {
      const bodyStructure: RawJmapEmailBodyPart = {
        type: 'text/plain',
        partId: 'p1',
      }
      const bodyValues: Record<string, RawJmapEmailBodyValue> = {
        p1: { value: 'Hello', isTruncated: true },
      }

      const result = extractEmailBody('e3', bodyStructure, bodyValues)
      expect(result).toBeNull()
    })

    it('should return null if body has encoding problem', () => {
      const bodyStructure: RawJmapEmailBodyPart = {
        type: 'text/html',
        partId: 'p1',
      }
      const bodyValues: Record<string, RawJmapEmailBodyValue> = {
        p1: { value: '<p>Hello</p>', isEncodingProblem: true },
      }

      const result = extractEmailBody('e4', bodyStructure, bodyValues)
      expect(result).toBeNull()
    })
  })

  describe('extractAttachments', () => {
    it('should recursively find attachments and inline files', () => {
      const bodyStructure: RawJmapEmailBodyPart = {
        type: 'multipart/mixed',
        subParts: [
          {
            type: 'multipart/alternative',
            subParts: [
              { type: 'text/plain', partId: 'p1' },
              { type: 'text/html', partId: 'p2' },
            ],
          },
          {
            type: 'image/jpeg',
            blobId: 'b1',
            size: 1000,
            cid: 'image001',
            disposition: 'inline',
          },
          {
            type: 'application/pdf',
            blobId: 'b2',
            size: 5000,
            name: 'document.pdf',
            disposition: 'attachment',
          },
          {
            type: 'application/octet-stream',
            blobId: 'b3',
            size: 200,
            // Not explicitly attachment, but not text/html or text/plain
          },
        ],
      }

      const attachments = extractAttachments(bodyStructure)

      expect(attachments).toHaveLength(3)

      const inlineImage = attachments.find((a) => a.blobId === 'b1')
      expect(inlineImage?.isInline).toBe(true)
      expect(inlineImage?.cid).toBe('image001')

      const pdf = attachments.find((a) => a.blobId === 'b2')
      expect(pdf?.name).toBe('document.pdf')
      expect(pdf?.isInline).toBe(false)

      const unknown = attachments.find((a) => a.blobId === 'b3')
      expect(unknown?.isInline).toBe(false)
    })
  })
})
