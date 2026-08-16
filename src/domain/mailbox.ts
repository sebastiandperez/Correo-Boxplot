import {
  sameScopedEmailId,
  sameScopedMailboxId,
  type ScopedEmailId,
  type ScopedMailboxId,
} from './ids'

export type MailboxRole = string

export type MailboxRights = Readonly<{
  mayReadItems: boolean
  mayAddItems: boolean
  mayRemoveItems: boolean
  maySetSeen: boolean
  maySetKeywords: boolean
  maySubmit: boolean
}>

export type Mailbox = Readonly<{
  id: ScopedMailboxId
  name: string
  parent: ScopedMailboxId | null
  role: MailboxRole | null
  sortOrder: number
  totalEmails: number
  unreadEmails: number
  rights: MailboxRights
}>

export type EmailMailbox = Readonly<{
  emailId: ScopedEmailId
  mailboxId: ScopedMailboxId
}>

const MAX_SORT_ORDER = 2 ** 31

export function mailboxRights(input: MailboxRights): MailboxRights {
  return {
    mayReadItems: input.mayReadItems,
    mayAddItems: input.mayAddItems,
    mayRemoveItems: input.mayRemoveItems,
    maySetSeen: input.maySetSeen,
    maySetKeywords: input.maySetKeywords,
    maySubmit: input.maySubmit,
  }
}

function assertMailboxCount(value: number, fieldName: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${fieldName} must be a non-negative safe integer`)
  }
}

export function mailbox(input: Mailbox): Mailbox {
  if (input.name.length === 0) {
    throw new TypeError('Mailbox name must not be empty')
  }

  if (input.parent !== null) {
    if (input.parent.accountKey !== input.id.accountKey) {
      throw new TypeError('Mailbox parent must belong to the same AccountKey')
    }

    if (sameScopedMailboxId(input.parent, input.id)) {
      throw new TypeError('Mailbox cannot be its own parent')
    }
  }

  if (input.role === '') {
    throw new TypeError('Mailbox role must be null or non-empty')
  }

  if (
    !Number.isInteger(input.sortOrder) ||
    input.sortOrder < 0 ||
    input.sortOrder >= MAX_SORT_ORDER
  ) {
    throw new TypeError(
      'Mailbox sortOrder must be an integer between 0 and 2^31 - 1',
    )
  }

  assertMailboxCount(input.totalEmails, 'Mailbox totalEmails')
  assertMailboxCount(input.unreadEmails, 'Mailbox unreadEmails')

  if (input.unreadEmails > input.totalEmails) {
    throw new TypeError('Mailbox unreadEmails must not exceed totalEmails')
  }

  return {
    id: input.id,
    name: input.name,
    parent: input.parent,
    role: input.role,
    sortOrder: input.sortOrder,
    totalEmails: input.totalEmails,
    unreadEmails: input.unreadEmails,
    rights: mailboxRights(input.rights),
  }
}

export function emailMailbox(
  emailId: ScopedEmailId,
  mailboxId: ScopedMailboxId,
): EmailMailbox {
  if (emailId.accountKey !== mailboxId.accountKey) {
    throw new TypeError(
      'EmailMailbox emailId and mailboxId must belong to the same AccountKey',
    )
  }

  return { emailId, mailboxId }
}

export function sameEmailMailbox(
  left: EmailMailbox,
  right: EmailMailbox,
): boolean {
  return (
    sameScopedEmailId(left.emailId, right.emailId) &&
    sameScopedMailboxId(left.mailboxId, right.mailboxId)
  )
}
