import { sameRemoteAccountRef, type Account } from '../../domain/account'
import type { AttachmentRef } from '../../domain/attachment-ref'
import type { EmailBody } from '../../domain/email-body'
import { email, keywordSet } from '../../domain/email'
import {
  sameScopedEmailId,
  sameScopedIdentityId,
  sameScopedMailboxId,
  type AccountKey,
  type MutationId,
  type ScopedEmailId,
  type ScopedMailboxId,
} from '../../domain/ids'
import { emailMailbox } from '../../domain/mailbox'
import type { MailboxView } from '../../domain/mailbox-view'
import type {
  KeywordMutation,
  MailboxMembershipMutation,
  PendingMutation,
  SendMutation,
} from '../../domain/pending-mutation'
import type { SendIntent } from '../../domain/send-intent'
import type { CollectionSyncCursor } from '../../domain/sync-cursor'
import type { LocalChangeHint } from '../../ports/local-change-source'
import type {
  CollectionCursorPrecondition,
  CollectionSyncCommit,
  EmailSyncRecord,
  SyncPort,
  WriteResult,
} from '../../ports/sync-port'
import { MemoryChangeHub } from './memory-local-change-source'
import {
  cloneAccount,
  cloneAttachment,
  cloneBody,
  cloneCursor,
  cloneEmail,
  cloneIdentity,
  cloneMailbox,
  cloneMembership,
  cloneMutation,
  cloneView,
  cursorKey,
  emailKey,
  identityKey,
  mailboxKey,
  mutationKey,
  type MemoryState,
  viewKey,
} from './memory-state'

const writeOk = (): WriteResult => ({ ok: true, value: undefined })
const conflict = (): WriteResult => ({ ok: false, error: { kind: 'conflict' } })

function hasDuplicates<T>(
  values: readonly T[],
  key: (value: T) => string,
): boolean {
  const seen = new Set<string>()
  for (const value of values) {
    const current = key(value)
    if (seen.has(current)) return true
    seen.add(current)
  }
  return false
}

function setsEqual(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): boolean {
  return (
    left.size === right.size && [...left].every((value) => right.has(value))
  )
}

function addressEqual(
  left: Readonly<{ name: string | null; email: string }>,
  right: Readonly<{ name: string | null; email: string }>,
): boolean {
  return left.name === right.name && left.email === right.email
}

function addressListsEqual(
  left: readonly Readonly<{ name: string | null; email: string }>[],
  right: readonly Readonly<{ name: string | null; email: string }>[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => addressEqual(value, right[index]))
  )
}

function sendIntentsEqual(left: SendIntent, right: SendIntent): boolean {
  return (
    left.securityMode === right.securityMode &&
    sameScopedIdentityId(left.identityId, right.identityId) &&
    addressEqual(left.from, right.from) &&
    addressListsEqual(left.replyTo, right.replyTo) &&
    addressListsEqual(left.to, right.to) &&
    addressListsEqual(left.cc, right.cc) &&
    addressListsEqual(left.bcc, right.bcc) &&
    left.subject === right.subject &&
    left.body.text === right.body.text &&
    left.body.html === right.body.html
  )
}

function lifecycleEqual(
  left: PendingMutation['lifecycle'],
  right: PendingMutation['lifecycle'],
): boolean {
  if (left.status !== right.status || left.attemptCount !== right.attemptCount)
    return false
  if (left.status === 'retrying' && right.status === 'retrying') {
    return left.nextAttemptAt === right.nextAttemptAt
  }
  if (left.status === 'confirmed' && right.status === 'confirmed') {
    const leftConfirmation =
      'confirmation' in left ? left.confirmation : undefined
    const rightConfirmation =
      'confirmation' in right ? right.confirmation : undefined
    if (leftConfirmation === undefined || rightConfirmation === undefined) {
      return leftConfirmation === rightConfirmation
    }
    return sameScopedEmailId(
      leftConfirmation.emailId,
      rightConfirmation.emailId,
    )
  }
  return true
}

