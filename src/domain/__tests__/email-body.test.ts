import { describe, expect, it } from 'vitest'

import { emailBody, sameEmailBodyIdentity, type EmailBody } from '../email-body'
import {
  accountKeyFromString,
  jmapEmailIdFromString,
  scopedEmailId,
  type AccountKey,
} from '../ids'

function emailId(
  value: string,
  accountKey: AccountKey = accountKeyFromString('account-a'),
) {
  return scopedEmailId(accountKey, jmapEmailIdFromString(value))
}

function body(
  text: string | null,
  html: string | null,
  id = emailId('email-1'),
): EmailBody {
  return emailBody({ emailId: id, text, html })
}

describe('EmailBody construction', () => {
  it.each([
    ['text and HTML', 'hello', '<p>hello</p>'],
    ['text only', 'hello', null],
    ['HTML only', null, '<p>hello</p>'],
    ['neither textual representation', null, null],
  ] as const)('accepts %s', (_, text, html) => {
    const result = body(text, html)

    expect(result).toEqual({
      emailId: emailId('email-1'),
      text,
      html,
    })
    expect(Object.keys(result).sort()).toEqual(['emailId', 'html', 'text'])
  })

  it.each([
    ['', null],
    [null, ''],
    ['', ''],
  ] as const)(
    'preserves empty representations: text=%s html=%s',
    (text, html) => {
      const result = body(text, html)

      expect(result.text).toBe(text)
      expect(result.html).toBe(html)
    },
  )

  it('preserves text and HTML exactly without normalization', () => {
    const text = '  Hello\r\nWorld  '
    const html = ' <DIV>Test</DIV> '
    const result = body(text, html)

    expect(result.text).toBe(text)
    expect(result.html).toBe(html)
  })

  it('preserves raw untrusted HTML without sanitizing it', () => {
    const html = '<script>alert(1)</script>'

    expect(body(null, html).html).toBe(html)
  })
})

describe('EmailBody identity', () => {
  it('ignores body content when the scoped Email identity is equal', () => {
    const left = body('first', '<p>first</p>')
    const right = body('second', null)

    expect(sameEmailBodyIdentity(left, right)).toBe(true)
  })

  it('distinguishes different Email IDs', () => {
    const left = body('same', null, emailId('email-1'))
    const right = body('same', null, emailId('email-2'))

    expect(sameEmailBodyIdentity(left, right)).toBe(false)
  })

  it('distinguishes the same JMAP Email ID under different Accounts', () => {
    const accountA = accountKeyFromString('account-a')
    const accountB = accountKeyFromString('account-b')
    const left = body('same', null, emailId('shared', accountA))
    const right = body('same', null, emailId('shared', accountB))

    expect(sameEmailBodyIdentity(left, right)).toBe(false)
  })
})
