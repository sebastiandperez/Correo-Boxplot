import { describe, it, expect, vi, afterEach } from 'vitest'
import { patchEmailKeywords, patchEmailMailboxes } from '../mutations'
import { JmapMethodError } from '../../errors'
import * as httpMock from '../../transport/http'

describe('JMAP Mutations', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('patchEmailKeywords', () => {
    it('should send an update patch for keywords', async () => {
      vi.spyOn(httpMock, 'fetchJmapRaw').mockResolvedValue([['Email/set', {}, 'e1']])

      await patchEmailKeywords('http://url', { type: 'Bearer', token: 'a' }, 'acc1', 'email1', {
        $seen: true,
        $flagged: false,
      })

      expect(httpMock.fetchJmapRaw).toHaveBeenCalledTimes(1)
      const call = vi.mocked(httpMock.fetchJmapRaw).mock.calls[0][2][0] as unknown as [
        string,
        {
          update: Record<string, { keywords: Record<string, boolean> }>
        },
      ]
      expect(call[0]).toBe('Email/set')
      expect(call[1].update['email1'].keywords['$seen']).toBe(true)
      expect(call[1].update['email1'].keywords['$flagged']).toBe(false)
    })

    it('should throw JmapMethodError on stateMismatch', async () => {
      vi.spyOn(httpMock, 'fetchJmapRaw').mockResolvedValue([
        [
          'Email/set',
          {
            notUpdated: {
              email1: { type: 'stateMismatch', description: 'mismatch' },
            },
          },
          'e1',
        ],
      ])

      await expect(
        patchEmailKeywords('http://url', { type: 'Bearer', token: 'a' }, 'acc1', 'email1', { $seen: true }),
      ).rejects.toThrowError(JmapMethodError)

      await expect(
        patchEmailKeywords('http://url', { type: 'Bearer', token: 'a' }, 'acc1', 'email1', { $seen: true }),
      ).rejects.toMatchObject({ type: 'stateMismatch' })
    })
  })

  describe('patchEmailMailboxes', () => {
    it('should send an update patch for mailboxIds', async () => {
      vi.spyOn(httpMock, 'fetchJmapRaw').mockResolvedValue([['Email/set', {}, 'e1']])

      await patchEmailMailboxes('http://url', { type: 'Bearer', token: 'a' }, 'acc1', 'email1', {
        mbx1: true,
        mbx2: false,
      })

      expect(httpMock.fetchJmapRaw).toHaveBeenCalledTimes(1)
      const call = vi.mocked(httpMock.fetchJmapRaw).mock.calls[0][2][0] as unknown as [
        string,
        {
          update: Record<string, { mailboxIds: Record<string, boolean> }>
        },
      ]
      expect(call[0]).toBe('Email/set')
      expect(call[1].update['email1'].mailboxIds['mbx1']).toBe(true)
      expect(call[1].update['email1'].mailboxIds['mbx2']).toBe(false)
    })
  })
})
