import { describe, expect, it } from 'vitest'

import {
  emailMailbox,
  mailbox,
  mailboxRights,
  sameEmailMailbox,
  type Mailbox,
  type MailboxRights,
} from '../mailbox'
import {
  accountKeyFromString,
  jmapEmailIdFromString,
  jmapMailboxIdFromString,
  scopedEmailId,
  scopedMailboxId,
} from '../ids'

const accountA = accountKeyFromString('account-a')
const accountB = accountKeyFromString('account-b')

function coreRights(): MailboxRights {
  return {
    mayReadItems: true,
    mayAddItems: false,
    mayRemoveItems: true,
    maySetSeen: true,
    maySetKeywords: false,
    maySubmit: true,
  }
}

function mailboxInput(): Mailbox {
  return {
    id: scopedMailboxId(accountA, jmapMailboxIdFromString('inbox')),
    name: 'Inbox',
    parent: null,
    role: 'inbox',
    sortOrder: 10,
    totalEmails: 12_700,
    unreadEmails: 100,
    rights: coreRights(),
  }
}

describe('Mailbox', () => {
  it('constructs the complete Mailbox projection', () => {
    const input = mailboxInput()

    expect(mailbox(input)).toEqual(input)
  })

  it('rejects an empty name and preserves accepted text exactly', () => {
    expect(() => mailbox({ ...mailboxInput(), name: '' })).toThrowError(
      TypeError,
    )

    const result = mailbox({ ...mailboxInput(), name: '  Mixed CASE  ' })
    expect(result.name).toBe('  Mixed CASE  ')
  })

  it('accepts a null or same-account parent', () => {
    const parent = scopedMailboxId(accountA, jmapMailboxIdFromString('parent'))

    expect(mailbox({ ...mailboxInput(), parent: null }).parent).toBeNull()
    expect(mailbox({ ...mailboxInput(), parent }).parent).toBe(parent)
  })

  it('rejects a parent from another Account', () => {
    const parent = scopedMailboxId(accountB, jmapMailboxIdFromString('parent'))

    expect(() => mailbox({ ...mailboxInput(), parent })).toThrowError(TypeError)
  })

  it('rejects self-parenting by semantic ID equality', () => {
    const input = mailboxInput()
    const equivalentId = scopedMailboxId(input.id.accountKey, input.id.jmapId)

    expect(() => mailbox({ ...input, parent: equivalentId })).toThrowError(
      TypeError,
    )
  })

  it('accepts null, known and unknown roles without normalization', () => {
    expect(mailbox({ ...mailboxInput(), role: null }).role).toBeNull()
    expect(mailbox({ ...mailboxInput(), role: 'trash' }).role).toBe('trash')
    expect(mailbox({ ...mailboxInput(), role: '  Future-Role  ' }).role).toBe(
      '  Future-Role  ',
    )
  })

  it('rejects an empty non-null role', () => {
    expect(() => mailbox({ ...mailboxInput(), role: '' })).toThrowError(
      TypeError,
    )
  })

  it.each([0, 2 ** 31 - 1])('accepts sortOrder %s', (sortOrder) => {
    expect(mailbox({ ...mailboxInput(), sortOrder }).sortOrder).toBe(sortOrder)
  })

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 31])(
    'rejects invalid sortOrder %s',
    (sortOrder) => {
      expect(() => mailbox({ ...mailboxInput(), sortOrder })).toThrowError(
        TypeError,
      )
    },
  )

  it.each([
    [0, 0],
    [10, 0],
    [10, 10],
    [12_700, 100],
  ])('accepts counts total=%s unread=%s', (totalEmails, unreadEmails) => {
    const result = mailbox({
      ...mailboxInput(),
      totalEmails,
      unreadEmails,
    })

    expect(result.totalEmails).toBe(totalEmails)
    expect(result.unreadEmails).toBe(unreadEmails)
  })

  it.each([
    [-1, 0],
    [0, -1],
    [1.5, 0],
    [1, 0.5],
    [Number.MAX_SAFE_INTEGER + 1, 0],
    [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1],
    [1, 2],
  ])(
    'rejects invalid counts total=%s unread=%s',
    (totalEmails, unreadEmails) => {
      expect(() =>
        mailbox({ ...mailboxInput(), totalEmails, unreadEmails }),
      ).toThrowError(TypeError)
    },
  )

  it('snapshots exactly the six core rights', () => {
    const source = {
      mayReadItems: true,
      mayAddItems: false,
      mayRemoveItems: true,
      maySetSeen: false,
      maySetKeywords: true,
      maySubmit: false,
    }
    const result = mailbox({ ...mailboxInput(), rights: source })

    source.mayReadItems = false
    source.maySubmit = true

    expect(result.rights).toEqual({
      mayReadItems: true,
      mayAddItems: false,
      mayRemoveItems: true,
      maySetSeen: false,
      maySetKeywords: true,
      maySubmit: false,
    })
    expect(Object.keys(mailboxRights(coreRights())).sort()).toEqual(
      [
        'mayReadItems',
        'mayAddItems',
        'mayRemoveItems',
        'maySetSeen',
        'maySetKeywords',
        'maySubmit',
      ].sort(),
    )
  })
})

describe('EmailMailbox', () => {
  const emailA = scopedEmailId(accountA, jmapEmailIdFromString('email-a'))
  const emailB = scopedEmailId(accountA, jmapEmailIdFromString('email-b'))
  const mailboxA = scopedMailboxId(
    accountA,
    jmapMailboxIdFromString('mailbox-a'),
  )
  const mailboxB = scopedMailboxId(
    accountA,
    jmapMailboxIdFromString('mailbox-b'),
  )

  it('constructs same-account membership', () => {
    expect(emailMailbox(emailA, mailboxA)).toEqual({
      emailId: emailA,
      mailboxId: mailboxA,
    })
  })

  it('rejects cross-account membership', () => {
    const foreignMailbox = scopedMailboxId(
      accountB,
      jmapMailboxIdFromString('mailbox-a'),
    )

    expect(() => emailMailbox(emailA, foreignMailbox)).toThrowError(TypeError)
  })

  it('compares membership by both scoped IDs', () => {
    expect(
      sameEmailMailbox(
        emailMailbox(emailA, mailboxA),
        emailMailbox(emailA, mailboxA),
      ),
    ).toBe(true)
    expect(
      sameEmailMailbox(
        emailMailbox(emailA, mailboxA),
        emailMailbox(emailB, mailboxA),
      ),
    ).toBe(false)
    expect(
      sameEmailMailbox(
        emailMailbox(emailA, mailboxA),
        emailMailbox(emailA, mailboxB),
      ),
    ).toBe(false)
  })
})
