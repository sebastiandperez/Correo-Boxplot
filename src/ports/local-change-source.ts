import type { AccountKey, ScopedEmailId } from '../domain/ids'
import type { MailboxViewSpec } from '../domain/mailbox-view'
import type { CollectionDataType } from '../domain/sync-cursor'
import type { PortResult } from './port-result'

export type LocalChangeSourceError =
  Readonly<{ kind: 'unavailable' }> | Readonly<{ kind: 'unexpected' }>

export type LocalChangeSourceResult<T> = PortResult<T, LocalChangeSourceError>

export type AccountsChangedHint = Readonly<{
  kind: 'accounts'
}>

export type MailboxesChangedHint = Readonly<{
  kind: 'mailboxes'
  accountKey: AccountKey
}>

export type IdentitiesChangedHint = Readonly<{
  kind: 'identities'
  accountKey: AccountKey
}>

export type EmailsChangedHint = Readonly<{
  kind: 'emails'
  accountKey: AccountKey
}>

export type EmailMembershipsChangedHint = Readonly<{
  kind: 'emailMemberships'
  accountKey: AccountKey
}>

export type EmailBodyChangedHint = Readonly<{
  kind: 'emailBody'
  emailId: ScopedEmailId
}>

export type AttachmentRefsChangedHint = Readonly<{
  kind: 'attachmentRefs'
  emailId: ScopedEmailId
}>

export type MailboxViewChangedHint = Readonly<{
  kind: 'mailboxView'
  spec: MailboxViewSpec
}>

export type SyncCursorChangedHint = Readonly<{
  kind: 'syncCursor'
  accountKey: AccountKey
  dataType: CollectionDataType
}>

export type PendingMutationsChangedHint = Readonly<{
  kind: 'pendingMutations'
  accountKey: AccountKey
}>

export type LocalChangeHint =
  | AccountsChangedHint
  | MailboxesChangedHint
  | IdentitiesChangedHint
  | EmailsChangedHint
  | EmailMembershipsChangedHint
  | EmailBodyChangedHint
  | AttachmentRefsChangedHint
  | MailboxViewChangedHint
  | SyncCursorChangedHint
  | PendingMutationsChangedHint

/** A non-empty, non-durable delivery unit; it is not a commit identity or log. */
export type LocalChangeBatch = Readonly<{
  hints: readonly [LocalChangeHint, ...LocalChangeHint[]]
}>

/** Invalidates or schedules work synchronously and returns without backpressure. */
export type LocalChangeListener = (batch: LocalChangeBatch) => void

/**
 * Unsubscription is idempotent, non-throwing, and prevents new listener
 * invocations from beginning after this method returns.
 */
export type LocalChangeSubscription = Readonly<{
  unsubscribe(): void
}>

/**
 * Source of semantic invalidation hints about already-committed local state.
 * Hints contain no state snapshots; ReadRepository remains authoritative.
 *
 * Successful subscribe resolves only once the subscription is active. Safe
 * initialization and resume therefore subscribe first and then read current
 * state. No replay exists for earlier, disconnected, or unsubscribed changes.
 *
 * While active and operational, relevant committed changes are eventually
 * covered. Delivery may be coalesced or duplicated and conveys no business
 * ordering. Failed writes produce no hint. Delivery failure cannot roll back a
 * commit, and one listener failure must not affect state or other subscribers.
 */
export interface LocalChangeSource {
  subscribe(
    listener: LocalChangeListener,
  ): Promise<LocalChangeSourceResult<LocalChangeSubscription>>
}
