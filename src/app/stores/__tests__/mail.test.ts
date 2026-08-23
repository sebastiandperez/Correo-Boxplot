import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { createTestFixtures } from '../../../tests/contracts/fixtures'
import { useMailStore } from '../mail'

describe('useMailStore UI projection', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('starts empty without demo or durable mail state', () => {
    const store = useMailStore()
    expect(store.accounts).toEqual([])
    expect(store.selectedAccountKey).toBeNull()
    expect(store.mailboxes).toEqual([])
    expect(store.emails).toEqual([])
    expect(store.emailBody).toBeNull()
  })

  it('stores snapshots supplied by Application without fabricating values', () => {
    const fixtures = createTestFixtures()
    const store = useMailStore()

    store.setAccounts([fixtures.accountA])
    store.selectAccount(fixtures.accountA.key)
    store.setMailboxes([fixtures.inboxA])
    store.selectMailbox(fixtures.inboxA.id)
    store.setMailboxView(fixtures.partialInboxViewA)
    store.setEmails([fixtures.emailA1, fixtures.emailA2])
    store.selectEmail(fixtures.emailA1.id)
    store.setEmailBody(fixtures.nullBodyA1, 'cached')

    expect(store.selectedMailbox).toEqual(fixtures.inboxA)
    expect(store.selectedEmail).toEqual(fixtures.emailA1)
    expect(store.emailBody).toEqual(fixtures.nullBodyA1)
    expect(store.bodyLoadState).toBe('cached')
  })

  it('clears dependent projections when account changes', () => {
    const fixtures = createTestFixtures()
    const store = useMailStore()
    store.selectAccount(fixtures.accountA.key)
    store.setMailboxes([fixtures.inboxA])
    store.selectMailbox(fixtures.inboxA.id)
    store.setEmails([fixtures.emailA1])

    store.selectAccount(fixtures.accountB.key)

    expect(store.selectedMailboxId).toBeNull()
    expect(store.selectedEmailId).toBeNull()
    expect(store.mailboxes).toEqual([])
    expect(store.emails).toEqual([])
  })
})
