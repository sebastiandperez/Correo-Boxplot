import { describe, it, expect, vi } from 'vitest'
import { getMailboxes } from '../mailbox'
import { queryEmails } from '../email-query'
import { getEmails } from '../email-get'
import { getEmailChanges } from '../email-changes'
import { queryAndGetEmails } from '../batching'
import { JmapMethodError } from '../../errors'
import type { JamClient } from 'jmap-jam'
import * as httpMock from '../../transport/http'

describe('JMAP Mail APIs', () => {
  it('getMailboxes should normalize response and surface the state token', async () => {
    const mockJam = {
      request: vi.fn().mockResolvedValue([
        {
          list: [
            {
              id: 'mb1',
              name: 'Inbox',
              myRights: { mayReadItems: true },
            },
          ],
          state: 'mailbox-state-1',
        },
      ]),
    } as unknown as JamClient

    const result = await getMailboxes(mockJam, 'acc1')
    expect(result.mailboxes).toHaveLength(1)
    expect(result.mailboxes[0].id).toBe('mb1')
    expect(result.mailboxes[0].rights.mayReadItems).toBe(true)
    expect(result.mailboxes[0].rights.mayAddItems).toBe(false)
    expect(result.state).toBe('mailbox-state-1')
  })

  it('queryEmails should support pagination', async () => {
    const mockJam = {
      request: vi.fn().mockResolvedValue([
        {
          ids: ['id1', 'id2'],
        },
      ]),
    } as unknown as JamClient

    const result = await queryEmails(
      mockJam,
      'acc1',
      'mb1',
      { unread: true },
      { limit: 10, position: 0 },
    )
    expect(mockJam.request).toHaveBeenCalledWith([
      'Email/query',
      {
        accountId: 'acc1',
        filter: { inMailbox: 'mb1', unread: true },
        limit: 10,
        position: 0,
      },
    ])
    expect(result.ids).toEqual(['id1', 'id2'])
  })

  it('getEmails should map properties', async () => {
    const mockJam = {
      request: vi.fn().mockResolvedValue([
        {
          list: [
            {
              id: 'email1',
              blobId: 'blob1',
              threadId: 'thread1',
              receivedAt: '2026-01-01T00:00:00Z',
              keywords: { $seen: true, $flagged: false },
              mailboxIds: { mailbox1: true },
            },
          ],
          state: 'email-state-1',
        },
      ]),
    } as unknown as JamClient

    const result = await getEmails(mockJam, 'acc1', ['email1'])
    expect(result.emails[0].id).toBe('email1')
    expect(result.state).toBe('email-state-1')

    const keywords = result.emails[0].keywords
    expect(keywords['$seen']).toBe(true)
    expect(keywords['$flagged']).toBe(false)
  })

  it('getEmails with no IDs still requests Email/get and returns server state', async () => {
    const mockJam = {
      request: vi
        .fn()
        .mockResolvedValue([{ list: [], state: 'authoritative-empty-state' }]),
    } as unknown as JamClient

    const result = await getEmails(mockJam, 'acc1', [])

    expect(mockJam.request).toHaveBeenCalledWith([
      'Email/get',
      {
        accountId: 'acc1',
        ids: [],
        properties: expect.any(Array),
      },
    ])
    expect(result).toEqual({ emails: [], state: 'authoritative-empty-state' })
  })

  it('getEmailChanges should handle deltas', async () => {
    const mockJam = {
      request: vi.fn().mockResolvedValue([
        {
          oldState: 's1',
          newState: 's2',
          hasMoreChanges: false,
          created: ['new1'],
          updated: [],
          destroyed: [],
        },
      ]),
    } as unknown as JamClient

    const result = await getEmailChanges(mockJam, 'acc1', 's1')
    expect(result.newState).toBe('s2')
    expect(result.created).toEqual(['new1'])
  })

  it('getEmailChanges should throw cannotCalculateChanges when the server signals it', async () => {
    // RFC 8621: Email/changes may respond with cannotCalculateChanges
    // instead of a delta when sinceState is too old/unknown.
    const mockJam = {
      request: vi.fn().mockResolvedValue([
        {
          type: 'cannotCalculateChanges',
          cannotCalculateChanges: true,
        },
      ]),
    } as unknown as JamClient

    await expect(
      getEmailChanges(mockJam, 'acc1', 'stale-state'),
    ).rejects.toThrow(JmapMethodError)
    await expect(
      getEmailChanges(mockJam, 'acc1', 'stale-state'),
    ).rejects.toMatchObject({ type: 'cannotCalculateChanges' })
  })

  it('queryAndGetEmails should construct batch refs', async () => {
    vi.spyOn(httpMock, 'fetchJmapRaw').mockResolvedValue([
      ['Email/query', {}, 'q1'],
      [
        'Email/get',
        {
          list: [
            {
              id: 'batch1',
              blobId: 'blob-batch1',
              threadId: 'thread-batch1',
              receivedAt: '2026-01-01T00:00:00Z',
              mailboxIds: { mailbox1: true },
            },
          ],
        },
        'g1',
      ],
    ])

    const result = await queryAndGetEmails(
      'http://url',
      { type: 'Bearer', token: 'a' },
      'acc1',
      'mb1',
      null,
      {
        limit: 5,
      },
    )

    expect(httpMock.fetchJmapRaw).toHaveBeenCalledTimes(1)
    const calls = vi.mocked(httpMock.fetchJmapRaw).mock
      .calls[0][2] as unknown as [
      [string, { limit: number }],
      [string, { '#ids': { resultOf: string } }],
    ]
    expect(calls[0][0]).toBe('Email/query')
    expect(calls[0][1].limit).toBe(5)

    // Check that g1 references q1 correctly
    expect(calls[1][1]['#ids'].resultOf).toBe('q1')

    expect(result[0].id).toBe('batch1')
  })
})
