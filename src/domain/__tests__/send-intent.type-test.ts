import { describe, expect, it } from 'vitest'

import { emailAddress } from '../address'
import { identity } from '../identity'
import {
  accountKeyFromString,
  jmapEmailIdFromString,
  jmapIdentityIdFromString,
  mutationIdFromString,
  scopedEmailId,
  scopedIdentityId,
} from '../ids'
import {
  sendIntent,
  type SendBody,
  type SendIntent,
  type SendSecurityMode,
} from '../send-intent'

type OptionalKeys<Value> = {
  [Key in keyof Value]-?: Record<never, never> extends Pick<Value, Key>
    ? Key
    : never
}[keyof Value]

function expectNever<Value extends never>(value?: Value): void {
  void value
}

function acceptSendIntent(value: SendIntent): SendIntent {
  return value
}

const accountKey = accountKeyFromString('account')
const selectedIdentity = identity({
  id: scopedIdentityId(accountKey, jmapIdentityIdFromString('identity')),
  name: 'Sender',
  email: 'sender@example.test',
  replyTo: null,
  bcc: null,
})
const recipient = emailAddress(null, 'recipient@example.test')
const validFactoryInput = {
  securityMode: 'plain',
  identity: selectedIdentity,
  to: [recipient],
  cc: [],
  bcc: [],
  subject: '',
  body: { text: '', html: null },
} satisfies Parameters<typeof sendIntent>[0]
const validIntent = sendIntent(validFactoryInput)

