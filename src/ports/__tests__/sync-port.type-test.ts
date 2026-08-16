import { describe, expect, it } from 'vitest'

import type { Account } from '../../domain/account'
import type { AttachmentRef } from '../../domain/attachment-ref'
import type { EmailBody } from '../../domain/email-body'
import type { Email } from '../../domain/email'
import type {
  AccountKey,
  MutationId,
  ScopedBlobId,
  ScopedEmailId,
  ScopedIdentityId,
  ScopedMailboxId,
} from '../../domain/ids'
import type { EmailMailbox } from '../../domain/mailbox'
import type { MailboxView } from '../../domain/mailbox-view'
import type {
  KeywordMutation,
  MailboxMembershipMutation,
  PendingMutation,
  SendMutation,
} from '../../domain/pending-mutation'
import type { CollectionSyncCursor } from '../../domain/sync-cursor'
import type {
  CollectionCursorPrecondition,
  CollectionSyncCommit,
  EmailCollectionDeltaCommit,
  EmailCollectionReplaceCommit,
  EmailSyncRecord,
  IdentityCollectionDeltaCommit,
  IdentityCollectionReplaceCommit,
  LocalWriteError,
  MailboxCollectionDeltaCommit,
  MailboxCollectionReplaceCommit,
  SyncPort,
  WriteResult,
} from '../sync-port'

function expectNever<Value extends never>(value?: Value): void {
  void value
}

function writeSuccess(): WriteResult {
  return { ok: true, value: undefined }
}

const port = {
  async registerAccount(account) {
    void account
    return writeSuccess()
  },
  async applyCollectionSync(commit) {
    void commit
    return writeSuccess()
  },
  async cacheEmailBody(body) {
    void body
    return writeSuccess()
  },
  async replaceAttachmentRefs(emailId, refs) {
    void emailId
    void refs
    return writeSuccess()
  },
  async replaceMailboxView(view) {
    void view
    return writeSuccess()
  },
  async stageSendMutation(mutation) {
    void mutation
    return writeSuccess()
  },
  async applyOptimisticKeywordMutation(mutation) {
    void mutation
    return writeSuccess()
  },
  async applyOptimisticMailboxMembershipMutation(mutation) {
    void mutation
    return writeSuccess()
  },
  async replacePendingMutationIfCurrent(expected, next) {
    void expected
    void next
    return writeSuccess()
  },
  async removeConfirmedMutation(accountKey, mutationId) {
    void accountKey
    void mutationId
    return writeSuccess()
  },
} satisfies SyncPort

describe('P-02 errors and cursor preconditions', () => {
  it('closes LocalWriteError to four payload-free categories', () => {
    const unavailable: LocalWriteError = { kind: 'unavailable' }
    const corruptState: LocalWriteError = { kind: 'corruptState' }
    const conflict: LocalWriteError = { kind: 'conflict' }
    const unexpected: LocalWriteError = { kind: 'unexpected' }

    // @ts-expect-error notFound is not a LocalWriteError category.
    const notFound: LocalWriteError = { kind: 'notFound' }
    const diagnosticPayload: LocalWriteError = {
      kind: 'unexpected',
      // @ts-expect-error LocalWriteError exposes no diagnostic payload.
      message: 'details',
    }

    expect([
      unavailable,
      corruptState,
      conflict,
      unexpected,
      notFound,
      diagnosticPayload,
    ]).toHaveLength(6)
  })

  it('accepts only absent or an exact cursor match', () => {
    function inspect(cursor: CollectionSyncCursor): void {
      const absent: CollectionCursorPrecondition = { kind: 'absent' }
      const matches: CollectionCursorPrecondition = {
        kind: 'matches',
        cursor,
      }
      // @ts-expect-error A matches precondition requires a Domain cursor.
      const missingCursor: CollectionCursorPrecondition = { kind: 'matches' }
      const rawState: CollectionCursorPrecondition = {
        kind: 'matches',
        // @ts-expect-error Raw state strings are not CollectionSyncCursor.
        cursor: 'state',
      }

      expect([absent, matches, missingCursor, rawState]).toHaveLength(4)
    }

    expect(inspect).toBeDefined()
  })
})

