import { account, remoteAccountRef, type Account } from '../../domain/account'
import {
  emailAddress,
  type EmailAddress,
  type EmailAddressList,
} from '../../domain/address'
import {
  attachmentPartIdFromString,
  attachmentRef,
  type AttachmentRef,
} from '../../domain/attachment-ref'
import { emailBody, type EmailBody } from '../../domain/email-body'
import { email, keywordSet, type Email } from '../../domain/email'
import {
  accountKeyFromString,
  jmapAccountIdFromString,
  jmapBlobIdFromString,
  jmapEmailIdFromString,
  jmapIdentityIdFromString,
  jmapMailboxIdFromString,
  jmapThreadIdFromString,
  mutationIdFromString,
  scopedBlobId,
  scopedEmailId,
  scopedIdentityId,
  scopedMailboxId,
  scopedThreadId,
  serviceKeyFromString,
  type AccountKey,
  type ScopedBlobId,
  type ScopedEmailId,
  type ScopedIdentityId,
  type ScopedMailboxId,
  type ScopedThreadId,
} from '../../domain/ids'
import { identity, type Identity } from '../../domain/identity'
import {
  emailMailbox,
  mailbox,
  mailboxRights,
  type EmailMailbox,
  type Mailbox,
} from '../../domain/mailbox'
import {
  mailboxView,
  mailboxViewCoverageRange,
  mailboxViewFilterAll,
  mailboxViewItem,
  mailboxViewQueryStateFromString,
  mailboxViewSort,
  mailboxViewSpec,
  type MailboxView,
  type MailboxViewSpec,
} from '../../domain/mailbox-view'
import {
  keywordMutation,
  mailboxMembershipChange,
  mailboxMembershipMutation,
  mutationInstantFromString,
  sendMutation,
  type EmailUpdateLifecycle,
  type KeywordMutation,
  type MailboxMembershipMutation,
  type PendingMutation,
  type SendMutation,
  type SendMutationLifecycle,
} from '../../domain/pending-mutation'
import { sendIntent, type SendIntent } from '../../domain/send-intent'
import {
  collectionSyncCursor,
  collectionSyncStateFromString,
  type CollectionSyncCursor,
} from '../../domain/sync-cursor'
import type {
  CollectionCursorPrecondition,
  CollectionSyncCommit,
} from '../../ports/sync-port'
import type {
  IpcAccount,
  IpcAttachmentRef,
  IpcCollectionSyncCommit,
  IpcCollectionSyncCursor,
  IpcCursorPrecondition,
  IpcEmail,
  IpcEmailAddress,
  IpcEmailAddressList,
  IpcEmailBody,
  IpcEmailMailbox,
  IpcIdentity,
  IpcKeywordMutation,
  IpcLocalChangeBatch,
  IpcLocalChangeHint,
  IpcMailbox,
  IpcMailboxMembershipMutation,
  IpcMailboxView,
  IpcMailboxViewSpec,
  IpcPendingMutation,
  IpcScopedBlobId,
  IpcScopedEmailId,
  IpcScopedIdentityId,
  IpcScopedMailboxId,
  IpcScopedThreadId,
  IpcSendIntent,
  IpcSendMutation,
} from '../../ipc/dto'
import type {
  LocalChangeBatch,
  LocalChangeHint,
} from '../../ports/local-change-source'

export const encodeAccountKey = (value: AccountKey): string => value
export const decodeAccountKey = (value: string): AccountKey =>
  accountKeyFromString(value)

export const encodeScopedMailboxId = (
  value: ScopedMailboxId,
): IpcScopedMailboxId => ({
  accountKey: value.accountKey,
  jmapMailboxId: value.jmapId,
})
export const decodeScopedMailboxId = (
  value: IpcScopedMailboxId,
): ScopedMailboxId =>
  scopedMailboxId(
    accountKeyFromString(value.accountKey),
    jmapMailboxIdFromString(value.jmapMailboxId),
  )
