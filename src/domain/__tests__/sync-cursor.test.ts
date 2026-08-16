import { describe, expect, it } from 'vitest'

import { accountKeyFromString } from '../ids'
import {
  collectionSyncCursor,
  collectionSyncStateFromString,
  sameCollectionSyncCursorIdentity,
  type CollectionDataType,
  type CollectionSyncState,
} from '../sync-cursor'

const accountA = accountKeyFromString('account-a')
const accountB = accountKeyFromString('account-b')

function cursor(
  dataType: CollectionDataType,
  state: CollectionSyncState = collectionSyncStateFromString('S1'),
) {
  return collectionSyncCursor({ accountKey: accountA, dataType, state })
}

describe('CollectionSyncState', () => {
  it.each(['abc', '  AbC  ', '0', ' ', ''])(
    'preserves the opaque value %j exactly',
    (value) => {
      expect(collectionSyncStateFromString(value)).toBe(value)
    },
  )
})

describe('CollectionSyncCursor', () => {
  it.each<CollectionDataType>(['email', 'mailbox', 'identity'])(
    'constructs a %s collection checkpoint',
    (dataType) => {
      const state = collectionSyncStateFromString('S1')

      expect(cursor(dataType, state)).toEqual({
        accountKey: accountA,
        dataType,
        state,
      })
    },
  )

  it('treats AccountKey and dataType as identity while ignoring state', () => {
    const emailS1 = cursor('email', collectionSyncStateFromString('S1'))
    const emailS2 = cursor('email', collectionSyncStateFromString('S2'))
    const mailboxS1 = cursor('mailbox', collectionSyncStateFromString('S1'))
    const otherAccountEmail = collectionSyncCursor({
      accountKey: accountB,
      dataType: 'email',
      state: collectionSyncStateFromString('S1'),
    })

    expect(sameCollectionSyncCursorIdentity(emailS1, emailS2)).toBe(true)
    expect(sameCollectionSyncCursorIdentity(emailS1, mailboxS1)).toBe(false)
    expect(sameCollectionSyncCursorIdentity(emailS1, otherAccountEmail)).toBe(
      false,
    )
  })

  it('compares separately constructed Identity cursors by natural key', () => {
    expect(
      sameCollectionSyncCursorIdentity(cursor('identity'), cursor('identity')),
    ).toBe(true)
  })

  it('accepts an empty state as an existing opaque checkpoint', () => {
    const result = cursor('email', collectionSyncStateFromString(''))

    expect(result.state).toBe('')
  })
})
