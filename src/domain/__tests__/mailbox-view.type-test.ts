import { describe, expect, it } from 'vitest'

import {
  mailboxView,
  mailboxViewCoverageRange,
  mailboxViewFilterAll,
  mailboxViewItem,
  mailboxViewQueryStateFromString,
  mailboxViewSort,
  mailboxViewSpec,
  type MailboxView,
  type MailboxViewCoverage,
  type MailboxViewCoverageRange,
  type MailboxViewItem,
  type MailboxViewQueryState,
  type MailboxViewSpec,
} from '../mailbox-view'
import {
  accountKeyFromString,
  jmapEmailIdFromString,
  jmapMailboxIdFromString,
  scopedEmailId,
  scopedMailboxId,
} from '../ids'

type OptionalKeys<Value> = {
  [Key in keyof Value]-?: Record<never, never> extends Pick<Value, Key>
    ? Key
    : never
}[keyof Value]

function expectNever<Value extends never>(value?: Value): void {
  void value
}

function acceptSpec(value: MailboxViewSpec): MailboxViewSpec {
  return value
}

function acceptView(value: MailboxView): MailboxView {
  return value
}

function acceptItem(value: MailboxViewItem): MailboxViewItem {
  return value
}

const accountKey = accountKeyFromString('account')
const mailboxId = scopedMailboxId(
  accountKey,
  jmapMailboxIdFromString('mailbox'),
)
const emailId = scopedEmailId(accountKey, jmapEmailIdFromString('email'))
const validSpec = mailboxViewSpec(
  mailboxId,
  mailboxViewFilterAll(),
  mailboxViewSort('descending'),
)
const queryState = mailboxViewQueryStateFromString('query-state')
const validItem = mailboxViewItem(0, emailId)
const validView = mailboxView({
  spec: validSpec,
  queryState,
  total: 1,
  coverage: [mailboxViewCoverageRange(0, 1)],
  items: [validItem],
})

