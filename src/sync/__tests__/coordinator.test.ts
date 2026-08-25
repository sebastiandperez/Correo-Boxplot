/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { Coordinator } from '../coordinator'
import type { JmapClient } from '../../jmap/client'
import type { SyncPort } from '../../ports/sync-port'
import { JmapMethodError } from '../../jmap/errors'

describe('Coordinator', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  const mockClient = {
    getEmailChanges: vi.fn(),
    queryEmails: vi.fn(),
  } as unknown as JmapClient

  const mockSyncPort = {
    applyCollectionSync: vi.fn(),
  } as unknown as SyncPort

  const coordinator = new Coordinator(mockClient, mockSyncPort)

  // Whether a resolved delta needs a `cannotCalculateChanges` detection is
  // the JmapClient implementation's job, not the Coordinator's: JamClientAdapter
  // delegates to mail/email-changes.ts::getEmailChanges, which already throws
  // a JmapMethodError for that case (see mail-api.test.ts). The Coordinator
  // only ever sees a resolved JmapDelta or a rejected promise — it can't
  // "directly" receive cannotCalculateChanges on a resolved value, so that
  // case belongs to the client layer, not here.
  it('should trigger a hard reset when JMAP throws a cannotCalculateChanges MethodError', async () => {
    mockClient.getEmailChanges = vi
      .fn()
      .mockRejectedValue(
        new JmapMethodError(
          'Email/changes',
          'cannotCalculateChanges',
          'State is lost',
        ),
      )

    const resetSpy = vi
      .spyOn(coordinator as any, 'performHardReset')
      .mockResolvedValue(undefined)

    await coordinator.syncEmails('acc-key-1' as any, 'acc1', 's1')

    expect(resetSpy).toHaveBeenCalledWith('acc-key-1', 'acc1')
  })

  it('should isolate search from sync state', async () => {
    mockClient.queryEmails = vi.fn().mockResolvedValue({
      ids: ['e1'],
      total: 1,
      position: 0,
      queryState: 'q1',
      canCalculateChanges: true,
    })

    // searchEmails passes `query` through opaquely — shaping user input
    // into a filter (e.g. free text -> { text }) is the caller's job, not
    // the Coordinator's, so the test passes an already-built filter.
    const result = await coordinator.searchEmails('acc1', 'mb1', {
      text: 'hello',
    })

    expect(mockClient.queryEmails).toHaveBeenCalledWith('acc1', 'mb1', {
      text: 'hello',
    })
    expect(result.ids).toEqual(['e1'])
    // No SyncPort state changes should occur from a search
    expect(mockSyncPort.applyCollectionSync).not.toHaveBeenCalled()
  })
})