function mailboxIdsEqual(
  left: readonly ScopedMailboxId[],
  right: readonly ScopedMailboxId[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => sameScopedMailboxId(value, right[index]))
  )
}

function mutationsEqual(
  left: PendingMutation,
  right: PendingMutation,
): boolean {
  if (
    left.kind !== right.kind ||
    left.accountKey !== right.accountKey ||
    left.mutationId !== right.mutationId ||
    left.createdAt !== right.createdAt ||
    !lifecycleEqual(left.lifecycle, right.lifecycle)
  )
    return false

  if (left.kind === 'send' && right.kind === 'send')
    return sendIntentsEqual(left.intent, right.intent)
  if (left.kind === 'keyword' && right.kind === 'keyword') {
    return (
      sameScopedEmailId(left.emailId, right.emailId) &&
      setsEqual(left.change.add, right.change.add) &&
      setsEqual(left.change.remove, right.change.remove)
    )
  }
  if (left.kind === 'mailboxMembership' && right.kind === 'mailboxMembership') {
    return (
      sameScopedEmailId(left.emailId, right.emailId) &&
      mailboxIdsEqual(left.change.add, right.change.add) &&
      mailboxIdsEqual(left.change.remove, right.change.remove)
    )
  }
  return false
}

function sameImmutableMutation(
  left: PendingMutation,
  right: PendingMutation,
): boolean {
  const leftPending = {
    ...left,
    lifecycle: { status: 'pending' as const, attemptCount: 0 as const },
  }
  const rightPending = {
    ...right,
    lifecycle: { status: 'pending' as const, attemptCount: 0 as const },
  }
  return mutationsEqual(leftPending, rightPending)
}

function validTransition(
  expected: PendingMutation,
  next: PendingMutation,
): boolean {
  const from = expected.lifecycle
  const to = next.lifecycle
  if (from.status === 'pending')
    return to.status === 'inFlight' && to.attemptCount === 1
  if (from.status === 'retrying')
    return to.status === 'inFlight' && to.attemptCount === from.attemptCount + 1
  if (from.status !== 'inFlight' || to.attemptCount !== from.attemptCount)
    return false
  return (
    to.status === 'retrying' ||
    to.status === 'confirmed' ||
    to.status === 'failedTerminal'
  )
}

export class MemorySyncPort implements SyncPort {
  constructor(
    private readonly state: MemoryState,
    private readonly changes: MemoryChangeHub,
  ) {}

  private publish(
    hints: readonly [LocalChangeHint, ...LocalChangeHint[]],
  ): void {
    this.changes.publish(hints)
  }

  async registerAccount(value: Account): Promise<WriteResult> {
    const current = this.state.accounts.get(value.key)
    if (
      current !== undefined &&
      !sameRemoteAccountRef(current.remoteRef, value.remoteRef)
    )
      return conflict()
    if (current === undefined)
      this.state.accounts.set(value.key, cloneAccount(value))
    this.publish([{ kind: 'accounts' }])
    return writeOk()
  }

  private cursorPreconditionHolds(
    expected: CollectionCursorPrecondition,
    next: CollectionSyncCursor,
  ): boolean {
    const current = this.state.cursors.get(
      cursorKey(next.accountKey, next.dataType),
    )
    if (expected.kind === 'absent') return current === undefined
    return (
      current !== undefined &&
      expected.cursor.accountKey === next.accountKey &&
      expected.cursor.dataType === next.dataType &&
      current.accountKey === expected.cursor.accountKey &&
      current.dataType === expected.cursor.dataType &&
      current.state === expected.cursor.state
    )
  }

