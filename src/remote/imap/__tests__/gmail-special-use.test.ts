import { describe, expect, it } from 'vitest'

import { mapNativeMailbox, roleFor } from '../mappers'

describe('Gmail Special-Use mailbox mapping', () => {
  it('GMAIL-MBX-01 / GMAIL-MBX-02 maps Gmail Sent and Trash without English folder names', () => {
    const sent = mapNativeMailbox(
      {
        name: '[Gmail]/Sent Mail',
        specialUse: '\\Sent',
        messages: 1,
        unseen: 0,
        uidValidity: 1,
        uidNext: 2,
      },
      5,
    )
    const trash = mapNativeMailbox(
      {
        name: '[Gmail]/Papelera',
        specialUse: '\\Trash',
        messages: 0,
        unseen: 0,
        uidValidity: 2,
        uidNext: 1,
      },
      6,
    )

    expect(sent.role).toBe('sent')
    expect(trash.role).toBe('trash')
    expect(roleFor('\\All', '[Gmail]/All Mail')).toBeNull()
  })
})
