import { describe, expect, it } from 'vitest'

import {
  mailboxView,
  mailboxViewCoverageRange,
  mailboxViewFilterAll,
  mailboxViewItem,
  mailboxViewQueryStateFromString,
  mailboxViewSort,
  mailboxViewSpec,
  sameMailboxViewSpec,
  type MailboxView,
  type MailboxViewCoverageRange,
  type MailboxViewItem,
  type MailboxViewSpec,
} from '../mailbox-view'
import {
  accountKeyFromString,
  jmapEmailIdFromString,
  jmapMailboxIdFromString,
  scopedEmailId,
  scopedMailboxId,
  type AccountKey,
} from '../ids'

const accountA = accountKeyFromString('account-a')
const accountB = accountKeyFromString('account-b')

function viewSpec(
  accountKey: AccountKey = accountA,
  mailboxJmapId = 'mailbox',
  direction: 'ascending' | 'descending' = 'descending',
): MailboxViewSpec {
  return mailboxViewSpec(
    scopedMailboxId(accountKey, jmapMailboxIdFromString(mailboxJmapId)),
    mailboxViewFilterAll(),
    mailboxViewSort(direction),
  )
}

function viewItem(position: number, accountKey: AccountKey = accountA) {
  return mailboxViewItem(
    position,
    scopedEmailId(accountKey, jmapEmailIdFromString(`email-${position}`)),
  )
}

function itemsForRanges(
  ranges: readonly MailboxViewCoverageRange[],
): MailboxViewItem[] {
  const items: MailboxViewItem[] = []

  for (const range of ranges) {
    for (
      let position = range.start;
      position < range.endExclusive;
      position += 1
    ) {
      items.push(viewItem(position))
    }
  }

  return items
}

function constructView(
  total: number,
  coverage: readonly MailboxViewCoverageRange[],
  items: readonly MailboxViewItem[],
  spec: MailboxViewSpec = viewSpec(),
): MailboxView {
  return mailboxView({
    spec,
    queryState: mailboxViewQueryStateFromString('query-state'),
    total,
    coverage,
    items,
  })
}

describe('MailboxViewSpec', () => {
  it('constructs the all filter and both receivedAt sort directions', () => {
    expect(mailboxViewFilterAll()).toEqual({ kind: 'all' })
    expect(mailboxViewSort('ascending')).toEqual({
      property: 'receivedAt',
      direction: 'ascending',
    })
    expect(mailboxViewSort('descending')).toEqual({
      property: 'receivedAt',
      direction: 'descending',
    })
  })

  it('compares separately constructed specs by semantic value', () => {
    expect(sameMailboxViewSpec(viewSpec(), viewSpec())).toBe(true)
    expect(
      sameMailboxViewSpec(viewSpec(), viewSpec(accountA, 'other-mailbox')),
    ).toBe(false)
    expect(
      sameMailboxViewSpec(
        viewSpec(accountA, 'mailbox', 'ascending'),
        viewSpec(accountA, 'mailbox', 'descending'),
      ),
    ).toBe(false)
  })
})

describe('MailboxViewQueryState', () => {
  it('accepts a non-empty opaque value and preserves it exactly', () => {
    expect(mailboxViewQueryStateFromString('  State CASE  ')).toBe(
      '  State CASE  ',
    )
  })

  it('rejects an empty value', () => {
    expect(() => mailboxViewQueryStateFromString('')).toThrowError(TypeError)
  })
})

describe('MailboxView total and coverage', () => {
  it.each([0, Number.MAX_SAFE_INTEGER])('accepts total %s', (total) => {
    expect(constructView(total, [], []).total).toBe(total)
  })

  it.each([
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])('rejects invalid total %s', (total) => {
    expect(() => constructView(total, [], [])).toThrowError(TypeError)
  })

  it('accepts empty, contiguous and disjoint canonical coverage', () => {
    expect(constructView(100, [], []).coverage).toEqual([])

    const contiguous = [mailboxViewCoverageRange(0, 100)]
    expect(
      constructView(100, contiguous, itemsForRanges(contiguous)).coverage,
    ).toEqual(contiguous)

    const disjoint = [
      mailboxViewCoverageRange(0, 100),
      mailboxViewCoverageRange(200, 250),
    ]
    expect(
      constructView(300, disjoint, itemsForRanges(disjoint)).coverage,
    ).toEqual(disjoint)
  })

  it.each([
    [-1, 1],
    [0, 0],
    [2, 1],
    [0.5, 1],
    [0, 1.5],
    [Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER + 2],
  ])('rejects invalid coverage range [%s,%s)', (start, endExclusive) => {
    expect(() => mailboxViewCoverageRange(start, endExclusive)).toThrowError(
      TypeError,
    )
  })

  it('rejects coverage beyond total', () => {
    expect(() =>
      constructView(
        2,
        [{ start: 0, endExclusive: 3 }],
        [viewItem(0), viewItem(1), viewItem(2)],
      ),
    ).toThrowError(TypeError)
  })

  it.each([
    {
      label: 'unordered',
      coverage: [
        { start: 5, endExclusive: 6 },
        { start: 0, endExclusive: 1 },
      ],
    },
    {
      label: 'overlapping',
      coverage: [
        { start: 0, endExclusive: 3 },
        { start: 2, endExclusive: 4 },
      ],
    },
    {
      label: 'adjacent',
      coverage: [
        { start: 0, endExclusive: 2 },
        { start: 2, endExclusive: 4 },
      ],
    },
  ])('rejects $label coverage', ({ coverage }) => {
    expect(() => constructView(10, coverage, [])).toThrowError(TypeError)
  })
})

