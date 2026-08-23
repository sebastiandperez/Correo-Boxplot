import { describe, it, expect, vi } from 'vitest'
import { submitEmail } from '../submission'
import type { JamClient } from 'jmap-jam'
import { JmapMethodError } from '../../errors'
import type { SendIntent } from '../../../domain/send-intent'
import type { ScopedIdentityId } from '../../../domain/ids'

describe('JMAP Submission', () => {
  const dummyIntent: SendIntent = {
    identityId: 'scoped:id' as unknown as ScopedIdentityId,
    from: { email: 'me@example.com', name: 'Me' },
    to: [{ email: 'you@example.com', name: null }],
    cc: [],
    bcc: [],
    replyTo: [],
    subject: 'Hello',
    body: { text: 'Test text', html: null },
  }

  it('should successfully batch create and submit email', async () => {
    const mockJam = {
      request: vi
        .fn()
        .mockResolvedValueOnce([{ ids: ['drafts-mbx-1'] }])
        .mockResolvedValueOnce([
          ['Email/set', { created: { draft1: { id: 'real-email-id' } } }, 'e1'],
          [
            'EmailSubmission/set',
            { created: { sub1: { id: 'real-sub-id' } } },
            's1',
          ],
        ]),
    } as unknown as JamClient

    const result = await submitEmail(mockJam, 'acc1', dummyIntent, 'raw-id-123')

    expect(result.emailId).toBe('real-email-id')
    expect(result.submissionId).toBe('real-sub-id')

    expect(mockJam.request).toHaveBeenCalledTimes(2)
    const batchCall = vi.mocked(mockJam.request).mock
      .calls[1][0] as unknown as [
      [string, Record<string, never>],
      [
        string,
        {
          create: Record<string, { emailId: string; identityId: string }>
        },
      ],
    ]
    expect(batchCall[0][0]).toBe('Email/set')
    expect(batchCall[1][0]).toBe('EmailSubmission/set')

    // Check that EmailSubmission references the draft ID correctly
    expect(batchCall[1][1].create['sub1'].emailId).toBe('#draft1')
    expect(batchCall[1][1].create['sub1'].identityId).toBe('raw-id-123')
  })

  it('should throw JmapMethodError if email creation is too large', async () => {
    const mockJam = {
      request: vi
        .fn()
        .mockResolvedValueOnce([{ ids: ['drafts-mbx-1'] }])
        .mockResolvedValueOnce([
          [
            'Email/set',
            {
              notCreated: {
                draft1: { type: 'tooLarge', description: 'Too big' },
              },
            },
            'e1',
          ],
          ['EmailSubmission/set', {}, 's1'], // Will fail downstream but Email/set fails first
        ]),
    } as unknown as JamClient

    const errorPromise = submitEmail(mockJam, 'acc1', dummyIntent, 'raw-id-123')
    await expect(errorPromise).rejects.toThrowError(JmapMethodError)
    await expect(errorPromise).rejects.toMatchObject({ type: 'tooLarge' })
  })

  it('should throw if Drafts mailbox is not found', async () => {
    const mockJam = {
      request: vi.fn().mockResolvedValueOnce([{ ids: [] }]),
    } as unknown as JamClient

    await expect(
      submitEmail(mockJam, 'acc1', dummyIntent, 'raw-id-123'),
    ).rejects.toMatchObject({ type: 'notFound' })
  })
})
