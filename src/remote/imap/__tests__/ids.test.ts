import { describe, expect, it } from 'vitest'

import {
  decodeImapAccountId,
  decodeImapEmailId,
  decodeImapMailboxId,
  imapAccountId,
  imapEmailId,
  imapMailboxId,
} from '../ids'

describe('IMAP remote ID codec', () => {
  it('round-trips account identity', () => {
    expect(decodeImapAccountId(imapAccountId('álîce@boxplot.test'))).toBe(
      'álîce@boxplot.test',
    )
  })
  it.each(['INBOX', 'Archive/2026: Q3', 'Correo ñandú 📬'])(
    'round-trips mailbox %s',
    (mailbox) => {
      expect(decodeImapMailboxId(imapMailboxId(mailbox))).toBe(mailbox)
      expect(
        decodeImapEmailId(imapEmailId({ mailbox, uidValidity: 42, uid: 7 })),
      ).toEqual({ mailbox, uidValidity: 42, uid: 7 })
    },
  )

  it('changes identity with mailbox or UIDVALIDITY', () => {
    expect(imapEmailId({ mailbox: 'INBOX', uidValidity: 1, uid: 9 })).not.toBe(
      imapEmailId({ mailbox: 'Trash', uidValidity: 1, uid: 9 }),
    )
    expect(imapEmailId({ mailbox: 'INBOX', uidValidity: 1, uid: 9 })).not.toBe(
      imapEmailId({ mailbox: 'INBOX', uidValidity: 2, uid: 9 }),
    )
  })

  it('rejects malformed and unsafe IDs', () => {
    expect(() => decodeImapEmailId(imapMailboxId('INBOX') as never)).toThrow()
    expect(() =>
      imapEmailId({ mailbox: 'INBOX', uidValidity: 0, uid: 1 }),
    ).toThrow()
  })
})
