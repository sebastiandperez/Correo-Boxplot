import { describe, expect, it } from 'vitest'

import { emailBody, type EmailBody } from '../email-body'
import {
  accountKeyFromString,
  jmapBlobIdFromString,
  jmapEmailIdFromString,
  jmapMailboxIdFromString,
  scopedBlobId,
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
const validBody: EmailBody = {
  emailId: scopedEmailId(accountKey, jmapEmailIdFromString('email')),
  text: null,
  html: null,
}

describe('D-09 compile-time invariants', () => {
  it('requires every EmailBody field', () => {
    expectNever<OptionalKeys<EmailBody>>()

    const { emailId: omittedEmailId, ...withoutEmailId } = validBody
    const { text: omittedText, ...withoutText } = validBody
    const { html: omittedHtml, ...withoutHtml } = validBody

    // @ts-expect-error EmailBody requires its scoped Email ID.
    const missingEmailId: EmailBody = withoutEmailId
    // @ts-expect-error EmailBody requires the text representation field.
    const missingText: EmailBody = withoutText
    // @ts-expect-error EmailBody requires the HTML representation field.
    const missingHtml: EmailBody = withoutHtml

    expect([
      omittedEmailId,
      omittedText,
      omittedHtml,
      missingEmailId,
      missingText,
      missingHtml,
    ]).toHaveLength(6)
  })

  it('uses null rather than undefined for absent representations', () => {
    expect(() =>
      emailBody({ ...validBody, text: null, html: null }),
    ).not.toThrow()

    // @ts-expect-error EmailBody.text does not use undefined for known absence.
    const undefinedText: EmailBody = { ...validBody, text: undefined }
    // @ts-expect-error EmailBody.html does not use undefined for known absence.
    const undefinedHtml: EmailBody = { ...validBody, html: undefined }

    expect([undefinedText, undefinedHtml]).toHaveLength(2)
  })

  it('accepts only ScopedEmailId as identity', () => {
    const mailboxId = scopedMailboxId(
      accountKey,
      jmapMailboxIdFromString('mailbox'),
    )
    const blobId = scopedBlobId(accountKey, jmapBlobIdFromString('blob'))

    // @ts-expect-error EmailBody.emailId cannot be a raw string.
    const rawId: EmailBody = { ...validBody, emailId: 'email' }
    // @ts-expect-error EmailBody.emailId cannot be a ScopedMailboxId.
    const mailboxAsEmail: EmailBody = { ...validBody, emailId: mailboxId }
    // @ts-expect-error EmailBody.emailId cannot be a ScopedBlobId.
    const blobAsEmail: EmailBody = { ...validBody, emailId: blobId }

    expect([rawId, mailboxAsEmail, blobAsEmail]).toHaveLength(3)
  })

  it('keeps every EmailBody field readonly', () => {
    const value = emailBody(validBody)

    if (false) {
      // @ts-expect-error EmailBody.emailId is readonly.
      value.emailId = validBody.emailId
      // @ts-expect-error EmailBody.text is readonly.
      value.text = 'changed'
      // @ts-expect-error EmailBody.html is readonly.
      value.html = '<p>changed</p>'
    }

    expect(value).toBeDefined()
  })

  it('rejects transport, persistence, rendering, and inline concepts', () => {
    // @ts-expect-error EmailBody has no fetch timestamp.
    emailBody({ ...validBody, fetchedAt: 'now' })
    // @ts-expect-error EmailBody completeness is expressed by existence.
    emailBody({ ...validBody, isComplete: true })
    // @ts-expect-error EmailBody does not model transport truncation.
    emailBody({ ...validBody, isTruncated: false })
    // @ts-expect-error EmailBody does not persist decoding diagnostics.
    emailBody({ ...validBody, isEncodingProblem: false })
    // @ts-expect-error EmailBody has no duplicated availability state.
    emailBody({ ...validBody, bodyAvailability: 'cached' })
    // @ts-expect-error EmailBody does not expose a MIME body structure.
    emailBody({ ...validBody, bodyStructure: null })
    // @ts-expect-error EmailBody does not expose JMAP body values.
    emailBody({ ...validBody, bodyValues: {} })
    // @ts-expect-error EmailBody has no MIME text-part collection.
    emailBody({ ...validBody, textBody: [] })
    // @ts-expect-error EmailBody has no MIME HTML-part collection.
    emailBody({ ...validBody, htmlBody: [] })
    // @ts-expect-error EmailBody has no inline attachments.
    emailBody({ ...validBody, attachments: [] })
    // @ts-expect-error EmailBody does not expose MIME part IDs.
    emailBody({ ...validBody, partId: 'part' })
    // @ts-expect-error EmailBody has no Blob identity.
    emailBody({ ...validBody, blobId: null })
    // @ts-expect-error EmailBody does not persist sanitized HTML.
    emailBody({ ...validBody, sanitizedHtml: '' })
    // @ts-expect-error EmailBody stores only emailId, not a live Email entity.
    emailBody({ ...validBody, email: null })

    expect(true).toBe(true)
  })
})