describe('P-02 CollectionSyncCommit compile-time contract', () => {
  it('is exactly the six kind/mode variants and narrows exhaustively', () => {
    type ExpectedVariant =
      | 'email/delta'
      | 'email/replace'
      | 'mailbox/delta'
      | 'mailbox/replace'
      | 'identity/delta'
      | 'identity/replace'
    type ActualVariant = CollectionSyncCommit extends infer Commit
      ? Commit extends CollectionSyncCommit
        ? `${Commit['kind']}/${Commit['mode']}`
        : never
      : never

    expectNever<Exclude<ExpectedVariant, ActualVariant>>()
    expectNever<Exclude<ActualVariant, ExpectedVariant>>()

    function inspect(commit: CollectionSyncCommit): number {
      switch (commit.kind) {
        case 'email':
          return commit.mode === 'delta'
            ? commit.changed.length + commit.destroyed.length
            : commit.snapshot.length
        case 'mailbox':
          return commit.mode === 'delta'
            ? commit.changed.length + commit.destroyed.length
            : commit.snapshot.length
        case 'identity':
          return commit.mode === 'delta'
            ? commit.changed.length + commit.destroyed.length
            : commit.snapshot.length
      }
    }

    expect(inspect).toBeDefined()
  })

  it('requires a matching cursor for delta and allows both replace preconditions', () => {
    function inspect(
      cursor: CollectionSyncCursor,
      record: EmailSyncRecord,
      emailId: ScopedEmailId,
    ): void {
      const delta: EmailCollectionDeltaCommit = {
        kind: 'email',
        mode: 'delta',
        expectedCursor: { kind: 'matches', cursor },
        nextCursor: cursor,
        changed: [record],
        destroyed: [emailId],
      }
      const deltaWithoutCursor: EmailCollectionDeltaCommit = {
        kind: 'email',
        mode: 'delta',
        // @ts-expect-error Delta cannot start from an absent cursor.
        expectedCursor: { kind: 'absent' },
        nextCursor: cursor,
        changed: [],
        destroyed: [],
      }
      const initialReplace: EmailCollectionReplaceCommit = {
        kind: 'email',
        mode: 'replace',
        expectedCursor: { kind: 'absent' },
        nextCursor: cursor,
        snapshot: [record],
      }
      const guardedReplace: EmailCollectionReplaceCommit = {
        kind: 'email',
        mode: 'replace',
        expectedCursor: { kind: 'matches', cursor },
        nextCursor: cursor,
        snapshot: [],
      }

      expect([
        delta,
        deltaWithoutCursor,
        initialReplace,
        guardedReplace,
      ]).toHaveLength(4)
    }

    expect(inspect).toBeDefined()
  })

  it('uses normalized Email records with readonly memberships', () => {
    function inspect(email: Email, membership: EmailMailbox): void {
      const record: EmailSyncRecord = { email, memberships: [membership] }
      const transportShape: EmailSyncRecord = {
        email,
        memberships: [],
        // @ts-expect-error EmailSyncRecord does not expose raw mailboxIds.
        mailboxIds: {},
      }

      // @ts-expect-error EmailSyncRecord memberships are readonly.
      record.memberships.push(membership)

      expect([record, transportShape]).toHaveLength(2)
    }

    expect(inspect).toBeDefined()
  })

  it('keeps every collection command and nested array readonly', () => {
    function inspect(
      delta: EmailCollectionDeltaCommit,
      replace: EmailCollectionReplaceCommit,
      mailboxDelta: MailboxCollectionDeltaCommit,
      mailboxReplace: MailboxCollectionReplaceCommit,
      identityDelta: IdentityCollectionDeltaCommit,
      identityReplace: IdentityCollectionReplaceCommit,
      record: EmailSyncRecord,
      emailId: ScopedEmailId,
    ): void {
      // @ts-expect-error Collection commands are readonly.
      delta.nextCursor = delta.nextCursor
      // @ts-expect-error Delta changed snapshots are readonly.
      delta.changed.push(record)
      // @ts-expect-error Delta destroyed snapshots are readonly.
      delta.destroyed.push(emailId)
      // @ts-expect-error Replacement snapshots are readonly.
      replace.snapshot.push(record)
      // @ts-expect-error Mailbox changed snapshots are readonly.
      mailboxDelta.changed.push(mailboxDelta.changed[0])
      // @ts-expect-error Mailbox destroyed snapshots are readonly.
      mailboxDelta.destroyed.push(mailboxDelta.destroyed[0])
      // @ts-expect-error Mailbox replacement snapshots are readonly.
      mailboxReplace.snapshot.push(mailboxReplace.snapshot[0])
      // @ts-expect-error Identity changed snapshots are readonly.
      identityDelta.changed.push(identityDelta.changed[0])
      // @ts-expect-error Identity destroyed snapshots are readonly.
      identityDelta.destroyed.push(identityDelta.destroyed[0])
      // @ts-expect-error Identity replacement snapshots are readonly.
      identityReplace.snapshot.push(identityReplace.snapshot[0])
    }

    expect(inspect).toBeDefined()
  })
})

