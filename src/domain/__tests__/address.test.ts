import { describe, expect, it } from 'vitest'

import { emailAddress, type EmailAddressList } from '../address'

describe('EmailAddress', () => {
  it('preserves name and email exactly', () => {
    expect(emailAddress('  Mixed CASE  ', '  User@Example.COM  ')).toEqual({
      name: '  Mixed CASE  ',
      email: '  User@Example.COM  ',
    })
  })

  it('accepts a known absent name', () => {
    expect(emailAddress(null, 'user@example.test')).toEqual({
      name: null,
      email: 'user@example.test',
    })
  })

  it('accepts imperfect and empty parsed address values', () => {
    expect(emailAddress(null, 'broken-address').email).toBe('broken-address')
    expect(emailAddress('Known name', '').email).toBe('')
  })
})

describe('EmailAddressList', () => {
  it('keeps known absence distinct from a known empty list', () => {
    const absent: EmailAddressList = null
    const empty: EmailAddressList = []

    expect(absent).toBeNull()
    expect(empty).toEqual([])
    expect(empty).not.toBeNull()
  })
})