export const encodeScopedEmailId = (
  value: ScopedEmailId,
): IpcScopedEmailId => ({
  accountKey: value.accountKey,
  jmapEmailId: value.jmapId,
})
export const decodeScopedEmailId = (value: IpcScopedEmailId): ScopedEmailId =>
  scopedEmailId(
    accountKeyFromString(value.accountKey),
    jmapEmailIdFromString(value.jmapEmailId),
  )
export const encodeScopedIdentityId = (
  value: ScopedIdentityId,
): IpcScopedIdentityId => ({
  accountKey: value.accountKey,
  jmapIdentityId: value.jmapId,
})
export const decodeScopedIdentityId = (
  value: IpcScopedIdentityId,
): ScopedIdentityId =>
  scopedIdentityId(
    accountKeyFromString(value.accountKey),
    jmapIdentityIdFromString(value.jmapIdentityId),
  )
export const encodeScopedThreadId = (
  value: ScopedThreadId,
): IpcScopedThreadId => ({
  accountKey: value.accountKey,
  jmapThreadId: value.jmapId,
})
export const decodeScopedThreadId = (
  value: IpcScopedThreadId,
): ScopedThreadId =>
  scopedThreadId(
    accountKeyFromString(value.accountKey),
    jmapThreadIdFromString(value.jmapThreadId),
  )
export const encodeScopedBlobId = (value: ScopedBlobId): IpcScopedBlobId => ({
  accountKey: value.accountKey,
  jmapBlobId: value.jmapId,
})
export const decodeScopedBlobId = (value: IpcScopedBlobId): ScopedBlobId =>
  scopedBlobId(
    accountKeyFromString(value.accountKey),
    jmapBlobIdFromString(value.jmapBlobId),
  )

const encodeAddress = (value: EmailAddress): IpcEmailAddress => ({
  name: value.name,
  email: value.email,
})
const decodeAddress = (value: IpcEmailAddress): EmailAddress =>
  emailAddress(value.name, value.email)
const encodeAddressList = (value: EmailAddressList): IpcEmailAddressList =>
  value === null ? null : value.map(encodeAddress)
const decodeAddressList = (value: IpcEmailAddressList): EmailAddressList =>
  value === null ? null : value.map(decodeAddress)

export const encodeAccount = (value: Account): IpcAccount => ({
  key: value.key,
  remoteRef: {
    serviceKey: value.remoteRef.serviceKey,
    jmapAccountId: value.remoteRef.jmapAccountId,
  },
})
export const decodeAccount = (value: IpcAccount): Account =>
  account(
    accountKeyFromString(value.key),
    remoteAccountRef(
      serviceKeyFromString(value.remoteRef.serviceKey),
      jmapAccountIdFromString(value.remoteRef.jmapAccountId),
    ),
  )
export const encodeMailbox = (value: Mailbox): IpcMailbox => ({
  ...value,
  id: encodeScopedMailboxId(value.id),
  parent: value.parent === null ? null : encodeScopedMailboxId(value.parent),
  rights: { ...value.rights },
})
export const decodeMailbox = (value: IpcMailbox): Mailbox =>
  mailbox({
    ...value,
    id: decodeScopedMailboxId(value.id),
    parent: value.parent === null ? null : decodeScopedMailboxId(value.parent),
    rights: mailboxRights(value.rights),
  })
export const encodeIdentity = (value: Identity): IpcIdentity => ({
  id: encodeScopedIdentityId(value.id),
  name: value.name,
  email: value.email,
  replyTo: encodeAddressList(value.replyTo),
  bcc: encodeAddressList(value.bcc),
})
export const decodeIdentity = (value: IpcIdentity): Identity =>
  identity({
    id: decodeScopedIdentityId(value.id),
    name: value.name,
    email: value.email,
    replyTo: decodeAddressList(value.replyTo),
    bcc: decodeAddressList(value.bcc),
  })