describe('MailboxView items', () => {
  it('accepts ordered items that exactly fill coverage', () => {
    const coverage = [mailboxViewCoverageRange(0, 3)]

    expect(constructView(3, coverage, itemsForRanges(coverage)).items).toEqual([
      viewItem(0),
      viewItem(1),
      viewItem(2),
    ])
  })

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid item position %s',
    (position) => {
      const emailId = scopedEmailId(accountA, jmapEmailIdFromString('email'))
      expect(() => mailboxViewItem(position, emailId)).toThrowError(TypeError)
    },
  )

  it('rejects duplicate and unordered positions', () => {
    expect(() =>
      constructView(
        2,
        [mailboxViewCoverageRange(0, 2)],
        [viewItem(0), viewItem(0)],
      ),
    ).toThrowError(TypeError)
    expect(() =>
      constructView(
        2,
        [mailboxViewCoverageRange(0, 2)],
        [viewItem(1), viewItem(0)],
      ),
    ).toThrowError(TypeError)
  })

  it('rejects duplicate Email IDs by semantic equality', () => {
    const firstId = scopedEmailId(accountA, jmapEmailIdFromString('same-email'))
    const equivalentId = scopedEmailId(
      accountA,
      jmapEmailIdFromString('same-email'),
    )

    expect(() =>
      constructView(
        2,
        [mailboxViewCoverageRange(0, 2)],
        [mailboxViewItem(0, firstId), mailboxViewItem(1, equivalentId)],
      ),
    ).toThrowError(TypeError)
  })

  it('rejects an Email from another Account', () => {
    expect(() =>
      constructView(
        1,
        [mailboxViewCoverageRange(0, 1)],
        [viewItem(0, accountB)],
      ),
    ).toThrowError(TypeError)
  })

  it('rejects items outside coverage and covered positions without items', () => {
    expect(() =>
      constructView(
        3,
        [mailboxViewCoverageRange(0, 2)],
        [viewItem(0), viewItem(1), viewItem(2)],
      ),
    ).toThrowError(TypeError)
    expect(() =>
      constructView(
        3,
        [mailboxViewCoverageRange(0, 3)],
        [viewItem(0), viewItem(2)],
      ),
    ).toThrowError(TypeError)
  })
})

describe('MailboxView partial cache and snapshots', () => {
  it('supports a partial window independently of remote total', () => {
    const coverage = [mailboxViewCoverageRange(0, 100)]
    const result = constructView(12_700, coverage, itemsForRanges(coverage))

    expect(result.total).toBe(12_700)
    expect(result.coverage).toEqual([{ start: 0, endExclusive: 100 }])
    expect(result.items).toHaveLength(100)
  })

  it('supports known total with no materialized window', () => {
    const result = constructView(12_700, [], [])

    expect(result.total).toBe(12_700)
    expect(result.coverage).toEqual([])
    expect(result.items).toEqual([])
  })

  it('snapshots spec, coverage ranges and items', () => {
    const filter: { kind: 'all' } = { kind: 'all' }
    const sort: {
      property: 'receivedAt'
      direction: 'ascending' | 'descending'
    } = { property: 'receivedAt', direction: 'ascending' }
    const sourceSpec = {
      mailboxId: scopedMailboxId(accountA, jmapMailboxIdFromString('mailbox')),
      filter,
      sort,
    }
    const sourceRange = { start: 0, endExclusive: 1 }
    const coverage = [sourceRange]
    const sourceItem = {
      position: 0,
      emailId: scopedEmailId(accountA, jmapEmailIdFromString('email-0')),
    }
    const items = [sourceItem]
    const result = constructView(2, coverage, items, sourceSpec)

    sort.direction = 'descending'
    sourceRange.endExclusive = 2
    sourceItem.position = 1
    coverage.push({ start: 1, endExclusive: 2 })
    items.push(viewItem(1))

    expect(result.spec.sort.direction).toBe('ascending')
    expect(result.coverage).toEqual([{ start: 0, endExclusive: 1 }])
    expect(result.items).toEqual([viewItem(0)])
  })
})
