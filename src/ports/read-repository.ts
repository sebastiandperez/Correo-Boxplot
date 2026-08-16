import type { Account } from '../domain/account'
import type { AttachmentRef } from '../domain/attachment-ref'
import type { EmailBody } from '../domain/email-body'
import type { Email } from '../domain/email'
import type {
  AccountKey,
  MutationId,
  ScopedEmailId,
  ScopedIdentityId,
  ScopedMailboxId,
} from '../domain/ids'
import type { Identity } from '../domain/identity'
import type { EmailMailbox, Mailbox } from '../domain/mailbox'
import type { MailboxView, MailboxViewSpec } from '../domain/mailbox-view'
import type { PendingMutation } from '../domain/pending-mutation'
import type {
  CollectionDataType,
  CollectionSyncCursor,
} from '../domain/sync-cursor'
import type { PortResult } from './port-result'

export type LocalReadError =
  | Readonly<{ kind: 'unavailable' }>
  | Readonly<{ kind: 'corruptState' }>
  | Readonly<{ kind: 'unexpected' }>

export type ReadResult<T> = PortResult<T, LocalReadError>

/** Absence means no local representation; it makes no remote-existence claim. */
export type LocalEntityRead<T> =
  | Readonly<{
      kind: 'absent'
    }>
  | Readonly<{
      kind: 'present'
      value: T
    }>

/** A present local snapshot may be empty and makes no remote-completeness claim. */
export type OwnedSnapshotRead<T> =
  | Readonly<{
      kind: 'ownerAbsent'
    }>
  | Readonly<{
      kind: 'present'
      value: T
    }>

/** Separates an absent owner from an absent optional owned value. */
export type OwnedOptionalRead<T> =
  | Readonly<{
      kind: 'ownerAbsent'
    }>
  | Readonly<{
      kind: 'absent'
    }>
  | Readonly<{
      kind: 'present'
      value: T
    }>

/** Separates an absent owner, an unmaterialized cache, and a complete cache. */
export type OwnedCacheRead<T> =
  | Readonly<{
      kind: 'ownerAbsent'
    }>
  | Readonly<{
      kind: 'notCached'
    }>
  | Readonly<{
      kind: 'cached'
      value: T
    }>

/**
 * Shared query boundary for Application, Coordinator, and Outbox. It reads
 * snapshots from committed local state without side effects.
 *
 * Each call is internally consistent. Separate calls do not share a snapshot
 * and may observe different commits.
 *
 * Implementations rehydrate through Domain factories. Invalid physical data
 * or duplicate semantic identities produce `corruptState`; collection and
 * bulk calls never return a partial success.
 */
export interface ReadRepository {
  readAccount(
    accountKey: AccountKey,
  ): Promise<ReadResult<LocalEntityRead<Account>>>

  /** Returns unique Accounts without a semantic ordering guarantee. */
  listAccounts(): Promise<ReadResult<readonly Account[]>>

  readMailbox(
    mailboxId: ScopedMailboxId,
  ): Promise<ReadResult<LocalEntityRead<Mailbox>>>

  /** Returns unique Mailboxes without a semantic ordering guarantee. */
  listMailboxes(
    accountKey: AccountKey,
  ): Promise<ReadResult<OwnedSnapshotRead<readonly Mailbox[]>>>

  readIdentity(
    identityId: ScopedIdentityId,
  ): Promise<ReadResult<LocalEntityRead<Identity>>>

  /** Returns unique Identities without a semantic ordering guarantee. */
  listIdentities(
    accountKey: AccountKey,
  ): Promise<ReadResult<OwnedSnapshotRead<readonly Identity[]>>>

  readEmail(emailId: ScopedEmailId): Promise<ReadResult<LocalEntityRead<Email>>>

  /**
   * Preserves input length and order positionally, including duplicate IDs.
   * An empty input returns a successful empty result.
   */
  readEmails(
    emailIds: readonly ScopedEmailId[],
  ): Promise<ReadResult<readonly LocalEntityRead<Email>[]>>

  /** Returns unique memberships without a semantic ordering guarantee. */
  readEmailMemberships(
    emailId: ScopedEmailId,
  ): Promise<ReadResult<OwnedSnapshotRead<readonly EmailMailbox[]>>>

  /** A cached value is a complete EmailBody, including valid null/null content. */
  readEmailBody(
    emailId: ScopedEmailId,
  ): Promise<ReadResult<OwnedCacheRead<EmailBody>>>

  /**
   * A cached value is the complete known AttachmentRef snapshot without a
   * semantic ordering guarantee. A cached empty array is distinct from an
   * unmaterialized cache.
   */
  readAttachmentRefs(
    emailId: ScopedEmailId,
  ): Promise<ReadResult<OwnedCacheRead<readonly AttachmentRef[]>>>

  /** Looks up the exact semantic MailboxViewSpec; D-06 coverage is unchanged. */
  readMailboxView(
    spec: MailboxViewSpec,
  ): Promise<ReadResult<OwnedCacheRead<MailboxView>>>

  readCollectionSyncCursor(
    accountKey: AccountKey,
    dataType: CollectionDataType,
  ): Promise<ReadResult<OwnedOptionalRead<CollectionSyncCursor>>>

  readPendingMutation(
    accountKey: AccountKey,
    mutationId: MutationId,
  ): Promise<ReadResult<OwnedOptionalRead<PendingMutation>>>

  /** Returns unique mutations without a semantic ordering guarantee. */
  listPendingMutations(
    accountKey: AccountKey,
  ): Promise<ReadResult<OwnedSnapshotRead<readonly PendingMutation[]>>>
}
