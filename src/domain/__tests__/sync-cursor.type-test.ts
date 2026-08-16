import { describe, expect, it } from 'vitest'

import {
  accountKeyFromString,
  jmapAccountIdFromString,
  mutationIdFromString,
  serviceKeyFromString,
} from '../ids'
import {
  mailboxViewQueryStateFromString,
  type MailboxViewQueryState,
} from '../mailbox-view'
import {
  collectionSyncCursor,
  collectionSyncStateFromString,
  type CollectionDataType,
  type CollectionSyncCursor,
  type CollectionSyncState,
} from '../sync-cursor'

type OptionalKeys<Value> = {
  [Key in keyof Value]-?: Record<never, never> extends Pick<Value, Key>
    ? Key
    : never
}[keyof Value]

function expectNever<Value extends never>(value?: Value): void {
  void value
}

function acceptCursor(value: CollectionSyncCursor): CollectionSyncCursor {
  return value
}

const accountKey = accountKeyFromString('account')
const otherAccountKey = accountKeyFromString('other-account')
const state = collectionSyncStateFromString('state')
const validCursor = collectionSyncCursor({
  accountKey,
  dataType: 'email',
  state,
})

describe('D-07 CollectionSyncCursor compile-time invariants', () => {
  it('closes CollectionDataType to the three MVP collections', () => {
    const email: CollectionDataType = 'email'
    const mailbox: CollectionDataType = 'mailbox'
    const identity: CollectionDataType = 'identity'

    // @ts-expect-error Thread is not an MVP collection cursor type.
    const thread: CollectionDataType = 'thread'
    // @ts-expect-error Blob is not an MVP collection cursor type.
    const blob: CollectionDataType = 'blob'
    // @ts-expect-error EmailDelivery is outside the MVP cursor vocabulary.
    const emailDelivery: CollectionDataType = 'emailDelivery'
    // @ts-expect-error EmailSubmission is outside the MVP cursor vocabulary.
    const emailSubmission: CollectionDataType = 'emailSubmission'
    // @ts-expect-error VacationResponse is outside the MVP cursor vocabulary.
    const vacationResponse: CollectionDataType = 'vacationResponse'

    expect([
      email,
      mailbox,
      identity,
      thread,
      blob,
      emailDelivery,
      emailSubmission,
      vacationResponse,
    ]).toHaveLength(8)
  })

  it('requires the CollectionSyncState factory', () => {
    // @ts-expect-error Raw strings are not CollectionSyncState values.
    const rawState: CollectionSyncState = 'state'

    expect([state, rawState]).toHaveLength(2)
  })

  it('keeps collection state nominally separate from other values', () => {
    const queryState = mailboxViewQueryStateFromString('query-state')
    const mutationId = mutationIdFromString('mutation')

    // @ts-expect-error AccountKey is not CollectionSyncState.
    const accountAsState: CollectionSyncState = accountKey
    // @ts-expect-error MailboxViewQueryState is not CollectionSyncState.
    const queryAsCollectionState: CollectionSyncState = queryState
    // @ts-expect-error CollectionSyncState is not MailboxViewQueryState.
    const collectionAsQueryState: MailboxViewQueryState = state
    // @ts-expect-error MutationId is not CollectionSyncState.
    const mutationAsState: CollectionSyncState = mutationId

    expect([
      accountAsState,
      queryAsCollectionState,
      collectionAsQueryState,
      mutationAsState,
    ]).toHaveLength(4)
  })

  it('requires every cursor field and non-null state', () => {
    expectNever<OptionalKeys<CollectionSyncCursor>>()

    const { accountKey: omittedAccountKey, ...withoutAccountKey } = validCursor
    const { dataType: omittedDataType, ...withoutDataType } = validCursor
    const { state: omittedState, ...withoutState } = validCursor

    // @ts-expect-error CollectionSyncCursor requires AccountKey.
    const missingAccountKey: CollectionSyncCursor = withoutAccountKey
    // @ts-expect-error CollectionSyncCursor requires dataType.
    const missingDataType: CollectionSyncCursor = withoutDataType
    // @ts-expect-error CollectionSyncCursor requires state.
    const missingState: CollectionSyncCursor = withoutState
    const nullState: CollectionSyncCursor = {
      ...validCursor,
      // @ts-expect-error Cursor absence, not null state, represents no checkpoint.
      state: null,
    }
    const undefinedState: CollectionSyncCursor = {
      ...validCursor,
      // @ts-expect-error Cursor state is required and cannot be undefined.
      state: undefined,
    }

    expect([
      omittedAccountKey,
      omittedDataType,
      omittedState,
      missingAccountKey,
      missingDataType,
      missingState,
      nullState,
      undefinedState,
    ]).toHaveLength(8)
  })

  it('keeps the complete cursor snapshot readonly', () => {
    if (false) {
      // @ts-expect-error CollectionSyncCursor.accountKey is readonly.
      validCursor.accountKey = otherAccountKey
      // @ts-expect-error CollectionSyncCursor.dataType is readonly.
      validCursor.dataType = 'mailbox'
      // @ts-expect-error CollectionSyncCursor.state is readonly.
      validCursor.state = collectionSyncStateFromString('other-state')
    }

    expect(validCursor).toBeDefined()
  })

  it('rejects operational, query, transport and persistence concepts', () => {
    const queryState = mailboxViewQueryStateFromString('query-state')
    const serviceKey = serviceKeyFromString('service')
    const jmapAccountId = jmapAccountIdFromString('remote-account')

    // @ts-expect-error Query state belongs to a MailboxViewSpec, not cursor.
    acceptCursor({ ...validCursor, queryState })
    // @ts-expect-error hasMoreChanges is temporary execution control.
    acceptCursor({ ...validCursor, hasMoreChanges: false })
    // @ts-expect-error Operational status is outside CollectionSyncCursor.
    acceptCursor({ ...validCursor, status: 'ready' })
    // @ts-expect-error Operational errors are outside CollectionSyncCursor.
    acceptCursor({ ...validCursor, lastError: null })
    // @ts-expect-error Retry metadata is outside CollectionSyncCursor.
    acceptCursor({ ...validCursor, retryCount: 0 })
    // @ts-expect-error Timestamps are outside CollectionSyncCursor.
    acceptCursor({ ...validCursor, updatedAt: 'timestamp' })
    // @ts-expect-error Sync timestamps are outside CollectionSyncCursor.
    acceptCursor({ ...validCursor, lastSyncedAt: 'timestamp' })
    // @ts-expect-error Change response created IDs are transport-only.
    acceptCursor({ ...validCursor, created: [] })
    // @ts-expect-error Change response updated IDs are transport-only.
    acceptCursor({ ...validCursor, updated: [] })
    // @ts-expect-error Change response destroyed IDs are transport-only.
    acceptCursor({ ...validCursor, destroyed: [] })
    // @ts-expect-error ServiceKey is not part of cursor scope.
    acceptCursor({ ...validCursor, serviceKey })
    // @ts-expect-error JMAP Account ID is not part of cursor scope.
    acceptCursor({ ...validCursor, jmapAccountId })

    expect(true).toBe(true)
  })
})