export const encodeEmail = (value: Email): IpcEmail => ({
  id: encodeScopedEmailId(value.id),
  blobId: encodeScopedBlobId(value.blobId),
  threadId: encodeScopedThreadId(value.threadId),
  sender: encodeAddressList(value.sender),
  from: encodeAddressList(value.from),
  replyTo: encodeAddressList(value.replyTo),
  to: encodeAddressList(value.to),
  cc: encodeAddressList(value.cc),
  bcc: encodeAddressList(value.bcc),
  subject: value.subject,
  sentAt: value.sentAt,
  receivedAt: value.receivedAt,
  size: value.size,
  preview: value.preview,
  hasAttachment: value.hasAttachment,
  keywords: [...value.keywords],
})
export const decodeEmail = (value: IpcEmail): Email =>
  email({
    id: decodeScopedEmailId(value.id),
    blobId: decodeScopedBlobId(value.blobId),
    threadId: decodeScopedThreadId(value.threadId),
    sender: decodeAddressList(value.sender),
    from: decodeAddressList(value.from),
    replyTo: decodeAddressList(value.replyTo),
    to: decodeAddressList(value.to),
    cc: decodeAddressList(value.cc),
    bcc: decodeAddressList(value.bcc),
    subject: value.subject,
    sentAt: value.sentAt,
    receivedAt: value.receivedAt,
    size: value.size,
    preview: value.preview,
    hasAttachment: value.hasAttachment,
    keywords: keywordSet(value.keywords),
  })
export const encodeEmailMailbox = (value: EmailMailbox): IpcEmailMailbox => ({
  emailId: encodeScopedEmailId(value.emailId),
  mailboxId: encodeScopedMailboxId(value.mailboxId),
})
export const decodeEmailMailbox = (value: IpcEmailMailbox): EmailMailbox =>
  emailMailbox(
    decodeScopedEmailId(value.emailId),
    decodeScopedMailboxId(value.mailboxId),
  )
export const encodeEmailBody = (value: EmailBody): IpcEmailBody => ({
  emailId: encodeScopedEmailId(value.emailId),
  text: value.text,
  html: value.html,
})
export const decodeEmailBody = (value: IpcEmailBody): EmailBody =>
  emailBody({
    emailId: decodeScopedEmailId(value.emailId),
    text: value.text,
    html: value.html,
  })
export const encodeAttachmentRef = (
  value: AttachmentRef,
): IpcAttachmentRef => ({
  ...value,
  emailId: encodeScopedEmailId(value.emailId),
  partId: value.partId,
  blobId: encodeScopedBlobId(value.blobId),
})
export const decodeAttachmentRef = (value: IpcAttachmentRef): AttachmentRef =>
  attachmentRef({
    ...value,
    emailId: decodeScopedEmailId(value.emailId),
    partId: attachmentPartIdFromString(value.partId),
    blobId: decodeScopedBlobId(value.blobId),
  })

export const encodeMailboxViewSpec = (
  value: MailboxViewSpec,
): IpcMailboxViewSpec => ({
  mailboxId: encodeScopedMailboxId(value.mailboxId),
  filter: { kind: value.filter.kind },
  sort: { property: value.sort.property, direction: value.sort.direction },
})
export const decodeMailboxViewSpec = (
  value: IpcMailboxViewSpec,
): MailboxViewSpec =>
  mailboxViewSpec(
    decodeScopedMailboxId(value.mailboxId),
    mailboxViewFilterAll(),
    mailboxViewSort(value.sort.direction),
  )
export const encodeMailboxView = (value: MailboxView): IpcMailboxView => ({
  spec: encodeMailboxViewSpec(value.spec),
  queryState: value.queryState,
  total: value.total,
  coverage: value.coverage.map((range) => ({ ...range })),
  items: value.items.map((item) => ({
    position: item.position,
    emailId: encodeScopedEmailId(item.emailId),
  })),
})
export const decodeMailboxView = (value: IpcMailboxView): MailboxView =>
  mailboxView({
    spec: decodeMailboxViewSpec(value.spec),
    queryState: mailboxViewQueryStateFromString(value.queryState),
    total: value.total,
    coverage: value.coverage.map((range) =>
      mailboxViewCoverageRange(range.start, range.endExclusive),
    ),
    items: value.items.map((item) =>
      mailboxViewItem(item.position, decodeScopedEmailId(item.emailId)),
    ),
  })
