import type { AccountKey } from './ids'

export type CollectionDataType = 'email' | 'mailbox' | 'identity'

declare const collectionSyncStateBrand: unique symbol

export type CollectionSyncState = string & {
  readonly [collectionSyncStateBrand]: 'CollectionSyncState'
}

export type CollectionSyncCursor = Readonly<{
  accountKey: AccountKey
  dataType: CollectionDataType
  state: CollectionSyncState
}>

export function collectionSyncStateFromString(
  value: string,
): CollectionSyncState {
  return value as CollectionSyncState
}

export function collectionSyncCursor(
  input: CollectionSyncCursor,
): CollectionSyncCursor {
  return {
    accountKey: input.accountKey,
    dataType: input.dataType,
    state: input.state,
  }
}

export function sameCollectionSyncCursorIdentity(
  left: CollectionSyncCursor,
  right: CollectionSyncCursor,
): boolean {
  return (
    left.accountKey === right.accountKey && left.dataType === right.dataType
  )
}
