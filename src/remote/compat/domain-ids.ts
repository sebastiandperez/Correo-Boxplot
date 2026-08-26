import {
  jmapBlobIdFromString,
  jmapEmailIdFromString,
  jmapIdentityIdFromString,
  jmapMailboxIdFromString,
  jmapThreadIdFromString,
  scopedBlobId,
  scopedEmailId,
  scopedIdentityId,
  scopedMailboxId,
  scopedThreadId,
  type AccountKey,
  type ScopedBlobId,
  type ScopedEmailId,
  type ScopedIdentityId,
  type ScopedMailboxId,
  type ScopedThreadId,
} from '../../domain/ids'
import { collectionSyncStateFromString } from '../../domain/sync-cursor'
import {
  remoteBlobIdFromString,
  remoteEmailIdFromString,
  remoteIdentityIdFromString,
  remoteMailboxIdFromString,
  remoteThreadIdFromString,
  type RemoteBlobId,
  type RemoteEmailId,
  type RemoteIdentityId,
  type RemoteMailboxId,
  type RemoteSyncState,
  type RemoteThreadId,
} from '../types'

/**
 * The local `Jmap*` spelling is frozen compatibility vocabulary in Domain,
 * IPC and persistence. Remote code uses protocol-neutral `Remote*` IDs and
 * crosses into the frozen local representation only through this module.
 */
export function localEmailId(
  accountKey: AccountKey,
  id: RemoteEmailId,
): ScopedEmailId {
  return scopedEmailId(accountKey, jmapEmailIdFromString(id))
}

export function localMailboxId(
  accountKey: AccountKey,
  id: RemoteMailboxId,
): ScopedMailboxId {
  return scopedMailboxId(accountKey, jmapMailboxIdFromString(id))
}

export function localIdentityId(
  accountKey: AccountKey,
  id: RemoteIdentityId,
): ScopedIdentityId {
  return scopedIdentityId(accountKey, jmapIdentityIdFromString(id))
}

export function localThreadId(
  accountKey: AccountKey,
  id: RemoteThreadId,
): ScopedThreadId {
  return scopedThreadId(accountKey, jmapThreadIdFromString(id))
}

export function localBlobId(
  accountKey: AccountKey,
  id: RemoteBlobId,
): ScopedBlobId {
  return scopedBlobId(accountKey, jmapBlobIdFromString(id))
}

export function localCollectionState(state: RemoteSyncState) {
  return collectionSyncStateFromString(state)
}

export function remoteEmailId(id: ScopedEmailId): RemoteEmailId {
  return remoteEmailIdFromString(id.jmapId)
}

export function remoteMailboxId(id: ScopedMailboxId): RemoteMailboxId {
  return remoteMailboxIdFromString(id.jmapId)
}

export function remoteIdentityId(id: ScopedIdentityId): RemoteIdentityId {
  return remoteIdentityIdFromString(id.jmapId)
}

export function remoteThreadId(id: ScopedThreadId): RemoteThreadId {
  return remoteThreadIdFromString(id.jmapId)
}

export function remoteBlobId(id: ScopedBlobId): RemoteBlobId {
  return remoteBlobIdFromString(id.jmapId)
}