  async applyCollectionSync(
    commit: CollectionSyncCommit,
  ): Promise<WriteResult> {
    const accountKey = commit.nextCursor.accountKey
    if (
      !this.state.accounts.has(accountKey) ||
      commit.nextCursor.dataType !== commit.kind ||
      !this.cursorPreconditionHolds(commit.expectedCursor, commit.nextCursor)
    )
      return conflict()

    if (commit.kind === 'email') {
      if (!this.validateEmailCommit(commit, accountKey)) return conflict()
      this.commitEmails(commit, accountKey)
      this.state.cursors.set(
        cursorKey(accountKey, 'email'),
        cloneCursor(commit.nextCursor),
      )
      this.publish([
        { kind: 'emails', accountKey },
        { kind: 'emailMemberships', accountKey },
        { kind: 'syncCursor', accountKey, dataType: 'email' },
      ])
      return writeOk()
    }

    if (commit.kind === 'mailbox') {
      if (!this.validateMailboxCommit(commit, accountKey)) return conflict()
      this.commitMailboxes(commit, accountKey)
      this.state.cursors.set(
        cursorKey(accountKey, 'mailbox'),
        cloneCursor(commit.nextCursor),
      )
      this.publish([
        { kind: 'mailboxes', accountKey },
        { kind: 'syncCursor', accountKey, dataType: 'mailbox' },
      ])
      return writeOk()
    }

    if (!this.validateIdentityCommit(commit, accountKey)) return conflict()
    this.commitIdentities(commit, accountKey)
    this.state.cursors.set(
      cursorKey(accountKey, 'identity'),
      cloneCursor(commit.nextCursor),
    )
    this.publish([
      { kind: 'identities', accountKey },
      { kind: 'syncCursor', accountKey, dataType: 'identity' },
    ])
    return writeOk()
  }

  private validateEmailRecord(
    record: EmailSyncRecord,
    accountKey: AccountKey,
  ): boolean {
    return (
      record.email.id.accountKey === accountKey &&
      record.memberships.every((entry) =>
        sameScopedEmailId(entry.emailId, record.email.id),
      ) &&
      !hasDuplicates(
        record.memberships,
        (entry) => `${emailKey(entry.emailId)}|${mailboxKey(entry.mailboxId)}`,
      )
    )
  }

  private validateEmailCommit(
    commit: Extract<CollectionSyncCommit, { kind: 'email' }>,
    accountKey: AccountKey,
  ): boolean {
    const records = commit.mode === 'delta' ? commit.changed : commit.snapshot
    if (
      records.some((record) => !this.validateEmailRecord(record, accountKey)) ||
      hasDuplicates(records, (record) => emailKey(record.email.id))
    )
      return false
    if (commit.mode === 'replace') return true
    return (
      commit.destroyed.every((id) => id.accountKey === accountKey) &&
      !hasDuplicates(commit.destroyed, emailKey) &&
      !commit.changed.some((record) =>
        commit.destroyed.some((id) => sameScopedEmailId(record.email.id, id)),
      )
    )
  }

  private commitEmails(
    commit: Extract<CollectionSyncCommit, { kind: 'email' }>,
    accountKey: AccountKey,
  ): void {
    const emails = new Map(this.state.emails)
    const memberships = new Map(this.state.memberships)
    if (commit.mode === 'replace') {
      for (const [key, value] of emails)
        if (value.id.accountKey === accountKey) emails.delete(key)
      for (const [key, value] of memberships)
        if (
          value[0]?.emailId.accountKey === accountKey ||
          this.state.emails.get(key)?.id.accountKey === accountKey
        )
          memberships.delete(key)
    } else {
      for (const id of commit.destroyed) {
        emails.delete(emailKey(id))
        memberships.delete(emailKey(id))
      }
    }
    const records = commit.mode === 'delta' ? commit.changed : commit.snapshot
    for (const record of records) {
      emails.set(emailKey(record.email.id), cloneEmail(record.email))
      memberships.set(
        emailKey(record.email.id),
        record.memberships.map(cloneMembership),
      )
    }
    this.state.emails = emails
    this.state.memberships = memberships
  }