export const encodeCursor = (
  value: CollectionSyncCursor,
): IpcCollectionSyncCursor => ({
  accountKey: value.accountKey,
  dataType: value.dataType,
  state: value.state,
})
export const decodeCursor = (
  value: IpcCollectionSyncCursor,
): CollectionSyncCursor =>
  collectionSyncCursor({
    accountKey: accountKeyFromString(value.accountKey),
    dataType: value.dataType,
    state: collectionSyncStateFromString(value.state),
  })

const encodeSendIntent = (value: SendIntent): IpcSendIntent => ({
  identityId: encodeScopedIdentityId(value.identityId),
  from: encodeAddress(value.from),
  replyTo: value.replyTo.map(encodeAddress),
  to: value.to.map(encodeAddress),
  cc: value.cc.map(encodeAddress),
  bcc: value.bcc.map(encodeAddress),
  subject: value.subject,
  body: { ...value.body },
})
function decodeSendIntent(value: IpcSendIntent): SendIntent {
  const from = decodeAddress(value.from)
  if (from.name === null) {
    throw new TypeError('Persisted SendIntent From must contain Identity name')
  }
  return sendIntent({
    identity: identity({
      id: decodeScopedIdentityId(value.identityId),
      name: from.name,
      email: from.email,
      replyTo: value.replyTo.map(decodeAddress),
      bcc: null,
    }),
    to: value.to.map(decodeAddress),
    cc: value.cc.map(decodeAddress),
    bcc: value.bcc.map(decodeAddress),
    subject: value.subject,
    body: { ...value.body },
  })
}

