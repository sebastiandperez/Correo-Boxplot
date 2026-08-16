import { describe, expect, it } from 'vitest'

import { emailAddress } from '../address'
import { email, keywordSet, type Email, type EmailInput } from '../email'
import {
  accountKeyFromString,
  jmapBlobIdFromString,
  jmapEmailIdFromString,
  jmapIdentityIdFromString,
  jmapMailboxIdFromString,
  jmapThreadIdFromString,
  scopedBlobId,
  scopedEmailId,
  scopedIdentityId,
  scopedMailboxId,
  scopedThreadId,
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
const validInput: EmailInput = {
  id: scopedEmailId(accountKey, jmapEmailIdFromString('email')),
  blobId: scopedBlobId(accountKey, jmapBlobIdFromString('blob')),
  threadId: scopedThreadId(accountKey, jmapThreadIdFromString('thread')),
  sender: null,
  from: [emailAddress('Author', 'author@example.test')],
  replyTo: [],
  to: [emailAddress(null, 'recipient@example.test')],
  cc: null,
  bcc: [],
  subject: null,
  sentAt: null,
  receivedAt: '2026-08-16T12:00:00Z',
  size: 0,
  preview: '',
  hasAttachment: false,
  keywords: keywordSet([]),
}

describe('D-02 compile-time invariants', () => {
  it('requires every Email and EmailInput field', () => {
    expectNever<OptionalKeys<Email>>()
    expectNever<OptionalKeys<EmailInput>>()

    const { id: omittedId, ...withoutId } = validInput
    const { from: omittedFrom, ...withoutFrom } = validInput
    const { receivedAt: omittedReceivedAt, ...withoutReceivedAt } = validInput
    const { keywords: omittedKeywords, ...withoutKeywords } = validInput

    // @ts-expect-error EmailInput requires its scoped Email ID.
    const missingId: EmailInput = withoutId
    // @ts-expect-error EmailInput requires every address-list field.
    const missingFrom: EmailInput = withoutFrom
    // @ts-expect-error EmailInput requires receivedAt metadata.
    const missingReceivedAt: EmailInput = withoutReceivedAt
    // @ts-expect-error EmailInput requires its KeywordSet.
    const missingKeywords: EmailInput = withoutKeywords

    expect([
      omittedId,
      omittedFrom,
      omittedReceivedAt,
      omittedKeywords,
      missingId,
      missingFrom,
      missingReceivedAt,
      missingKeywords,
    ]).toHaveLength(8)
  })

  it('uses null rather than undefined for semantic absence', () => {
    expect(() =>
      email({ ...validInput, from: null, subject: null, sentAt: null }),
    ).not.toThrow()

    // @ts-expect-error Email.from does not use undefined for known absence.
    const undefinedFrom: EmailInput = { ...validInput, from: undefined }
    // @ts-expect-error Email.subject does not use undefined for known absence.
    const undefinedSubject: EmailInput = { ...validInput, subject: undefined }
    // @ts-expect-error Email.sentAt does not use undefined for known absence.
    const undefinedSentAt: EmailInput = { ...validInput, sentAt: undefined }

    expect([undefinedFrom, undefinedSubject, undefinedSentAt]).toHaveLength(3)
  })

  it('rejects IDs from the wrong semantic category', () => {
    const mailboxId = scopedMailboxId(
      accountKey,
      jmapMailboxIdFromString('mailbox'),
    )
    const emailId = scopedEmailId(
      accountKey,
      jmapEmailIdFromString('other-email'),
    )
    const blobId = scopedBlobId(accountKey, jmapBlobIdFromString('other-blob'))
    const identityId = scopedIdentityId(
      accountKey,
      jmapIdentityIdFromString('identity'),
    )

    // @ts-expect-error Email.id requires ScopedEmailId, not ScopedMailboxId.
    const wrongId: EmailInput = { ...validInput, id: mailboxId }
    // @ts-expect-error Email.blobId requires ScopedBlobId, not ScopedEmailId.
    const wrongBlobId: EmailInput = { ...validInput, blobId: emailId }
    // @ts-expect-error Email.threadId requires ScopedThreadId, not ScopedBlobId.
    const wrongThreadId: EmailInput = { ...validInput, threadId: blobId }

    expect([wrongId, wrongBlobId, wrongThreadId, identityId]).toHaveLength(4)
  })

  it('keeps Email fields and nested collections readonly', () => {
    const value = email(validInput)

    if (false) {
      // @ts-expect-error Email.id is readonly.
      value.id = validInput.id
      // @ts-expect-error Email.subject is readonly.
      value.subject = 'Changed'
      // @ts-expect-error Email.keywords is readonly.
      value.keywords = keywordSet(['changed'])

      if (value.to !== null) {
        // @ts-expect-error Email address lists are readonly arrays.
        value.to.push(emailAddress(null, 'later@example.test'))
      }

      // @ts-expect-error KeywordSet exposes no mutable add operation.
      value.keywords.add('$flagged')
    }

    expect(value).toBeDefined()
  })

  it('rejects forbidden inline concepts', () => {
    // @ts-expect-error EmailInput has no inline mailbox membership.
    email({ ...validInput, mailboxIds: [] })
    // @ts-expect-error EmailInput has no inline body.
    email({ ...validInput, body: null })
    // @ts-expect-error EmailInput has no inline attachments.
    email({ ...validInput, attachments: [] })
    // @ts-expect-error EmailInput has no derived isRead authority.
    email({ ...validInput, isRead: false })
    // @ts-expect-error EmailInput has no inline PendingMutation.
    email({ ...validInput, pendingMutation: null })

    expect(true).toBe(true)
  })
})
