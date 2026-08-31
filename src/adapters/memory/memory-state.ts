import { account, remoteAccountRef, type Account } from '../../domain/account'
import { attachmentRef, type AttachmentRef } from '../../domain/attachment-ref'
import { emailBody, type EmailBody } from '../../domain/email-body'
import { email, type Email } from '../../domain/email'
import type {
  AccountKey,
  MutationId,
  ScopedEmailId,
  ScopedIdentityId,
  ScopedMailboxId,
} from '../../domain/ids'
import { identity, type Identity } from '../../domain/identity'
import {
  emailMailbox,
  mailbox,
  type EmailMailbox,
  type Mailbox,
} from '../../domain/mailbox'
import {
  mailboxView,
  type MailboxView,
  type MailboxViewSpec,
} from '../../domain/mailbox-view'
import type {
  EmailUpdateLifecycle,
  PendingMutation,
  SendMutationLifecycle,
} from '../../domain/pending-mutation'
import type { SendIntent } from '../../domain/send-intent'
import {
  collectionSyncCursor,
  type CollectionDataType,
  type CollectionSyncCursor,
} from '../../domain/sync-cursor'

function compoundKey(...parts: readonly string[]): string {
  return parts.map((part) => `${part.length}:${part}`).join('')
}

export function mailboxKey(id: ScopedMailboxId): string {
  return compoundKey(id.accountKey, id.jmapId)
}

export function emailKey(id: ScopedEmailId): string {
  return compoundKey(id.accountKey, id.jmapId)
}

export function identityKey(id: ScopedIdentityId): string {
  return compoundKey(id.accountKey, id.jmapId)
}

export function viewKey(spec: MailboxViewSpec): string {
  return compoundKey(
    spec.mailboxId.accountKey,
    spec.mailboxId.jmapId,
    spec.filter.kind,
    spec.sort.property,
    spec.sort.direction,
  )
}

export function cursorKey(
  accountKey: AccountKey,
  dataType: CollectionDataType,
): string {
  return compoundKey(accountKey, dataType)
}

export function mutationKey(
  accountKey: AccountKey,
  mutationId: MutationId,
): string {
  return compoundKey(accountKey, mutationId)
}

export class MemoryState {
  accounts = new Map<AccountKey, Account>()
  mailboxes = new Map<string, Mailbox>()
  identities = new Map<string, Identity>()
  emails = new Map<string, Email>()
  memberships = new Map<string, readonly EmailMailbox[]>()
  bodies = new Map<string, EmailBody>()
  attachments = new Map<string, readonly AttachmentRef[]>()
  views = new Map<string, MailboxView>()
  cursors = new Map<string, CollectionSyncCursor>()
  mutations = new Map<string, PendingMutation>()
}

export function cloneAccount(value: Account): Account {
  return account(
    value.key,
    remoteAccountRef(value.remoteRef.serviceKey, value.remoteRef.jmapAccountId),
  )
}

export function cloneMailbox(value: Mailbox): Mailbox {
  return mailbox(value)
}

export function cloneIdentity(value: Identity): Identity {
  return identity(value)
}

export function cloneEmail(value: Email): Email {
  return email(value)
}

export function cloneMembership(value: EmailMailbox): EmailMailbox {
  return emailMailbox(value.emailId, value.mailboxId)
}

export function cloneBody(value: EmailBody): EmailBody {
  return emailBody(value)
}

export function cloneAttachment(value: AttachmentRef): AttachmentRef {
  return attachmentRef(value)
}

export function cloneView(value: MailboxView): MailboxView {
  return mailboxView(value)
}

export function cloneCursor(value: CollectionSyncCursor): CollectionSyncCursor {
  return collectionSyncCursor(value)
}

function cloneSendIntent(value: SendIntent): SendIntent {
  return {
    securityMode: value.securityMode,
    identityId: value.identityId,
    from: { name: value.from.name, email: value.from.email },
    replyTo: value.replyTo.map((entry) => ({ ...entry })),
    to: value.to.map((entry) => ({ ...entry })),
    cc: value.cc.map((entry) => ({ ...entry })),
    bcc: value.bcc.map((entry) => ({ ...entry })),
    subject: value.subject,
    body: { text: value.body.text, html: value.body.html },
  }
}

export function cloneMutation(value: PendingMutation): PendingMutation {
  switch (value.kind) {
    case 'send':
      return {
        kind: value.kind,
        mutationId: value.mutationId,
        accountKey: value.accountKey,
        createdAt: value.createdAt,
        intent: cloneSendIntent(value.intent),
        lifecycle: cloneSendLifecycle(value.lifecycle),
      }
    case 'keyword':
      return {
        kind: value.kind,
        mutationId: value.mutationId,
        accountKey: value.accountKey,
        createdAt: value.createdAt,
        emailId: value.emailId,
        change: {
          add: new Set(value.change.add),
          remove: new Set(value.change.remove),
        },
        lifecycle: cloneUpdateLifecycle(value.lifecycle),
      }
    case 'mailboxMembership':
      return {
        kind: value.kind,
        mutationId: value.mutationId,
        accountKey: value.accountKey,
        createdAt: value.createdAt,
        emailId: value.emailId,
        change: {
          add: [...value.change.add],
          remove: [...value.change.remove],
        },
        lifecycle: cloneUpdateLifecycle(value.lifecycle),
      }
  }
}

function cloneSendLifecycle(
  value: SendMutationLifecycle,
): SendMutationLifecycle {
  switch (value.status) {
    case 'confirmed':
      return {
        status: value.status,
        attemptCount: value.attemptCount,
        confirmation: { emailId: value.confirmation.emailId },
      }
    default:
      return { ...value }
  }
}

function cloneUpdateLifecycle(
  value: EmailUpdateLifecycle,
): EmailUpdateLifecycle {
  return { ...value }
}
