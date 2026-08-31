import { describe, expect, it } from 'vitest'

import { emailAddress, type EmailAddress } from '../address'
import { identity, type Identity } from '../identity'
import {
  accountKeyFromString,
  jmapIdentityIdFromString,
  scopedIdentityId,
} from '../ids'
import { sendIntent, type SendBody } from '../send-intent'

function selectedIdentity(overrides: Partial<Identity> = {}): Identity {
  const accountKey = accountKeyFromString('account')

  return identity({
    id: scopedIdentityId(accountKey, jmapIdentityIdFromString('identity')),
    name: 'Sender',
    email: 'sender@example.test',
    replyTo: null,
    bcc: null,
    ...overrides,
  })
}

function validAddress(email = 'recipient@example.test'): EmailAddress {
  return emailAddress('Recipient', email)
}

function createIntent(
  overrides: Partial<{
    identity: Identity
    to: readonly EmailAddress[]
    cc: readonly EmailAddress[]
    bcc: readonly EmailAddress[]
    subject: string
    body: SendBody
  }> = {},
) {
  return sendIntent({
    securityMode: 'plain',
    identity: selectedIdentity(),
    to: [validAddress()],
    cc: [],
    bcc: [],
    subject: 'Subject',
    body: { text: 'Plain body', html: '<p>HTML body</p>' },
    ...overrides,
  })
}

describe('SendIntent resolution', () => {
  it('constructs a complete snapshot and derives From from Identity', () => {
    const selected = selectedIdentity({
      name: 'Authorized Sender',
      email: 'authorized@example.test',
      replyTo: [emailAddress('Reply', 'reply@example.test')],
    })
    const result = createIntent({ identity: selected })

    expect(result.securityMode).toBe('plain')
    expect(result.identityId).toBe(selected.id)
    expect(result.from).toEqual(
      emailAddress('Authorized Sender', 'authorized@example.test'),
    )
    expect(result.replyTo).toEqual([
      emailAddress('Reply', 'reply@example.test'),
    ])
    expect(result.to).toEqual([validAddress()])
    expect(result.cc).toEqual([])
    expect(result.bcc).toEqual([])
    expect(result.subject).toBe('Subject')
    expect(result.body).toEqual({
      text: 'Plain body',
      html: '<p>HTML body</p>',
    })
  })

  it('does not reinterpret an existing intent after Identity refresh', () => {
    const original = selectedIdentity({
      name: 'Original',
      email: 'original@example.test',
    })
    const result = createIntent({ identity: original })
    const refreshed = selectedIdentity({
      name: 'Refreshed',
      email: 'refreshed@example.test',
    })

    expect(refreshed.email).toBe('refreshed@example.test')
    expect(result.identityId).toBe(original.id)
    expect(result.from).toEqual(
      emailAddress('Original', 'original@example.test'),
    )
  })

  it('resolves absent Reply-To to an empty list', () => {
    expect(createIntent().replyTo).toEqual([])
  })

  it('snapshots a present Identity Reply-To list', () => {
    const source: EmailAddress[] = [validAddress('reply@example.test')]
    const selected = selectedIdentity({ replyTo: source })
    const result = createIntent({ identity: selected })

    source.push(validAddress('later@example.test'))

    expect(result.replyTo).toEqual([validAddress('reply@example.test')])
    expect(result.replyTo).not.toBe(selected.replyTo)
  })

  it('merges user and default Bcc with exact-email deduplication', () => {
    const addressA = validAddress('a@example.test')
    const addressB = validAddress('b@example.test')
    const addressC = validAddress('c@example.test')
    const selected = selectedIdentity({ bcc: [addressB, addressC] })

    const result = createIntent({
      identity: selected,
      bcc: [addressA, addressB],
    })

    expect(result.bcc).toEqual([addressA, addressB, addressC])
    expect(result.bcc).not.toBe(selected.bcc)
  })

  it('preserves case-distinct Bcc addresses', () => {
    const upper = validAddress('A@example.test')
    const lower = validAddress('a@example.test')
    const selected = selectedIdentity({ bcc: [lower] })

    expect(createIntent({ identity: selected, bcc: [upper] }).bcc).toEqual([
      upper,
      lower,
    ])
  })

  it('does not deduplicate recipients across To, Cc and Bcc', () => {
    const repeated = validAddress('same@example.test')
    const result = createIntent({
      to: [repeated],
      cc: [repeated],
      bcc: [repeated],
    })

    expect(result.to).toEqual([repeated])
    expect(result.cc).toEqual([repeated])
    expect(result.bcc).toEqual([repeated])
  })

  it('rejects a wildcard Identity for Send', () => {
    const wildcard = selectedIdentity({ email: '*@example.test' })

    expect(() => createIntent({ identity: wildcard })).toThrowError(TypeError)
    expect(() => createIntent({ identity: wildcard })).toThrowError(
      'Wildcard Identity cannot be used for Send in the MVP',
    )
  })
})

