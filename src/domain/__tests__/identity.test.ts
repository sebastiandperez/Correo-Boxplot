import { describe, expect, it } from 'vitest'

import { emailAddress, type EmailAddress } from '../address'
import { identity, isWildcardIdentity, type Identity } from '../identity'
import {
  accountKeyFromString,
  jmapIdentityIdFromString,
  scopedIdentityId,
} from '../ids'

function identityInput(overrides: Partial<Identity> = {}): Identity {
  const accountKey = accountKeyFromString('account')

  return {
    id: scopedIdentityId(accountKey, jmapIdentityIdFromString('identity')),
    name: 'Sender',
    email: 'sender@example.test',
    replyTo: [emailAddress('Reply', 'reply@example.test')],
    bcc: [emailAddress('Archive', 'archive@example.test')],
    ...overrides,
  }
}

describe('Identity', () => {
  it('constructs the complete Identity projection', () => {
    const input = identityInput()

    expect(identity(input)).toEqual(input)
  })

  it('rejects an empty email', () => {
    expect(() => identity(identityInput({ email: '' }))).toThrowError(TypeError)
    expect(() => identity(identityInput({ email: '' }))).toThrowError(
      'Identity email must not be empty',
    )
  })

  it('accepts an empty name', () => {
    expect(identity(identityInput({ name: '' })).name).toBe('')
  })

  it('represents and recognizes a wildcard Identity', () => {
    const wildcard = identity(identityInput({ email: '*@example.test' }))
    const ordinary = identity(identityInput())

    expect(wildcard.email).toBe('*@example.test')
    expect(isWildcardIdentity(wildcard)).toBe(true)
    expect(isWildcardIdentity(ordinary)).toBe(false)
  })

  it('preserves name and email exactly without normalization', () => {
    const result = identity(
      identityInput({
        name: '  Mixed CASE  ',
        email: '  Sender@Example.TEST  ',
      }),
    )

    expect(result.name).toBe('  Mixed CASE  ')
    expect(result.email).toBe('  Sender@Example.TEST  ')
  })

  it('preserves null replyTo and bcc', () => {
    const result = identity(identityInput({ replyTo: null, bcc: null }))

    expect(result.replyTo).toBeNull()
    expect(result.bcc).toBeNull()
  })

  it('snapshots present replyTo and bcc lists', () => {
    const replyTo: EmailAddress[] = [
      emailAddress('Reply', 'reply@example.test'),
    ]
    const bcc: EmailAddress[] = [
      emailAddress('Archive', 'archive@example.test'),
    ]
    const result = identity(identityInput({ replyTo, bcc }))

    replyTo.push(emailAddress('Later', 'later-reply@example.test'))
    bcc.push(emailAddress('Later', 'later-bcc@example.test'))

    expect(result.replyTo).toEqual([
      emailAddress('Reply', 'reply@example.test'),
    ])
    expect(result.bcc).toEqual([
      emailAddress('Archive', 'archive@example.test'),
    ])
  })
})