describe('D-06 MailboxView compile-time invariants', () => {
  it('requires every ViewSpec field and keeps it readonly', () => {
    expectNever<OptionalKeys<MailboxViewSpec>>()

    const { mailboxId: omittedMailboxId, ...withoutMailboxId } = validSpec
    const { filter: omittedFilter, ...withoutFilter } = validSpec
    const { sort: omittedSort, ...withoutSort } = validSpec

    // @ts-expect-error MailboxViewSpec requires mailboxId.
    const missingMailboxId: MailboxViewSpec = withoutMailboxId
    // @ts-expect-error MailboxViewSpec requires filter.
    const missingFilter: MailboxViewSpec = withoutFilter
    // @ts-expect-error MailboxViewSpec requires sort.
    const missingSort: MailboxViewSpec = withoutSort

    if (false) {
      // @ts-expect-error MailboxViewSpec.mailboxId is readonly.
      validSpec.mailboxId = mailboxId
      // @ts-expect-error MailboxViewSpec.filter is readonly.
      validSpec.filter = mailboxViewFilterAll()
      // @ts-expect-error MailboxViewFilterSpec.kind is readonly.
      validSpec.filter.kind = 'all'
      // @ts-expect-error MailboxViewSortSpec.direction is readonly.
      validSpec.sort.direction = 'ascending'
    }

    expect([
      omittedMailboxId,
      omittedFilter,
      omittedSort,
      missingMailboxId,
      missingFilter,
      missingSort,
    ]).toHaveLength(6)
  })

  it('rejects the wrong scoped ID category in spec and item', () => {
    // @ts-expect-error MailboxViewSpec.mailboxId requires ScopedMailboxId.
    const wrongMailboxId: MailboxViewSpec = { ...validSpec, mailboxId: emailId }
    const wrongEmailId: MailboxViewItem = {
      position: 0,
      // @ts-expect-error MailboxViewItem.emailId requires ScopedEmailId.
      emailId: mailboxId,
    }

    expect([wrongMailboxId, wrongEmailId]).toHaveLength(2)
  })

  it('requires the query-state factory and preserves nominal separation', () => {
    // @ts-expect-error Raw strings are not MailboxViewQueryState values.
    const rawState: MailboxViewQueryState = 'query-state'
    // @ts-expect-error AccountKey is not a MailboxViewQueryState.
    const accountAsState: MailboxViewQueryState = accountKey

    expect([queryState, rawState, accountAsState]).toHaveLength(3)
  })

  it('requires readonly coverage ranges and items', () => {
    expectNever<OptionalKeys<MailboxViewCoverageRange>>()
    expectNever<OptionalKeys<MailboxViewItem>>()

    const coverage: MailboxViewCoverage = [mailboxViewCoverageRange(0, 1)]

    if (false) {
      // @ts-expect-error Coverage start is readonly.
      coverage[0].start = 1
      // @ts-expect-error Coverage arrays are readonly.
      coverage.push(mailboxViewCoverageRange(2, 3))
      // @ts-expect-error MailboxViewItem.position is readonly.
      validItem.position = 1
      // @ts-expect-error MailboxViewItem.emailId is readonly.
      validItem.emailId = emailId
    }

    // @ts-expect-error Coverage range requires endExclusive.
    const missingEnd: MailboxViewCoverageRange = { start: 0 }
    // @ts-expect-error MailboxViewItem requires position.
    const missingPosition: MailboxViewItem = { emailId }
    // @ts-expect-error MailboxViewItem requires emailId.
    const missingEmail: MailboxViewItem = { position: 0 }

    expect([coverage, missingEnd, missingPosition, missingEmail]).toHaveLength(
      4,
    )
  })

  it('requires every MailboxView field and keeps arrays readonly', () => {
    expectNever<OptionalKeys<MailboxView>>()

    const { spec: omittedSpec, ...withoutSpec } = validView
    const { queryState: omittedState, ...withoutState } = validView
    const { coverage: omittedCoverage, ...withoutCoverage } = validView
    const { items: omittedItems, ...withoutItems } = validView

    // @ts-expect-error MailboxView requires spec.
    const missingSpec: MailboxView = withoutSpec
    // @ts-expect-error MailboxView requires queryState.
    const missingState: MailboxView = withoutState
    // @ts-expect-error MailboxView requires coverage.
    const missingCoverage: MailboxView = withoutCoverage
    // @ts-expect-error MailboxView requires items.
    const missingItems: MailboxView = withoutItems

    if (false) {
      // @ts-expect-error MailboxView.spec is readonly.
      validView.spec = validSpec
      // @ts-expect-error MailboxView.total is readonly.
      validView.total = 2
      // @ts-expect-error MailboxView.coverage is readonly.
      validView.coverage = []
      // @ts-expect-error MailboxView.items is readonly.
      validView.items = []
      // @ts-expect-error MailboxView.coverage is a readonly array.
      validView.coverage.push(mailboxViewCoverageRange(2, 3))
      // @ts-expect-error MailboxView.items is a readonly array.
      validView.items.push(validItem)
    }

    expect([
      omittedSpec,
      omittedState,
      omittedCoverage,
      omittedItems,
      missingSpec,
      missingState,
      missingCoverage,
      missingItems,
    ]).toHaveLength(8)
  })

  it('rejects concepts outside the semantic ViewSpec', () => {
    // @ts-expect-error ViewSpec has no redundant AccountKey.
    acceptSpec({ ...validSpec, accountKey })
    // @ts-expect-error ViewSpec has no arbitrary viewId.
    acceptSpec({ ...validSpec, viewId: 'view' })
    // @ts-expect-error ViewSpec has no filterHash authority.
    acceptSpec({ ...validSpec, filterHash: 'filter' })
    // @ts-expect-error ViewSpec has no sortHash authority.
    acceptSpec({ ...validSpec, sortHash: 'sort' })
    // @ts-expect-error Thread collapsing is outside the MVP ViewSpec.
    acceptSpec({ ...validSpec, collapseThreads: false })

    expect(true).toBe(true)
  })

  it('rejects live entities, transport state and inline Email fields', () => {
    // @ts-expect-error MailboxView does not retain a live Mailbox.
    acceptView({ ...validView, mailbox: null })
    // @ts-expect-error MailboxView does not contain Emails inline.
    acceptView({ ...validView, emails: [] })
    // @ts-expect-error canCalculateChanges is a transport hint.
    acceptView({ ...validView, canCalculateChanges: true })
    // @ts-expect-error Collection state belongs to D-07.
    acceptView({ ...validView, collectionState: 'state' })
    // @ts-expect-error lastError is operational diagnostics.
    acceptView({ ...validView, lastError: null })
    // @ts-expect-error status is operational diagnostics.
    acceptView({ ...validView, status: 'ready' })

    // @ts-expect-error MailboxViewItem references Email only by ID.
    acceptItem({ ...validItem, email: null })
    // @ts-expect-error MailboxViewItem has no inline subject.
    acceptItem({ ...validItem, subject: 'Subject' })
    // @ts-expect-error MailboxViewItem has no inline preview.
    acceptItem({ ...validItem, preview: 'Preview' })
    // @ts-expect-error MailboxViewItem has no inline body.
    acceptItem({ ...validItem, body: null })

    expect(true).toBe(true)
  })
})
