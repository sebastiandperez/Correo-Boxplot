import { describe, it, expect, vi } from 'vitest'
import { toMailboxView } from '../to-mailbox-view'
import {
  accountKeyFromString,
  jmapMailboxIdFromString,
  scopedMailboxId,
} from '../../../domain/ids'
import {
  mailboxViewFilterAll,
  mailboxViewSort,
  mailboxViewSpec,
} from '../../../domain/mailbox-view'
import type { JmapQueryResult } from '../../../jmap/types'
import { mapJmapQuery } from '../../../remote/jmap/mappers'

const accountKey = accountKeyFromString('acc-1')
const mailboxId = scopedMailboxId(
  accountKey,
  jmapMailboxIdFromString('mailbox-1'),
)
const spec = mailboxViewSpec(
  mailboxId,
  mailboxViewFilterAll(),
  mailboxViewSort('descending'),
)

function makeQueryResult(
  overrides: Partial<JmapQueryResult> = {},
): JmapQueryResult {
  return {
    ids: ['email-1', 'email-2'],
    queryState: 'query-state-1',
    total: 10,
    position: 0,
    canCalculateChanges: true,
    ...overrides,
  }
}

describe('toMailboxView', () => {
  it('builds a MailboxView with one coverage range starting at position', () => {
    const view = toMailboxView(
      spec,
      accountKey,
      mapJmapQuery(makeQueryResult()),
    )

    expect(view).not.toBeNull()
    expect(view?.total).toBe(10)
    expect(view?.queryState).toBe('query-state-1')
    expect(view?.coverage).toEqual([{ start: 0, endExclusive: 2 }])
    expect(view?.items).toEqual([
      { position: 0, emailId: { accountKey, jmapId: 'email-1' } },
      { position: 1, emailId: { accountKey, jmapId: 'email-2' } },
    ])
  })

  it('positions items starting at a non-zero position (a later page)', () => {
    const view = toMailboxView(
      spec,
      accountKey,
      mapJmapQuery(makeQueryResult({ ids: ['email-3'], position: 2 })),
    )

    expect(view?.coverage).toEqual([{ start: 2, endExclusive: 3 }])
    expect(view?.items).toEqual([
      { position: 2, emailId: { accountKey, jmapId: 'email-3' } },
    ])
  })

  it('produces an empty coverage/items MailboxView for an empty result page', () => {
    const view = toMailboxView(
      spec,
      accountKey,
      mapJmapQuery(makeQueryResult({ ids: [], total: 0 })),
    )

    expect(view).not.toBeNull()
    expect(view?.coverage).toEqual([])
    expect(view?.items).toEqual([])
  })

  it('returns null instead of throwing when position + ids.length exceeds total (a concurrent-change race)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const view = toMailboxView(
      spec,
      accountKey,
      mapJmapQuery(
        makeQueryResult({
          ids: ['email-1', 'email-2'],
          position: 9,
          total: 10,
        }),
      ),
    )

    expect(view).toBeNull()
    expect(warnSpy).toHaveBeenCalled()
  })

  it('returns null instead of throwing when the server sends an empty queryState', () => {
    const view = toMailboxView(
      spec,
      accountKey,
      mapJmapQuery(makeQueryResult({ queryState: '' })),
    )

    expect(view).toBeNull()
  })
})