describe('P-02 SyncPort compile-time contract', () => {
  it('contains exactly the ten frozen capabilities returning WriteResult', () => {
    type ExpectedCapability =
      | 'registerAccount'
      | 'applyCollectionSync'
      | 'cacheEmailBody'
      | 'replaceAttachmentRefs'
      | 'replaceMailboxView'
      | 'stageSendMutation'
      | 'applyOptimisticKeywordMutation'
      | 'applyOptimisticMailboxMembershipMutation'
      | 'replacePendingMutationIfCurrent'
      | 'removeConfirmedMutation'
    type MissingCapability = Exclude<ExpectedCapability, keyof SyncPort>
    type ExtraCapability = Exclude<keyof SyncPort, ExpectedCapability>
    type NonWriteResultCapability = {
      [Key in keyof SyncPort]: ReturnType<SyncPort[Key]> extends Promise<
        infer Result
      >
        ? Result extends WriteResult<infer Value>
          ? Value extends never
            ? Key
            : never
          : Key
        : Key
    }[keyof SyncPort]

    expectNever<MissingCapability>()
    expectNever<ExtraCapability>()
    expectNever<NonWriteResultCapability>()
    expect(Object.keys(port)).toHaveLength(10)
  })

  it('uses the exact Domain categories at the boundary', () => {
    function inspect(
      account: Account,
      accountKey: AccountKey,
      mutationId: MutationId,
      emailId: ScopedEmailId,
      mailboxId: ScopedMailboxId,
      identityId: ScopedIdentityId,
      blobId: ScopedBlobId,
      body: EmailBody,
      refs: readonly AttachmentRef[],
      view: MailboxView,
      send: SendMutation,
      keyword: KeywordMutation,
      membership: MailboxMembershipMutation,
      pending: PendingMutation,
    ): void {
      void port.registerAccount(account)
      void port.cacheEmailBody(body)
      void port.replaceAttachmentRefs(emailId, refs)
      void port.replaceMailboxView(view)
      void port.stageSendMutation(send)
      void port.applyOptimisticKeywordMutation(keyword)
      void port.applyOptimisticMailboxMembershipMutation(membership)
      void port.replacePendingMutationIfCurrent(pending, pending)
      void port.removeConfirmedMutation(accountKey, mutationId)

      // @ts-expect-error ScopedMailboxId is not ScopedEmailId.
      void port.replaceAttachmentRefs(mailboxId, refs)
      // @ts-expect-error Raw strings are not AccountKey values.
      void port.removeConfirmedMutation('account', mutationId)
      // @ts-expect-error Raw strings are not MutationId values.
      void port.removeConfirmedMutation(accountKey, 'mutation')
      // @ts-expect-error ScopedEmailId is not ScopedMailboxId.
      const wrongMailbox: ScopedMailboxId = emailId
      // @ts-expect-error ScopedMailboxId is not ScopedIdentityId.
      const wrongIdentity: ScopedIdentityId = mailboxId

      expect([identityId, blobId, wrongMailbox, wrongIdentity]).toHaveLength(4)
    }

    expect(inspect).toBeDefined()
  })

  it('exposes none of the forbidden generic or notification APIs', () => {
    type ForbiddenCapability =
      | 'saveEmail'
      | 'saveCursor'
      | 'saveMutation'
      | 'updateKeywords'
      | 'deleteMembership'
      | 'transaction'
      | 'beginTransaction'
      | 'onChange'
      | 'subscribe'
      | 'ensureMessageBody'
      | 'ensureFolderWindow'
      | 'fetch'
      | 'invoke'
      | 'executeSql'

    expectNever<Extract<keyof SyncPort, ForbiddenCapability>>()
    expect(port).toBeDefined()
  })
})