  private validateMailboxCommit(
    commit: Extract<CollectionSyncCommit, { kind: 'mailbox' }>,
    accountKey: AccountKey,
  ): boolean {
    const records = commit.mode === 'delta' ? commit.changed : commit.snapshot
    if (
      records.some((value) => value.id.accountKey !== accountKey) ||
      hasDuplicates(records, (value) => mailboxKey(value.id))
    )
      return false
    if (commit.mode === 'replace') return true
    return (
      commit.destroyed.every((id) => id.accountKey === accountKey) &&
      !hasDuplicates(commit.destroyed, mailboxKey) &&
      !commit.changed.some((value) =>
        commit.destroyed.some((id) => sameScopedMailboxId(value.id, id)),
      )
    )
  }

  private commitMailboxes(
    commit: Extract<CollectionSyncCommit, { kind: 'mailbox' }>,
    accountKey: AccountKey,
  ): void {
    const values = new Map(this.state.mailboxes)
    if (commit.mode === 'replace') {
      for (const [key, value] of values)
        if (value.id.accountKey === accountKey) values.delete(key)
    } else {
      for (const id of commit.destroyed) values.delete(mailboxKey(id))
    }
    for (const value of commit.mode === 'delta'
      ? commit.changed
      : commit.snapshot)
      values.set(mailboxKey(value.id), cloneMailbox(value))
    this.state.mailboxes = values
  }

  private validateIdentityCommit(
    commit: Extract<CollectionSyncCommit, { kind: 'identity' }>,
    accountKey: AccountKey,
  ): boolean {
    const records = commit.mode === 'delta' ? commit.changed : commit.snapshot
    if (
      records.some((value) => value.id.accountKey !== accountKey) ||
      hasDuplicates(records, (value) => identityKey(value.id))
    )
      return false
    if (commit.mode === 'replace') return true
    return (
      commit.destroyed.every((id) => id.accountKey === accountKey) &&
      !hasDuplicates(commit.destroyed, identityKey) &&
      !commit.changed.some((value) =>
        commit.destroyed.some((id) => sameScopedIdentityId(value.id, id)),
      )
    )
  }

  private commitIdentities(
    commit: Extract<CollectionSyncCommit, { kind: 'identity' }>,
    accountKey: AccountKey,
  ): void {
    const values = new Map(this.state.identities)
    if (commit.mode === 'replace') {
      for (const [key, value] of values)
        if (value.id.accountKey === accountKey) values.delete(key)
    } else {
      for (const id of commit.destroyed) values.delete(identityKey(id))
    }
    for (const value of commit.mode === 'delta'
      ? commit.changed
      : commit.snapshot)
      values.set(identityKey(value.id), cloneIdentity(value))
    this.state.identities = values
  }

  async cacheEmailBody(body: EmailBody): Promise<WriteResult> {
    if (!this.state.emails.has(emailKey(body.emailId))) return conflict()
    this.state.bodies.set(emailKey(body.emailId), cloneBody(body))
    this.publish([{ kind: 'emailBody', emailId: body.emailId }])
    return writeOk()
  }

  async replaceAttachmentRefs(
    emailId: ScopedEmailId,
    refs: readonly AttachmentRef[],
  ): Promise<WriteResult> {
    if (
      !this.state.emails.has(emailKey(emailId)) ||
      refs.some((value) => !sameScopedEmailId(value.emailId, emailId)) ||
      hasDuplicates(
        refs,
        (value) => `${emailKey(value.emailId)}|${value.partId}`,
      )
    )
      return conflict()
    this.state.attachments.set(emailKey(emailId), refs.map(cloneAttachment))
    this.publish([{ kind: 'attachmentRefs', emailId }])
    return writeOk()
  }

  async replaceMailboxView(view: MailboxView): Promise<WriteResult> {
    if (!this.state.mailboxes.has(mailboxKey(view.spec.mailboxId)))
      return conflict()
    this.state.views.set(viewKey(view.spec), cloneView(view))
    this.publish([{ kind: 'mailboxView', spec: view.spec }])
    return writeOk()
  }

