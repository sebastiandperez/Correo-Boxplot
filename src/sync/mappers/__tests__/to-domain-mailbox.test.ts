import { describe, it, expect, vi } from 'vitest'
import { toDomainMailbox } from '../to-domain-mailbox'
import { accountKeyFromString } from '../../../domain/ids'
import type { JmapMailbox } from '../../../jmap/types'
import { mapJmapMailbox } from '../../../remote/jmap/mappers'

const accountKey = accountKeyFromString('acc-1')

function makeRawMailbox(overrides: Partial<JmapMailbox> = {}): JmapMailbox {
  return {
    id: 'mailbox-1',
    name: 'Inbox',
    parent: null,
    role: 'inbox',
    sortOrder: 0,
    totalEmails: 5,
    unreadEmails: 2,
    rights: {
      mayReadItems: true,
      mayAddItems: true,
      mayRemoveItems: true,
      maySetSeen: true,
      maySetKeywords: true,
      maySubmit: true,
    },
    ...overrides,
  }
}

describe('toDomainMailbox', () => {
  it('maps a well-formed JmapMailbox into a Domain Mailbox', () => {
    const mailbox = toDomainMailbox(
      accountKey,
      mapJmapMailbox(makeRawMailbox()),
    )

    expect(mailbox).not.toBeNull()
    expect(mailbox?.id).toEqual({ accountKey, jmapId: 'mailbox-1' })
    expect(mailbox?.name).toBe('Inbox')
    expect(mailbox?.role).toBe('inbox')
    expect(mailbox?.rights.mayReadItems).toBe(true)
  })

  it('scopes a non-null parent to the same account', () => {
    const mailbox = toDomainMailbox(
      accountKey,
      mapJmapMailbox(makeRawMailbox({ parent: 'mailbox-parent' })),
    )

    expect(mailbox?.parent).toEqual({ accountKey, jmapId: 'mailbox-parent' })
  })

  it('returns null when unreadEmails exceeds totalEmails (Domain rejects it)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const mailbox = toDomainMailbox(
      accountKey,
      mapJmapMailbox(makeRawMailbox({ totalEmails: 1, unreadEmails: 5 })),
    )

    expect(mailbox).toBeNull()
    expect(warnSpy).toHaveBeenCalled()
  })

  it('returns null when name is empty', () => {
    const mailbox = toDomainMailbox(
      accountKey,
      mapJmapMailbox(makeRawMailbox({ name: '' })),
    )
    expect(mailbox).toBeNull()
  })
})