describe('SendIntent recipient invariant', () => {
  it('rejects an intent without any effective recipient', () => {
    expect(() => createIntent({ to: [], cc: [], bcc: [] })).toThrowError(
      TypeError,
    )
  })

  it('accepts an Identity default Bcc as the only effective recipient', () => {
    const selected = selectedIdentity({
      bcc: [validAddress('default@example.test')],
    })
    const result = createIntent({
      identity: selected,
      to: [],
      cc: [],
      bcc: [],
    })

    expect(result.bcc).toEqual([validAddress('default@example.test')])
  })
})

describe('SendIntent outbound validation', () => {
  it.each([
    '',
    'missing-at-sign',
    '@example.test',
    'local@',
    'local\r@example.test',
    'local\n@example.test',
    'local\0@example.test',
  ])('rejects unusable outbound email %j', (email) => {
    expect(() => createIntent({ to: [validAddress(email)] })).toThrowError(
      TypeError,
    )
  })

  it.each(['Unsafe\rName', 'Unsafe\nName', 'Unsafe\0Name'])(
    'rejects unsafe outbound display name %j',
    (name) => {
      expect(() =>
        createIntent({
          to: [emailAddress(name, 'recipient@example.test')],
        }),
      ).toThrowError(TypeError)
    },
  )

  it('validates From, Reply-To, To, Cc and effective Bcc', () => {
    const unsafe = emailAddress(null, 'invalid')

    expect(() =>
      createIntent({ identity: selectedIdentity({ email: 'invalid' }) }),
    ).toThrowError(TypeError)
    expect(() =>
      createIntent({ identity: selectedIdentity({ replyTo: [unsafe] }) }),
    ).toThrowError(TypeError)
    expect(() => createIntent({ to: [unsafe] })).toThrowError(TypeError)
    expect(() => createIntent({ cc: [unsafe] })).toThrowError(TypeError)
    expect(() => createIntent({ bcc: [unsafe] })).toThrowError(TypeError)
    expect(() =>
      createIntent({ identity: selectedIdentity({ bcc: [unsafe] }) }),
    ).toThrowError(TypeError)
  })
})

describe('SendIntent snapshot', () => {
  it('snapshots recipient arrays and the body object', () => {
    const to: EmailAddress[] = [validAddress('to@example.test')]
    const cc: EmailAddress[] = [validAddress('cc@example.test')]
    const bcc: EmailAddress[] = [validAddress('bcc@example.test')]
    const body: { text: string; html: string | null } = {
      text: 'Original',
      html: '<p>Original</p>',
    }
    const result = createIntent({ to, cc, bcc, body })

    to.push(validAddress('later-to@example.test'))
    cc.push(validAddress('later-cc@example.test'))
    bcc.push(validAddress('later-bcc@example.test'))
    body.text = 'Changed'
    body.html = null

    expect(result.to).toEqual([validAddress('to@example.test')])
    expect(result.cc).toEqual([validAddress('cc@example.test')])
    expect(result.bcc).toEqual([validAddress('bcc@example.test')])
    expect(result.body).toEqual({
      text: 'Original',
      html: '<p>Original</p>',
    })
  })

  it('accepts empty subject and text with null or empty HTML', () => {
    expect(
      createIntent({ subject: '', body: { text: '', html: null } }),
    ).toMatchObject({ subject: '', body: { text: '', html: null } })
    expect(createIntent({ body: { text: '', html: '' } }).body.html).toBe('')
  })

  it('preserves subject and body strings exactly', () => {
    const result = createIntent({
      subject: '  Subject CASE  ',
      body: { text: '  Text CASE  ', html: '  <p>HTML CASE</p>  ' },
    })

    expect(result.subject).toBe('  Subject CASE  ')
    expect(result.body.text).toBe('  Text CASE  ')
    expect(result.body.html).toBe('  <p>HTML CASE</p>  ')
  })
})
