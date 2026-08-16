import { describe, expect, it } from 'vitest'

import { emailAddress, type EmailAddress } from '../address'
import { email, keywordSet, type EmailInput, type KeywordSet } from '../email'
import {
  accountKeyFromString,
  jmapBlobIdFromString,
  jmapEmailIdFromString,
  jmapThreadIdFromString,
  scopedBlobId,
  scopedEmailId,
  scopedThreadId,
  type AccountKey,
} from '../ids'

function completeEmailInput(
  accountKey: AccountKey = accountKeyFromString('account-a'),
): EmailInput {
  return {
    id: scopedEmailId(accountKey, jmapEmailIdFromString('email-1')),
    blobId: scopedBlobId(accountKey, jmapBlobIdFromString('blob-1')),
    threadId: scopedThreadId(accountKey, jmapThreadIdFromString('thread-1')),

    sender: null,
    from: [emailAddress('Author', 'author@example.test')],
    replyTo: [],
    to: [emailAddress(null, 'recipient@example.test')],
    cc: null,
    bcc: [],

    subject: 'Subject',
    sentAt: '2026-08-16T12:00:00Z',
    receivedAt: '2026-08-16T12:00:01Z',

    size: 42,
    preview: '  Exact Preview  ',
    hasAttachment: true,

    keywords: keywordSet(['$seen', 'custom-keyword']),
  }
}

describe('KeywordSet', () => {
  it('deduplicates values while preserving custom text and case', () => {
    const keywords = keywordSet([
      '$seen',
      '$seen',
      'Custom-Keyword',
      '  spaced keyword  ',
    ])

    expect([...keywords]).toEqual([
      '$seen',
      'Custom-Keyword',
      '  spaced keyword  ',
    ])
  })

  it('rejects an empty keyword', () => {
    expect(() => keywordSet(['valid', ''])).toThrowError(TypeError)
    expect(() => keywordSet(['valid', ''])).toThrowError(
      'Keyword must not be empty',
    )
  })
})

describe('Email construction', () => {
  it('constructs the complete projection without extra fields', () => {
    const input = completeEmailInput()
    const result = email(input)

    expect(result).toEqual(input)
    expect(Object.keys(result).sort()).toEqual(
      [
        'id',
        'blobId',
        'threadId',
        'sender',
        'from',
        'replyTo',
        'to',
        'cc',
        'bcc',
        'subject',
        'sentAt',
        'receivedAt',
        'size',
        'preview',
        'hasAttachment',
        'keywords',
      ].sort(),
    )
  })

  it('accepts IDs scoped to the same Account', () => {
    expect(() => email(completeEmailInput())).not.toThrow()
  })

  it('rejects a Blob ID from another Account', () => {
    const input = completeEmailInput()
    const otherAccount = accountKeyFromString('account-b')

    expect(() =>
      email({
        ...input,
        blobId: scopedBlobId(otherAccount, jmapBlobIdFromString('blob-1')),
      }),
    ).toThrowError(TypeError)
  })

  it('rejects a Thread ID from another Account', () => {
    const input = completeEmailInput()
    const otherAccount = accountKeyFromString('account-b')

    expect(() =>
      email({
        ...input,
        threadId: scopedThreadId(
          otherAccount,
          jmapThreadIdFromString('thread-1'),
        ),
      }),
    ).toThrowError(TypeError)
  })

  it.each([0, Number.MAX_SAFE_INTEGER])('accepts size %s', (size) => {
    expect(email({ ...completeEmailInput(), size }).size).toBe(size)
  })

  it.each([
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])('rejects invalid size %s', (size) => {
    expect(() => email({ ...completeEmailInput(), size })).toThrowError(
      TypeError,
    )
  })

  it('accepts non-empty receivedAt and nullable or non-empty sentAt', () => {
    expect(email({ ...completeEmailInput(), sentAt: null }).sentAt).toBeNull()
    expect(
      email({ ...completeEmailInput(), sentAt: '  timestamp  ' }).sentAt,
    ).toBe('  timestamp  ')
  })

  it('rejects empty receivedAt and sentAt', () => {
    expect(() =>
      email({ ...completeEmailInput(), receivedAt: '' }),
    ).toThrowError(TypeError)
    expect(() => email({ ...completeEmailInput(), sentAt: '' })).toThrowError(
      TypeError,
    )
  })

  it('preserves null, empty and populated address-list semantics', () => {
    const address = emailAddress(null, 'broken-address')
    const result = email({
      ...completeEmailInput(),
      sender: null,
      from: [],
      to: [address],
    })

    expect(result.sender).toBeNull()
    expect(result.from).toEqual([])
    expect(result.to).toEqual([address])
  })

  it('snapshots every present address list', () => {
    const mutableLists: EmailAddress[][] = Array.from({ length: 6 }, () => [
      emailAddress('Original', 'original@example.test'),
    ])
    const result = email({
      ...completeEmailInput(),
      sender: mutableLists[0],
      from: mutableLists[1],
      replyTo: mutableLists[2],
      to: mutableLists[3],
      cc: mutableLists[4],
      bcc: mutableLists[5],
    })

    for (const list of mutableLists) {
      list.push(emailAddress('Later', 'later@example.test'))
    }

    expect(result.sender).toHaveLength(1)
    expect(result.from).toHaveLength(1)
    expect(result.replyTo).toHaveLength(1)
    expect(result.to).toHaveLength(1)
    expect(result.cc).toHaveLength(1)
    expect(result.bcc).toHaveLength(1)
  })

  it('snapshots the source keyword set', () => {
    const source = new Set(['$seen'])
    const result = email({ ...completeEmailInput(), keywords: source })

    source.add('$flagged')

    expect([...result.keywords]).toEqual(['$seen'])
  })

  it('preserves subject, preview and timestamps exactly', () => {
    const nullSubject = email({
      ...completeEmailInput(),
      subject: null,
      sentAt: null,
      receivedAt: '  received  ',
      preview: '  Preview CASE  ',
    })
    const emptySubject = email({ ...completeEmailInput(), subject: '' })

    expect(nullSubject.subject).toBeNull()
    expect(emptySubject.subject).toBe('')
    expect(nullSubject.sentAt).toBeNull()
    expect(nullSubject.receivedAt).toBe('  received  ')
    expect(nullSubject.preview).toBe('  Preview CASE  ')
  })

  it('accepts an already constructed KeywordSet', () => {
    const keywords: KeywordSet = keywordSet(['custom'])

    expect(
      email({ ...completeEmailInput(), keywords }).keywords.has('custom'),
    ).toBe(true)
  })
})
