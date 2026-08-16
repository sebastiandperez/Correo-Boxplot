import { describe, expect, it } from 'vitest'

import { emailAddress } from '../address'
import { identity, type Identity } from '../identity'
import {
  accountKeyFromString,
  jmapEmailIdFromString,
  jmapIdentityIdFromString,
  scopedEmailId,
  scopedIdentityId,
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
const validIdentity: Identity = {
  id: scopedIdentityId(accountKey, jmapIdentityIdFromString('identity')),
  name: 'Sender',
  email: 'sender@example.test',
  replyTo: null,
  bcc: [emailAddress(null, 'archive@example.test')],
}

describe('D-04 Identity compile-time invariants', () => {
  it('requires every Identity field', () => {
    expectNever<OptionalKeys<Identity>>()

    const { id: omittedId, ...withoutId } = validIdentity
    const { name: omittedName, ...withoutName } = validIdentity
    const { email: omittedEmail, ...withoutEmail } = validIdentity
    const { replyTo: omittedReplyTo, ...withoutReplyTo } = validIdentity
    const { bcc: omittedBcc, ...withoutBcc } = validIdentity

    // @ts-expect-error Identity requires its ScopedIdentityId.
    const missingId: Identity = withoutId
    // @ts-expect-error Identity requires name.
    const missingName: Identity = withoutName
    // @ts-expect-error Identity requires email.
    const missingEmail: Identity = withoutEmail
    // @ts-expect-error Identity requires replyTo.
    const missingReplyTo: Identity = withoutReplyTo
    // @ts-expect-error Identity requires bcc.
    const missingBcc: Identity = withoutBcc

    expect([
      omittedId,
      omittedName,
      omittedEmail,
      omittedReplyTo,
      omittedBcc,
      missingId,
      missingName,
      missingEmail,
      missingReplyTo,
      missingBcc,
    ]).toHaveLength(10)
  })

  it('rejects IDs from another semantic category', () => {
    const emailId = scopedEmailId(accountKey, jmapEmailIdFromString('email'))

    // @ts-expect-error Identity.id requires ScopedIdentityId, not ScopedEmailId.
    const wrongId: Identity = { ...validIdentity, id: emailId }

    expect(wrongId).toBeDefined()
  })

  it('uses null rather than undefined for known address-list absence', () => {
    const undefinedReplyTo: Identity = {
      ...validIdentity,
      // @ts-expect-error Identity.replyTo uses null, not undefined.
      replyTo: undefined,
    }
    const undefinedBcc: Identity = {
      ...validIdentity,
      // @ts-expect-error Identity.bcc uses null, not undefined.
      bcc: undefined,
    }

    expect([undefinedReplyTo, undefinedBcc]).toHaveLength(2)
  })

  it('keeps Identity fields and address lists readonly', () => {
    const value = identity(validIdentity)

    if (false) {
      // @ts-expect-error Identity.id is readonly.
      value.id = validIdentity.id
      // @ts-expect-error Identity.name is readonly.
      value.name = 'Changed'
      // @ts-expect-error Identity.email is readonly.
      value.email = 'changed@example.test'
      // @ts-expect-error Identity.replyTo is readonly.
      value.replyTo = null
      // @ts-expect-error Identity.bcc is readonly.
      value.bcc = null

      if (value.replyTo !== null) {
        // @ts-expect-error Identity.replyTo is a readonly array.
        value.replyTo.push(emailAddress(null, 'later@example.test'))
      }
    }

    expect(value).toBeDefined()
  })
})
