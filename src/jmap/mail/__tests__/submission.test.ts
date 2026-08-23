import { describe, it, expect, vi } from 'vitest'
import { submitEmail } from '../submission'
import { JmapMethodError } from '../../errors'
import type { JmapEmailDraft } from '../../types'
import * as httpMock from '../../transport/http'

describe('JMAP Submission', () => {
  const dummyDraft: JmapEmailDraft = {
    from: [{ email: 'me@example.com', name: 'Me' }],
    to: [{ email: 'you@example.com', name: null }],
    cc: [],
    bcc: [],
    replyTo: [],
    subject: 'Hello',
    textBody: 'Test text',
    htmlBody: null,
  }

  it('should successfully batch create and submit email', async () => {
    vi.spyOn(httpMock, 'fetchJmapRaw')
      .mockResolvedValueOnce([
        ['Mailbox/query', { ids: ['drafts-mbx-1'] }, 'm1'],
      ])
      .mockResolvedValueOnce([
        ['Email/set', { created: { draft1: { id: 'real-email-id' } } }, 'e1'],
        [
          'EmailSubmission/set',
          { created: { sub1: { id: 'real-sub-id' } } },
          's1',
        ],
      ])

    const result = await submitEmail(
      'http://url',
      { type: 'Bearer', token: 'a' },
      'acc1',
      dummyDraft,
      'raw-id-123',
    )

    expect(result.emailId).toBe('real-email-id')
    expect(result.submissionId).toBe('real-sub-id')

    expect(httpMock.fetchJmapRaw).toHaveBeenCalledTimes(2)
    const batchCall = vi.mocked(httpMock.fetchJmapRaw).mock
      .calls[1][2] as unknown as [
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
    vi.spyOn(httpMock, 'fetchJmapRaw')
      .mockResolvedValueOnce([
        ['Mailbox/query', { ids: ['drafts-mbx-1'] }, 'm1'],
      ])
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
      ])

    const errorPromise = submitEmail(
      'http://url',
      { type: 'Bearer', token: 'a' },
      'acc1',
      dummyDraft,
      'raw-id-123',
    )
    await expect(errorPromise).rejects.toThrowError(JmapMethodError)
    await expect(errorPromise).rejects.toMatchObject({ type: 'tooLarge' })
  })

  it('should throw if Drafts mailbox is not found', async () => {
    vi.spyOn(httpMock, 'fetchJmapRaw').mockResolvedValueOnce([
      ['Mailbox/query', { ids: [] }, 'm1'],
    ])

    await expect(
      submitEmail(
        'http://url',
        { type: 'Bearer', token: 'a' },
        'acc1',
        dummyDraft,
        'raw-id-123',
      ),
    ).rejects.toMatchObject({ type: 'notFound' })
  })
})