function assertAttemptCount(value: number, pending: boolean): void {
  if (!Number.isSafeInteger(value) || (pending ? value !== 0 : value < 1))
    throw new TypeError('Invalid mutation attemptCount')
}
function decodeSendLifecycle(
  value: IpcSendMutation['lifecycle'],
  owner: AccountKey,
): SendMutationLifecycle {
  if (value.status === 'pending') {
    assertAttemptCount(value.attemptCount, true)
    return { status: 'pending', attemptCount: 0 }
  }
  assertAttemptCount(value.attemptCount, false)
  if (value.status === 'retrying')
    return {
      status: 'retrying',
      attemptCount: value.attemptCount,
      nextAttemptAt: mutationInstantFromString(value.nextAttemptAt),
    }
  if (value.status === 'confirmed') {
    const emailId = decodeScopedEmailId(value.confirmation.emailId)
    if (emailId.accountKey !== owner)
      throw new TypeError('Send confirmation account mismatch')
    return {
      status: 'confirmed',
      attemptCount: value.attemptCount,
      confirmation: { emailId },
    }
  }
  if (value.status === 'inFlight' || value.status === 'failedTerminal') {
    return { status: value.status, attemptCount: value.attemptCount }
  }
  throw new TypeError('Unknown SendMutation lifecycle')
}
function decodeUpdateLifecycle(
  value: IpcKeywordMutation['lifecycle'],
): EmailUpdateLifecycle {
  if (value.status === 'pending') {
    assertAttemptCount(value.attemptCount, true)
    return { status: 'pending', attemptCount: 0 }
  }
  assertAttemptCount(value.attemptCount, false)
  if (value.status === 'retrying')
    return {
      status: 'retrying',
      attemptCount: value.attemptCount,
      nextAttemptAt: mutationInstantFromString(value.nextAttemptAt),
    }
  if (
    value.status === 'inFlight' ||
    value.status === 'confirmed' ||
    value.status === 'failedTerminal'
  ) {
    return { status: value.status, attemptCount: value.attemptCount }
  }
  throw new TypeError('Unknown Email update lifecycle')
}
function encodeSendLifecycle(
  value: SendMutationLifecycle,
): IpcSendMutation['lifecycle'] {
  if (value.status === 'retrying')
    return {
      status: value.status,
      attemptCount: value.attemptCount,
      nextAttemptAt: value.nextAttemptAt,
    } as const
  if (value.status === 'confirmed' && 'confirmation' in value)
    return {
      status: value.status,
      attemptCount: value.attemptCount,
      confirmation: {
        emailId: encodeScopedEmailId(value.confirmation.emailId),
      },
    } as const
  if (value.status === 'pending') return { status: 'pending', attemptCount: 0 }
  return { status: value.status, attemptCount: value.attemptCount }
}
function encodeUpdateLifecycle(
  value: EmailUpdateLifecycle,
): IpcKeywordMutation['lifecycle'] {
  if (value.status === 'retrying')
    return {
      status: value.status,
      attemptCount: value.attemptCount,
      nextAttemptAt: value.nextAttemptAt,
    }
  if (value.status === 'pending') return { status: 'pending', attemptCount: 0 }
  return { status: value.status, attemptCount: value.attemptCount }
}
export function encodePendingMutation(
  value: PendingMutation,
): IpcPendingMutation {
  if (value.kind === 'send')
    return {
      kind: value.kind,
      mutationId: value.mutationId,
      accountKey: value.accountKey,
      createdAt: value.createdAt,
      intent: encodeSendIntent(value.intent),
      lifecycle: encodeSendLifecycle(value.lifecycle),
    }
  if (value.kind === 'keyword')
    return {
      kind: value.kind,
      mutationId: value.mutationId,
      accountKey: value.accountKey,
      createdAt: value.createdAt,
      emailId: encodeScopedEmailId(value.emailId),
      change: { add: [...value.change.add], remove: [...value.change.remove] },
      lifecycle: encodeUpdateLifecycle(value.lifecycle),
    }
  return {
    kind: value.kind,
    mutationId: value.mutationId,
    accountKey: value.accountKey,
    createdAt: value.createdAt,
    emailId: encodeScopedEmailId(value.emailId),
    change: {
      add: value.change.add.map(encodeScopedMailboxId),
      remove: value.change.remove.map(encodeScopedMailboxId),
    },
    lifecycle: encodeUpdateLifecycle(value.lifecycle),
  }
}
export function decodePendingMutation(
  value: IpcPendingMutation,
): PendingMutation {
  const owner = accountKeyFromString(value.accountKey)
  const common = {
    mutationId: mutationIdFromString(value.mutationId),
    accountKey: owner,
    createdAt: mutationInstantFromString(value.createdAt),
  }
  if (value.kind === 'send') {
    const base = sendMutation({
      ...common,
      intent: decodeSendIntent(value.intent),
    })
    return { ...base, lifecycle: decodeSendLifecycle(value.lifecycle, owner) }
  }
  if (value.kind === 'keyword') {
    const base = keywordMutation({
      ...common,
      emailId: decodeScopedEmailId(value.emailId),
      change: {
        add: keywordSet(value.change.add),
        remove: keywordSet(value.change.remove),
      },
    })
    return { ...base, lifecycle: decodeUpdateLifecycle(value.lifecycle) }
  }
  const base = mailboxMembershipMutation({
    ...common,
    emailId: decodeScopedEmailId(value.emailId),
    change: mailboxMembershipChange({
      add: value.change.add.map(decodeScopedMailboxId),
      remove: value.change.remove.map(decodeScopedMailboxId),
    }),
  })
  return { ...base, lifecycle: decodeUpdateLifecycle(value.lifecycle) }
}
export const encodeSendMutation = (value: SendMutation): IpcSendMutation => ({
  kind: value.kind,
  mutationId: value.mutationId,
  accountKey: value.accountKey,
  createdAt: value.createdAt,
  intent: encodeSendIntent(value.intent),
  lifecycle: encodeSendLifecycle(value.lifecycle),
})
export const encodeKeywordMutation = (
  value: KeywordMutation,
): IpcKeywordMutation => ({
  kind: value.kind,
  mutationId: value.mutationId,
  accountKey: value.accountKey,
  createdAt: value.createdAt,
  emailId: encodeScopedEmailId(value.emailId),
  change: { add: [...value.change.add], remove: [...value.change.remove] },
  lifecycle: encodeUpdateLifecycle(value.lifecycle),
})
export const encodeMailboxMembershipMutation = (
  value: MailboxMembershipMutation,
): IpcMailboxMembershipMutation => ({
  kind: value.kind,
  mutationId: value.mutationId,
  accountKey: value.accountKey,
  createdAt: value.createdAt,
  emailId: encodeScopedEmailId(value.emailId),
  change: {
    add: value.change.add.map(encodeScopedMailboxId),
    remove: value.change.remove.map(encodeScopedMailboxId),
  },
  lifecycle: encodeUpdateLifecycle(value.lifecycle),
})

