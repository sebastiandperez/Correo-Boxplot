import type { RemoteBody } from './body'
import type {
  RemoteAccountId,
  RemoteAttachment,
  RemoteEmail,
  RemoteEmailId,
  RemoteIdentity,
  RemoteIdentityId,
  RemoteMailbox,
  RemoteMailboxId,
  RemoteSyncState,
} from './types'

export type RemoteCollectionSync<T, Id> =
  | Readonly<{
      mode: 'replace'
      state: RemoteSyncState
      snapshot: readonly T[]
    }>
  | Readonly<{
      mode: 'delta'
      state: RemoteSyncState
      changed: readonly T[]
      destroyed: readonly Id[]
    }>

export function validateRemoteCollectionSync<T, Id extends string>(
  transition: RemoteCollectionSync<T, Id>,
  identityOf: (value: T) => Id,
): RemoteCollectionSync<T, Id> {
  const values =
    transition.mode === 'replace' ? transition.snapshot : transition.changed
  const identities = new Set<string>()
  for (const value of values) {
    const identity = identityOf(value)
    if (identities.has(identity)) {
      throw new TypeError(`Remote collection contains duplicate ID ${identity}`)
    }
    identities.add(identity)
  }
  if (transition.mode === 'delta') {
    const destroyed = new Set<string>()
    for (const identity of transition.destroyed) {
      if (destroyed.has(identity)) {
        throw new TypeError(
          `Remote collection contains duplicate destroyed ID ${identity}`,
        )
      }
      if (identities.has(identity)) {
        throw new TypeError(
          `Remote collection ID ${identity} is both changed and destroyed`,
        )
      }
      destroyed.add(identity)
    }
  }
  return transition
}

export type RemoteQueryOptions = Readonly<{
  position?: number
  limit?: number
  anchor?: RemoteEmailId
  anchorOffset?: number
}>

export type RemoteMailboxQuery = Readonly<{
  ids: readonly RemoteEmailId[]
  queryState: RemoteSyncState
  total: number
  position: number
  canCalculateChanges: boolean
}>

export type RemoteKeywordChange = Readonly<{
  add: readonly string[]
  remove: readonly string[]
}>

export type RemoteMembershipChange = Readonly<{
  add: readonly RemoteMailboxId[]
  remove: readonly RemoteMailboxId[]
}>

export interface RemoteMail {
  syncIdentities(
    accountId: RemoteAccountId,
    previousState: RemoteSyncState | null,
  ): Promise<RemoteCollectionSync<RemoteIdentity, RemoteIdentityId>>

  syncMailboxes(
    accountId: RemoteAccountId,
    previousState: RemoteSyncState | null,
  ): Promise<RemoteCollectionSync<RemoteMailbox, RemoteMailboxId>>

  syncEmails(
    accountId: RemoteAccountId,
    previousState: RemoteSyncState | null,
  ): Promise<RemoteCollectionSync<RemoteEmail, RemoteEmailId>>

  queryMailbox(
    accountId: RemoteAccountId,
    mailboxId: RemoteMailboxId,
    filter?: unknown,
    options?: RemoteQueryOptions,
  ): Promise<RemoteMailboxQuery>

  fetchBody(
    accountId: RemoteAccountId,
    emailId: RemoteEmailId,
  ): Promise<RemoteBody>

  fetchAttachments(
    accountId: RemoteAccountId,
    emailId: RemoteEmailId,
  ): Promise<readonly RemoteAttachment[]>

  applyKeywordChange(
    accountId: RemoteAccountId,
    emailId: RemoteEmailId,
    change: RemoteKeywordChange,
  ): Promise<void>

  applyMembershipChange(
    accountId: RemoteAccountId,
    emailId: RemoteEmailId,
    change: RemoteMembershipChange,
  ): Promise<void>
}