describe('D-04 SendIntent compile-time invariants', () => {
  it('requires every SendIntent field', () => {
    expectNever<OptionalKeys<SendIntent>>()

    const { identityId: omittedIdentityId, ...withoutIdentityId } = validIntent
    const { securityMode: omittedSecurityMode, ...withoutSecurityMode } =
      validIntent
    const { from: omittedFrom, ...withoutFrom } = validIntent
    const { to: omittedTo, ...withoutTo } = validIntent
    const { body: omittedBody, ...withoutBody } = validIntent

    // @ts-expect-error SendIntent requires identityId.
    const missingIdentityId: SendIntent = withoutIdentityId
    // @ts-expect-error SendIntent requires an explicit security mode.
    const missingSecurityMode: SendIntent = withoutSecurityMode
    // @ts-expect-error SendIntent requires effective From.
    const missingFrom: SendIntent = withoutFrom
    // @ts-expect-error SendIntent requires To, even when the list is empty.
    const missingTo: SendIntent = withoutTo
    // @ts-expect-error SendIntent requires its SendBody snapshot.
    const missingBody: SendIntent = withoutBody

    expect([
      omittedIdentityId,
      omittedSecurityMode,
      omittedFrom,
      omittedTo,
      omittedBody,
      missingIdentityId,
      missingSecurityMode,
      missingFrom,
      missingTo,
      missingBody,
    ]).toHaveLength(10)
  })

  it('keeps SendBody complete and nullable only through null', () => {
    const valid: SendBody = { text: '', html: null }

    // @ts-expect-error SendBody requires text.
    const missingText: SendBody = { html: null }
    // @ts-expect-error SendBody requires html.
    const missingHtml: SendBody = { text: '' }
    const undefinedHtml: SendBody = {
      text: '',
      // @ts-expect-error SendBody.html uses null, not undefined.
      html: undefined,
    }

    expect([valid, missingText, missingHtml, undefinedHtml]).toHaveLength(4)
  })

  it('rejects the wrong scoped ID category', () => {
    const emailId = scopedEmailId(accountKey, jmapEmailIdFromString('email'))

    const wrongIdentityId: SendIntent = {
      ...validIntent,
      // @ts-expect-error SendIntent.identityId requires ScopedIdentityId.
      identityId: emailId,
    }

    expect(wrongIdentityId).toBeDefined()
  })

  it('keeps SendIntent, SendBody and recipient lists readonly', () => {
    if (false) {
      // @ts-expect-error SendIntent.identityId is readonly.
      validIntent.identityId = selectedIdentity.id
      // @ts-expect-error SendIntent.securityMode is readonly.
      validIntent.securityMode = 'boxplotE2eeV1'
      // @ts-expect-error SendIntent.from is readonly.
      validIntent.from = recipient
      // @ts-expect-error SendIntent.subject is readonly.
      validIntent.subject = 'Changed'
      // @ts-expect-error SendIntent.body is readonly.
      validIntent.body = { text: 'Changed', html: null }
      // @ts-expect-error SendBody.text is readonly.
      validIntent.body.text = 'Changed'
      // @ts-expect-error SendIntent.replyTo is a readonly array.
      validIntent.replyTo.push(recipient)
      // @ts-expect-error SendIntent.to is a readonly array.
      validIntent.to.push(recipient)
      // @ts-expect-error SendIntent.cc is a readonly array.
      validIntent.cc.push(recipient)
      // @ts-expect-error SendIntent.bcc is a readonly array.
      validIntent.bcc.push(recipient)
    }

    expect(validIntent).toBeDefined()
  })

  it('does not accept caller-supplied effective identity fields', () => {
    const { securityMode: omittedFactorySecurityMode, ...withoutSecurityMode } =
      validFactoryInput
    // @ts-expect-error SendIntent factory requires an explicit security mode.
    sendIntent(withoutSecurityMode)
    // @ts-expect-error SendIntent factory derives From exclusively from Identity.
    sendIntent({ ...validFactoryInput, from: recipient })
    // @ts-expect-error SendIntent factory derives identityId from Identity.
    sendIntent({ ...validFactoryInput, identityId: selectedIdentity.id })
    // @ts-expect-error SendIntent factory resolves Reply-To from Identity.
    sendIntent({ ...validFactoryInput, replyTo: [] })

    expect(omittedFactorySecurityMode).toBe('plain')
  })

  it('allows exactly the two frozen security modes', () => {
    const plain: SendSecurityMode = 'plain'
    const encrypted: SendSecurityMode = 'boxplotE2eeV1'
    // @ts-expect-error SendSecurityMode is a closed two-value union.
    const invalid: SendSecurityMode = 'quantumMagic'

    expect([plain, encrypted, invalid]).toHaveLength(3)
  })

  it('rejects concepts that do not belong inside SendIntent', () => {
    // @ts-expect-error SendIntent has no redundant AccountKey.
    acceptSendIntent({ ...validIntent, accountKey })
    // @ts-expect-error SendIntent does not retain the live Identity.
    acceptSendIntent({ ...validIntent, identity: selectedIdentity })
    acceptSendIntent({
      ...validIntent,
      // @ts-expect-error MutationId belongs to PendingMutation, not SendIntent.
      mutationId: mutationIdFromString('mutation'),
    })
    acceptSendIntent({
      ...validIntent,
      // @ts-expect-error A remote Email ID does not exist yet for SendIntent.
      emailId: scopedEmailId(accountKey, jmapEmailIdFromString('email')),
    })
    // @ts-expect-error EmailSubmission ID is a transport concern.
    acceptSendIntent({ ...validIntent, emailSubmissionId: 'submission' })
    // @ts-expect-error SMTP envelope is outside the Domain MVP.
    acceptSendIntent({ ...validIntent, envelope: {} })
    // @ts-expect-error Outbound attachments are outside the MVP.
    acceptSendIntent({ ...validIntent, attachments: [] })
    // @ts-expect-error Mailbox membership does not belong to SendIntent.
    acceptSendIntent({ ...validIntent, mailboxIds: [] })
    // @ts-expect-error PendingMutation wraps SendIntent later, not vice versa.
    acceptSendIntent({ ...validIntent, pendingMutation: null })

    expect(true).toBe(true)
  })
})