const encodePrecondition = (
  value: CollectionCursorPrecondition,
): IpcCursorPrecondition =>
  value.kind === 'absent'
    ? { kind: 'absent' }
    : { kind: 'matches', cursor: encodeCursor(value.cursor) }
export function encodeCollectionSyncCommit(
  value: CollectionSyncCommit,
): IpcCollectionSyncCommit {
  const expectedCursor = encodePrecondition(value.expectedCursor)
  const nextCursor = encodeCursor(value.nextCursor)
  if (value.kind === 'email') {
    const records = (
      items: readonly { email: Email; memberships: readonly EmailMailbox[] }[],
    ) =>
      items.map((item) => ({
        email: encodeEmail(item.email),
        memberships: item.memberships.map(encodeEmailMailbox),
      }))
    return value.mode === 'delta'
      ? {
          kind: 'email',
          mode: 'delta',
          expectedCursor: {
            kind: 'matches',
            cursor: encodeCursor(value.expectedCursor.cursor),
          },
          nextCursor,
          changed: records(value.changed),
          destroyed: value.destroyed.map(encodeScopedEmailId),
        }
      : {
          kind: 'email',
          mode: 'replace',
          expectedCursor,
          nextCursor,
          snapshot: records(value.snapshot),
        }
  }
  if (value.kind === 'mailbox')
    return value.mode === 'delta'
      ? {
          kind: 'mailbox',
          mode: 'delta',
          expectedCursor: {
            kind: 'matches',
            cursor: encodeCursor(value.expectedCursor.cursor),
          },
          nextCursor,
          changed: value.changed.map(encodeMailbox),
          destroyed: value.destroyed.map(encodeScopedMailboxId),
        }
      : {
          kind: 'mailbox',
          mode: 'replace',
          expectedCursor,
          nextCursor,
          snapshot: value.snapshot.map(encodeMailbox),
        }
  return value.mode === 'delta'
    ? {
        kind: 'identity',
        mode: 'delta',
        expectedCursor: {
          kind: 'matches',
          cursor: encodeCursor(value.expectedCursor.cursor),
        },
        nextCursor,
        changed: value.changed.map(encodeIdentity),
        destroyed: value.destroyed.map(encodeScopedIdentityId),
      }
    : {
        kind: 'identity',
        mode: 'replace',
        expectedCursor,
        nextCursor,
        snapshot: value.snapshot.map(encodeIdentity),
      }
}

function decodeLocalChangeHint(value: IpcLocalChangeHint): LocalChangeHint {
  switch (value.kind) {
    case 'accounts':
      return { kind: 'accounts' }
    case 'mailboxes':
    case 'identities':
    case 'emails':
    case 'emailMemberships':
    case 'pendingMutations':
      return {
        kind: value.kind,
        accountKey: accountKeyFromString(value.accountKey),
      }
    case 'emailBody':
    case 'attachmentRefs':
      return { kind: value.kind, emailId: decodeScopedEmailId(value.emailId) }
    case 'mailboxView':
      return { kind: value.kind, spec: decodeMailboxViewSpec(value.spec) }
    case 'syncCursor':
      return {
        kind: value.kind,
        accountKey: accountKeyFromString(value.accountKey),
        dataType: value.dataType,
      }
    default:
      throw new TypeError('Unknown local change hint')
  }
}
export function decodeLocalChangeBatch(
  value: IpcLocalChangeBatch,
): LocalChangeBatch {
  const [first, ...rest] = value.hints
  if (first === undefined)
    throw new TypeError('LocalChangeBatch must contain a hint')
  return {
    hints: [decodeLocalChangeHint(first), ...rest.map(decodeLocalChangeHint)],
  }
}
