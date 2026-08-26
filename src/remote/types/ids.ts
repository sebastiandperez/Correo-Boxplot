declare const remoteIdBrand: unique symbol

type RemoteId<Tag extends string> = string & {
  readonly [remoteIdBrand]: Tag
}

export type RemoteAccountId = RemoteId<'RemoteAccountId'>
export type RemoteMailboxId = RemoteId<'RemoteMailboxId'>
export type RemoteEmailId = RemoteId<'RemoteEmailId'>
export type RemoteIdentityId = RemoteId<'RemoteIdentityId'>
export type RemoteThreadId = RemoteId<'RemoteThreadId'>
export type RemoteBlobId = RemoteId<'RemoteBlobId'>
export type RemoteSyncState = RemoteId<'RemoteSyncState'>

function remoteIdFromString<Tag extends string>(
  value: string,
  name: string,
): RemoteId<Tag> {
  if (value.length === 0) {
    throw new TypeError(`${name} must not be empty`)
  }
  return value as RemoteId<Tag>
}

export function remoteAccountIdFromString(value: string): RemoteAccountId {
  return remoteIdFromString(value, 'RemoteAccountId')
}

export function remoteMailboxIdFromString(value: string): RemoteMailboxId {
  return remoteIdFromString(value, 'RemoteMailboxId')
}

export function remoteEmailIdFromString(value: string): RemoteEmailId {
  return remoteIdFromString(value, 'RemoteEmailId')
}

export function remoteIdentityIdFromString(value: string): RemoteIdentityId {
  return remoteIdFromString(value, 'RemoteIdentityId')
}

export function remoteThreadIdFromString(value: string): RemoteThreadId {
  return remoteIdFromString(value, 'RemoteThreadId')
}

export function remoteBlobIdFromString(value: string): RemoteBlobId {
  return remoteIdFromString(value, 'RemoteBlobId')
}

export function remoteSyncStateFromString(value: string): RemoteSyncState {
  return value as RemoteSyncState
}
