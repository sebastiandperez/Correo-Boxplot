import { describe, expect, it } from 'vitest'

import {
  emailMailbox,
  mailbox,
  mailboxRights,
  type EmailMailbox,
  type Mailbox,
  type MailboxRights,
  type MailboxRole,
} from '../mailbox'
import {
  accountKeyFromString,
  jmapEmailIdFromString,
  jmapMailboxIdFromString,
  scopedEmailId,
  scopedMailboxId,
} from '../ids'

type OptionalKeys<Value> = {
  [Key in keyof Value]-?: Record<never, never> extends Pick<Value, Key>
    ? Key
    : never
}[keyof Value]

function expectNever<Value extends never>(value?: Value): void {
  void value
}

const accountKey = accountKeyFromString('account')
const mailboxId = scopedMailboxId(
  accountKey,
  jmapMailboxIdFromString('mailbox'),
)
const emailId = scopedEmailId(accountKey, jmapEmailIdFromString('email'))
const rights = mailboxRights({
  mayReadItems: true,
  mayAddItems: true,
  mayRemoveItems: true,
  maySetSeen: true,
  maySetKeywords: true,
  maySubmit: true,
})
const validMailbox: Mailbox = {
  id: mailboxId,
  name: 'Inbox',
  parent: null,
  role: 'future-role',
  sortOrder: 0,
  totalEmails: 0,
  unreadEmails: 0,
  rights,
}

describe('D-05 Mailbox compile-time invariants', () => {
  it('requires every Mailbox and MailboxRights field', () => {
    expectNever<OptionalKeys<Mailbox>>()
    expectNever<OptionalKeys<MailboxRights>>()

    const { id: omittedId, ...withoutId } = validMailbox
    const { parent: omittedParent, ...withoutParent } = validMailbox
    const { rights: omittedRights, ...withoutRights } = validMailbox
    const { maySubmit: omittedMaySubmit, ...withoutMaySubmit } = rights

    // @ts-expect-error Mailbox requires its ScopedMailboxId.
    const missingId: Mailbox = withoutId
    // @ts-expect-error Mailbox requires parent, even when it is null.
    const missingParent: Mailbox = withoutParent
    // @ts-expect-error Mailbox requires its core rights.
    const missingRights: Mailbox = withoutRights
    // @ts-expect-error MailboxRights requires maySubmit separately.
    const missingMaySubmit: MailboxRights = withoutMaySubmit

    expect([
      omittedId,
      omittedParent,
      omittedRights,
      omittedMaySubmit,
      missingId,
      missingParent,
      missingRights,
      missingMaySubmit,
    ]).toHaveLength(8)
  })

  it('keeps role extensible and null distinct from undefined', () => {
    const futureRole: MailboxRole = 'provider-future-role'
    const undefinedParent: Mailbox = {
      ...validMailbox,
      // @ts-expect-error Mailbox.parent uses null, not undefined.
      parent: undefined,
    }
    const undefinedRole: Mailbox = {
      ...validMailbox,
      // @ts-expect-error Mailbox.role uses null, not undefined.
      role: undefined,
    }

    expect([futureRole, undefinedParent, undefinedRole]).toHaveLength(3)
  })

  it('rejects scoped IDs from the wrong semantic category', () => {
    // @ts-expect-error Mailbox.id requires ScopedMailboxId, not ScopedEmailId.
    const wrongId: Mailbox = { ...validMailbox, id: emailId }
    // @ts-expect-error Mailbox.parent requires ScopedMailboxId, not ScopedEmailId.
    const wrongParent: Mailbox = { ...validMailbox, parent: emailId }

    expect([wrongId, wrongParent]).toHaveLength(2)
  })

  it('keeps Mailbox, rights and EmailMailbox readonly', () => {
    const value = mailbox(validMailbox)
    const membership = emailMailbox(emailId, mailboxId)

    if (false) {
      // @ts-expect-error Mailbox.id is readonly.
      value.id = mailboxId
      // @ts-expect-error Mailbox.name is readonly.
      value.name = 'Changed'
      // @ts-expect-error Mailbox.parent is readonly.
      value.parent = null
      // @ts-expect-error Mailbox.rights is readonly.
      value.rights = rights
      // @ts-expect-error MailboxRights fields are readonly.
      value.rights.mayReadItems = false
      // @ts-expect-error EmailMailbox.emailId is readonly.
      membership.emailId = emailId
      // @ts-expect-error EmailMailbox.mailboxId is readonly.
      membership.mailboxId = mailboxId
    }

    expect([value, membership]).toHaveLength(2)
  })

  it('requires exact EmailMailbox ID categories', () => {
    expectNever<OptionalKeys<EmailMailbox>>()

    // @ts-expect-error EmailMailbox.emailId requires ScopedEmailId.
    const wrongEmailId: EmailMailbox = { emailId: mailboxId, mailboxId }
    // @ts-expect-error EmailMailbox.mailboxId requires ScopedMailboxId.
    const wrongMailboxId: EmailMailbox = { emailId, mailboxId: emailId }
    // @ts-expect-error EmailMailbox requires mailboxId.
    const missingMailboxId: EmailMailbox = { emailId }

    expect([wrongEmailId, wrongMailboxId, missingMailboxId]).toHaveLength(3)
  })

  it('rejects non-core Mailbox and MailboxRights concepts', () => {
    // @ts-expect-error Mailbox has no canonical children collection.
    mailbox({ ...validMailbox, children: [] })
    // @ts-expect-error Mailbox has no inline Emails.
    mailbox({ ...validMailbox, emails: [] })
    // @ts-expect-error Mailbox excludes totalThreads from the MVP core.
    mailbox({ ...validMailbox, totalThreads: 0 })
    // @ts-expect-error Mailbox excludes unreadThreads from the MVP core.
    mailbox({ ...validMailbox, unreadThreads: 0 })
    // @ts-expect-error Mailbox excludes isSubscribed from the MVP core.
    mailbox({ ...validMailbox, isSubscribed: true })
    // @ts-expect-error MailboxRights excludes mayRename.
    mailboxRights({ ...rights, mayRename: true })
    // @ts-expect-error MailboxRights excludes mayDelete.
    mailboxRights({ ...rights, mayDelete: true })
    // @ts-expect-error MailboxRights excludes mayCreateChild.
    mailboxRights({ ...rights, mayCreateChild: true })

    expect(true).toBe(true)
  })
})
