import { describe, it, expect, vi } from 'vitest'
import { patchEmailKeywords, patchEmailMailboxes } from '../mutations'
import type { JamClient } from 'jmap-jam'
import { JmapMethodError } from '../../errors'

describe('JMAP Mutations', () => {
  describe('patchEmailKeywords', () => {
    it('should send an update patch for keywords', async () => {
      const mockJam = {
        request: vi.fn().mockResolvedValue([{}]),
      } as unknown as JamClient

      await patchEmailKeywords(mockJam, 'acc1', 'email1', {
        $seen: true,
        $flagged: false,
      })

      expect(mockJam.request).toHaveBeenCalledTimes(1)
      const call = vi.mocked(mockJam.request).mock.calls[0][0] as unknown as [
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
      const mockJam = {
        request: vi.fn().mockResolvedValue([
          {
            notUpdated: {
              email1: { type: 'stateMismatch', description: 'mismatch' },
            },
          },
        ]),
      } as unknown as JamClient

      await expect(
        patchEmailKeywords(mockJam, 'acc1', 'email1', { $seen: true }),
      ).rejects.toThrowError(JmapMethodError)

      await expect(
        patchEmailKeywords(mockJam, 'acc1', 'email1', { $seen: true }),
      ).rejects.toMatchObject({ type: 'stateMismatch' })
    })
  })

  describe('patchEmailMailboxes', () => {
    it('should send an update patch for mailboxIds', async () => {
      const mockJam = {
        request: vi.fn().mockResolvedValue([{}]),
      } as unknown as JamClient

      await patchEmailMailboxes(mockJam, 'acc1', 'email1', {
        mbx1: true,
        mbx2: false,
      })

      expect(mockJam.request).toHaveBeenCalledTimes(1)
      const call = vi.mocked(mockJam.request).mock.calls[0][0] as unknown as [
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
