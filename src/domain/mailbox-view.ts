import {
  sameScopedEmailId,
  sameScopedMailboxId,
  type ScopedEmailId,
  type ScopedMailboxId,
} from './ids'

export type MailboxViewFilterSpec = Readonly<{
  kind: 'all'
}>

export type MailboxViewSortSpec = Readonly<{
  property: 'receivedAt'
  direction: 'ascending' | 'descending'
}>

export type MailboxViewSpec = Readonly<{
  mailboxId: ScopedMailboxId
  filter: MailboxViewFilterSpec
  sort: MailboxViewSortSpec
}>

declare const mailboxViewQueryStateBrand: unique symbol

export type MailboxViewQueryState = string & {
  readonly [mailboxViewQueryStateBrand]: 'MailboxViewQueryState'
}

export type MailboxViewCoverageRange = Readonly<{
  start: number
  endExclusive: number
}>

export type MailboxViewCoverage = readonly MailboxViewCoverageRange[]

export type MailboxViewItem = Readonly<{
  position: number
  emailId: ScopedEmailId
}>

export type MailboxView = Readonly<{
  spec: MailboxViewSpec
  queryState: MailboxViewQueryState
  total: number
  coverage: MailboxViewCoverage
  items: readonly MailboxViewItem[]
}>

export function mailboxViewFilterAll(): MailboxViewFilterSpec {
  return { kind: 'all' }
}

export function mailboxViewSort(
  direction: MailboxViewSortSpec['direction'],
): MailboxViewSortSpec {
  return { property: 'receivedAt', direction }
}

export function mailboxViewSpec(
  mailboxId: ScopedMailboxId,
  filter: MailboxViewFilterSpec,
  sort: MailboxViewSortSpec,
): MailboxViewSpec {
  return {
    mailboxId,
    filter: { kind: filter.kind },
    sort: { property: sort.property, direction: sort.direction },
  }
}

export function sameMailboxViewSpec(
  left: MailboxViewSpec,
  right: MailboxViewSpec,
): boolean {
  return (
    sameScopedMailboxId(left.mailboxId, right.mailboxId) &&
    left.filter.kind === right.filter.kind &&
    left.sort.property === right.sort.property &&
    left.sort.direction === right.sort.direction
  )
}

export function mailboxViewQueryStateFromString(
  value: string,
): MailboxViewQueryState {
  if (value.length === 0) {
    throw new TypeError('MailboxViewQueryState must not be empty')
  }

  return value as MailboxViewQueryState
}

function assertNonNegativeSafeInteger(value: number, fieldName: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${fieldName} must be a non-negative safe integer`)
  }
}

function assertCoverageRangeShape(range: MailboxViewCoverageRange): void {
  assertNonNegativeSafeInteger(range.start, 'Coverage start')
  assertNonNegativeSafeInteger(range.endExclusive, 'Coverage endExclusive')

  if (range.start >= range.endExclusive) {
    throw new TypeError('Coverage range must not be empty or reversed')
  }
}

export function mailboxViewCoverageRange(
  start: number,
  endExclusive: number,
): MailboxViewCoverageRange {
  const range = { start, endExclusive }
  assertCoverageRangeShape(range)
  return range
}

function assertItemPosition(position: number): void {
  assertNonNegativeSafeInteger(position, 'MailboxViewItem position')
}

export function mailboxViewItem(
  position: number,
  emailId: ScopedEmailId,
): MailboxViewItem {
  assertItemPosition(position)
  return { position, emailId }
}

function validateCoverage(coverage: MailboxViewCoverage, total: number): void {
  let previousEnd: number | null = null

  for (const range of coverage) {
    assertCoverageRangeShape(range)

    if (range.endExclusive > total) {
      throw new TypeError('Coverage range must not exceed MailboxView total')
    }

    if (previousEnd !== null && range.start <= previousEnd) {
      throw new TypeError(
        'Coverage ranges must be ordered, disjoint, and non-adjacent',
      )
    }

    previousEnd = range.endExclusive
  }
}

function validateItems(
  items: readonly MailboxViewItem[],
  accountKey: ScopedMailboxId['accountKey'],
): void {
  let previousPosition: number | null = null
  const knownEmailIds: ScopedEmailId[] = []

  for (const item of items) {
    assertItemPosition(item.position)

    if (previousPosition !== null && item.position <= previousPosition) {
      throw new TypeError(
        'MailboxViewItem positions must be strictly ascending',
      )
    }

    if (item.emailId.accountKey !== accountKey) {
      throw new TypeError(
        'MailboxViewItem emailId must belong to the View AccountKey',
      )
    }

    if (
      knownEmailIds.some((emailId) => sameScopedEmailId(emailId, item.emailId))
    ) {
      throw new TypeError('MailboxView must not contain a duplicate Email ID')
    }

    previousPosition = item.position
    knownEmailIds.push(item.emailId)
  }
}

function validateCoverageItems(
  coverage: MailboxViewCoverage,
  items: readonly MailboxViewItem[],
): void {
  let itemIndex = 0

  for (const range of coverage) {
    let expectedPosition = range.start

    while (
      itemIndex < items.length &&
      items[itemIndex].position < range.endExclusive
    ) {
      if (items[itemIndex].position !== expectedPosition) {
        throw new TypeError(
          'MailboxView coverage and item positions must match exactly',
        )
      }

      expectedPosition += 1
      itemIndex += 1
    }

    if (expectedPosition !== range.endExclusive) {
      throw new TypeError(
        'MailboxView coverage and item positions must match exactly',
      )
    }
  }

  if (itemIndex !== items.length) {
    throw new TypeError(
      'MailboxView items must not exist outside declared coverage',
    )
  }
}

export function mailboxView(input: MailboxView): MailboxView {
  assertNonNegativeSafeInteger(input.total, 'MailboxView total')
  validateCoverage(input.coverage, input.total)
  validateItems(input.items, input.spec.mailboxId.accountKey)
  validateCoverageItems(input.coverage, input.items)

  return {
    spec: mailboxViewSpec(
      input.spec.mailboxId,
      input.spec.filter,
      input.spec.sort,
    ),
    queryState: input.queryState,
    total: input.total,
    coverage: input.coverage.map((range) => ({
      start: range.start,
      endExclusive: range.endExclusive,
    })),
    items: input.items.map((item) => ({
      position: item.position,
      emailId: item.emailId,
    })),
  }
}