  async stageSendMutation(value: SendMutation): Promise<WriteResult> {
    const key = mutationKey(value.accountKey, value.mutationId)
    if (
      !this.state.accounts.has(value.accountKey) ||
      this.state.mutations.has(key)
    )
      return conflict()
    this.state.mutations.set(key, cloneMutation(value))
    this.publish([{ kind: 'pendingMutations', accountKey: value.accountKey }])
    return writeOk()
  }

  async applyOptimisticKeywordMutation(
    value: KeywordMutation,
  ): Promise<WriteResult> {
    const key = mutationKey(value.accountKey, value.mutationId)
    const target = this.state.emails.get(emailKey(value.emailId))
    if (
      !this.state.accounts.has(value.accountKey) ||
      target === undefined ||
      this.state.mutations.has(key)
    )
      return conflict()
    const keywords = new Set(target.keywords)
    for (const item of value.change.add) keywords.add(item)
    for (const item of value.change.remove) keywords.delete(item)
    const next = email({ ...target, keywords: keywordSet(keywords) })
    this.state.emails.set(emailKey(value.emailId), next)
    this.state.mutations.set(key, cloneMutation(value))
    this.publish([
      { kind: 'emails', accountKey: value.accountKey },
      { kind: 'pendingMutations', accountKey: value.accountKey },
    ])
    return writeOk()
  }

  async applyOptimisticMailboxMembershipMutation(
    value: MailboxMembershipMutation,
  ): Promise<WriteResult> {
    const key = mutationKey(value.accountKey, value.mutationId)
    const targetKey = emailKey(value.emailId)
    if (
      !this.state.accounts.has(value.accountKey) ||
      !this.state.emails.has(targetKey) ||
      this.state.mutations.has(key)
    )
      return conflict()
    if (
      [...value.change.add, ...value.change.remove].some(
        (id) => !this.state.mailboxes.has(mailboxKey(id)),
      )
    )
      return conflict()
    const current = [...(this.state.memberships.get(targetKey) ?? [])]
    const next = current.filter(
      (entry) =>
        !value.change.remove.some((id) =>
          sameScopedMailboxId(entry.mailboxId, id),
        ),
    )
    for (const id of value.change.add)
      if (!next.some((entry) => sameScopedMailboxId(entry.mailboxId, id)))
        next.push(emailMailbox(value.emailId, id))
    if (next.length === 0) return conflict()
    this.state.memberships.set(targetKey, next.map(cloneMembership))
    this.state.mutations.set(key, cloneMutation(value))
    this.publish([
      { kind: 'emailMemberships', accountKey: value.accountKey },
      { kind: 'pendingMutations', accountKey: value.accountKey },
    ])
    return writeOk()
  }

  async replacePendingMutationIfCurrent(
    expected: PendingMutation,
    next: PendingMutation,
  ): Promise<WriteResult> {
    const key = mutationKey(expected.accountKey, expected.mutationId)
    const current = this.state.mutations.get(key)
    if (
      current === undefined ||
      !mutationsEqual(current, expected) ||
      !sameImmutableMutation(expected, next) ||
      !validTransition(expected, next)
    )
      return conflict()
    this.state.mutations.set(key, cloneMutation(next))
    this.publish([
      { kind: 'pendingMutations', accountKey: expected.accountKey },
    ])
    return writeOk()
  }

  async removeConfirmedMutation(
    accountKey: AccountKey,
    mutationId: MutationId,
  ): Promise<WriteResult> {
    const key = mutationKey(accountKey, mutationId)
    const current = this.state.mutations.get(key)
    if (current === undefined || current.lifecycle.status !== 'confirmed')
      return conflict()
    this.state.mutations.delete(key)
    this.publish([{ kind: 'pendingMutations', accountKey }])
    return writeOk()
  }
}
