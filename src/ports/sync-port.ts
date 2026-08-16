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
import type { MailboxView } from '../domain/mailbox-view'
import type {
  KeywordMutation,
  MailboxMembershipMutation,
  PendingMutation,
  SendMutation,
} from '../domain/pending-mutation'
import type { CollectionSyncCursor } from '../domain/sync-cursor'
import type { PortResult } from './port-result'

export type LocalWriteError =
  | Readonly<{ kind: 'unavailable' }>
  | Readonly<{ kind: 'corruptState' }>
  | Readonly<{ kind: 'conflict' }>
  | Readonly<{ kind: 'unexpected' }>

export type WriteResult<T = void> = PortResult<T, LocalWriteError>

export type CollectionCursorPrecondition =
  | Readonly<{
      kind: 'absent'
    }>
  | Readonly<{
      kind: 'matches'
      cursor: CollectionSyncCursor
    }>

type MatchingCollectionCursorPrecondition = Extract<
  CollectionCursorPrecondition,
  Readonly<{ kind: 'matches' }>
>

export type EmailSyncRecord = Readonly<{
  email: Email
  memberships: readonly EmailMailbox[]
}>

export type EmailCollectionDeltaCommit = Readonly<{
  kind: 'email'
  mode: 'delta'
  expectedCursor: MatchingCollectionCursorPrecondition
  nextCursor: CollectionSyncCursor
  changed: readonly EmailSyncRecord[]
  destroyed: readonly ScopedEmailId[]
}>

export type EmailCollectionReplaceCommit = Readonly<{
  kind: 'email'
  mode: 'replace'
  expectedCursor: CollectionCursorPrecondition
  nextCursor: CollectionSyncCursor
  snapshot: readonly EmailSyncRecord[]
}>

export type MailboxCollectionDeltaCommit = Readonly<{
  kind: 'mailbox'
  mode: 'delta'
  expectedCursor: MatchingCollectionCursorPrecondition
  nextCursor: CollectionSyncCursor
  changed: readonly Mailbox[]
  destroyed: readonly ScopedMailboxId[]
}>

export type MailboxCollectionReplaceCommit = Readonly<{
  kind: 'mailbox'
  mode: 'replace'
  expectedCursor: CollectionCursorPrecondition
  nextCursor: CollectionSyncCursor
  snapshot: readonly Mailbox[]
}>

export type IdentityCollectionDeltaCommit = Readonly<{
  kind: 'identity'
  mode: 'delta'
  expectedCursor: MatchingCollectionCursorPrecondition
  nextCursor: CollectionSyncCursor
  changed: readonly Identity[]
  destroyed: readonly ScopedIdentityId[]
}>

export type IdentityCollectionReplaceCommit = Readonly<{
  kind: 'identity'
  mode: 'replace'
  expectedCursor: CollectionCursorPrecondition
  nextCursor: CollectionSyncCursor
  snapshot: readonly Identity[]
}>

export type CollectionSyncCommit =
  | EmailCollectionDeltaCommit
  | EmailCollectionReplaceCommit
  | MailboxCollectionDeltaCommit
  | MailboxCollectionReplaceCommit
  | IdentityCollectionDeltaCommit
  | IdentityCollectionReplaceCommit

/**
 * Public write boundary for semantic atomic transitions over committed local
 * state. A successful result means the complete operation is committed and
 * visible to subsequent ReadRepository calls.
 *
 * Implementations reject invalid Domain snapshots, duplicate semantic
 * identities, account-scope mismatches, and failed semantic preconditions.
 * The port performs no networking and emits no change notifications.
 */
export interface SyncPort {
  /**
   * Registers a new Account. Repeating the same key and RemoteAccountRef may
   * succeed idempotently; the same key with another binding conflicts.
   */
  registerAccount(account: Account): Promise<WriteResult>

  /**
   * Atomically applies one normalized collection delta or replacement and its
   * next cursor. The cursor precondition is an exact compare-and-swap; state
   * tokens are opaque and MailboxView snapshots are not changed implicitly.
   * Kind/dataType, account scope, membership ownership, and semantic identity
   * uniqueness must hold; delta changed/destroyed sets must be disjoint.
   * Delta modifies the current materialization; replace supplies its complete
   * authoritative local snapshot for that Account and data type.
   */
  applyCollectionSync(commit: CollectionSyncCommit): Promise<WriteResult>

  /**
   * Replaces the complete body cache only while its Email owner exists;
   * disappearance of the owner conflicts.
   */
  cacheEmailBody(body: EmailBody): Promise<WriteResult>

  /**
   * Replaces a complete attachment cache snapshot; an empty array is cached.
   * The Email must exist, every ref must identify it, and identities are unique.
   */
  replaceAttachmentRefs(
    emailId: ScopedEmailId,
    refs: readonly AttachmentRef[],
  ): Promise<WriteResult>

  /**
   * Replaces the exact semantic ViewSpec snapshot while its Mailbox exists,
   * without ordering or interpreting queryState tokens.
   */
  replaceMailboxView(view: MailboxView): Promise<WriteResult>

  /**
   * Durably stages Send without creating an optimistic Email. The Account must
   * exist and MutationId must be unused; a current Identity row is not required.
   */
  stageSendMutation(mutation: SendMutation): Promise<WriteResult>

  /**
   * Atomically applies the keyword delta and stores the exact mutation while
   * Account and Email exist and MutationId is unused.
   */
  applyOptimisticKeywordMutation(
    mutation: KeywordMutation,
  ): Promise<WriteResult>

  /**
   * Atomically applies the membership delta and stores the exact mutation.
   * Account, Email, and referenced Mailboxes must exist, MutationId must be
   * unused, and the resulting membership set must remain non-empty.
   */
  applyOptimisticMailboxMembershipMutation(
    mutation: MailboxMembershipMutation,
  ): Promise<WriteResult>

  /**
   * Replaces a mutation only when the full committed snapshot still equals
   * expected. Identity, kind, target, and payload remain unchanged; next is a
   * valid D-08 lifecycle transition of the same semantic mutation.
   */
  replacePendingMutationIfCurrent(
    expected: PendingMutation,
    next: PendingMutation,
  ): Promise<WriteResult>

  /**
   * Removes a mutation only when its committed lifecycle is confirmed; absent
   * and every other lifecycle conflict.
   */
  removeConfirmedMutation(
    accountKey: AccountKey,
    mutationId: MutationId,
  ): Promise<WriteResult>
}
