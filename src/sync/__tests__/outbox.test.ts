/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { Outbox } from '../outbox'
import type { JmapClient } from '../../jmap/client'
import type { SyncPort } from '../../ports/sync-port'
import type { SendMutation } from '../../domain/pending-mutation'
import { JmapNetworkError } from '../../jmap/errors'

describe('Outbox', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })
  const mockClient = {
    submitEmail: vi.fn(),
  } as unknown as JmapClient

  const mockSyncPort = {
    removeConfirmedMutation: vi.fn(),
  } as unknown as SyncPort

  const outbox = new Outbox(mockClient, mockSyncPort)

  const dummyMutation: SendMutation = {
    mutationId: 'mut-1' as any,
    accountKey: 'acc-key-1' as any,
    kind: 'send',
    createdAt: '2023-01-01T00:00:00Z' as any,
    lifecycle: { status: 'pending', attemptCount: 0 } as any,
    intent: {
      identityId: { accountKey: 'acc-key-1', jmapId: 'id-1' } as any,
      from: { name: 'Me', email: 'me@example.com' },
      to: [],
      cc: [],
      bcc: [],
      replyTo: [],
      subject: 'Hello',
      body: { text: 'world', html: null },
    },
  }

  it('should process SendMutation, delegate DTO mapping to draft-mapper, and confirm on success', async () => {
    mockClient.submitEmail = vi
      .fn()
      .mockResolvedValue({ emailId: 'e1', submissionId: 's1' })

    await outbox.processSendMutation('acc-key-1' as any, 'acc1', dummyMutation)

    expect(mockClient.submitEmail).toHaveBeenCalledWith(
      'acc1',
      expect.objectContaining({
        // draft-mapper.ts deliberately preserves empty recipient arrays as
        // [] for the outbound JmapEmailDraft — D-03's null-for-empty rule
        // applies to Domain Email address lists, not to this DTO.
        bcc: [],
        cc: [],
      }),
      'id-1',
    )

    expect(mockSyncPort.removeConfirmedMutation).toHaveBeenCalledWith(
      'acc-key-1',
      'mut-1',
    )
  })

  it('should throw and NOT remove mutation on network error, preserving optimistic intent', async () => {
    mockClient.submitEmail = vi
      .fn()
      .mockRejectedValue(new JmapNetworkError('Timeout'))

    await expect(
      outbox.processSendMutation('acc-key-1' as any, 'acc1', dummyMutation),
    ).rejects.toThrow(JmapNetworkError)

    expect(mockSyncPort.removeConfirmedMutation).not.toHaveBeenCalled()
  })
})
