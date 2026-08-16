import { describe, expect, it } from 'vitest'

import {
  emailAddress,
  type EmailAddress,
  type EmailAddressList,
} from '../address'

describe('D-03 compile-time invariants', () => {
  it('requires name and email with their exact nullable semantics', () => {
    const valid = emailAddress(null, '')

    // @ts-expect-error EmailAddress requires a name property.
    const missingName: EmailAddress = { email: 'user@example.test' }
    // @ts-expect-error EmailAddress requires an email property.
    const missingEmail: EmailAddress = { name: null }
    // @ts-expect-error EmailAddress name accepts only string or null.
    const numericName: EmailAddress = { name: 42, email: 'user@example.test' }
    const undefinedName: EmailAddress = {
      // @ts-expect-error EmailAddress name uses null, not undefined, for known absence.
      name: undefined,
      email: 'user@example.test',
    }
    // @ts-expect-error EmailAddress email must be a present string.
    const undefinedEmail: EmailAddress = { name: null, email: undefined }

    expect([
      valid,
      missingName,
      missingEmail,
      numericName,
      undefinedName,
      undefinedEmail,
    ]).toHaveLength(6)
  })

  it('keeps addresses and present lists readonly', () => {
    const address = emailAddress('Name', 'user@example.test')
    const list: EmailAddressList = [address]

    if (false) {
      // @ts-expect-error EmailAddress name is readonly.
      address.name = null
      // @ts-expect-error EmailAddress email is readonly.
      address.email = 'other@example.test'

      if (list !== null) {
        // @ts-expect-error A present EmailAddressList is a readonly array.
        list.push(address)
      }
    }

    expect(list).toHaveLength(1)
  })

  it('does not substitute undefined for known absence', () => {
    // @ts-expect-error EmailAddressList absence is represented by null, not undefined.
    const undefinedList: EmailAddressList = undefined

    expect(undefinedList).toBeUndefined()
  })
})
