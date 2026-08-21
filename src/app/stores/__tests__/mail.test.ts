import { beforeEach, describe, expect, it } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useMailStore } from '../mail'
import {
  accountKeyFromString,
  jmapMailboxIdFromString,
  scopedMailboxId,
} from '../../../domain/ids'
import { DEMO_ACCOUNT_KEY } from '../../mock-data'

describe('useMailStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('starts initialized with demo account and inbox emails', () => {
    const store = useMailStore()
    expect(store.selectedAccountKey).toBe(DEMO_ACCOUNT_KEY)
    expect(store.selectedMailboxId?.jmapId).toBe('inbox')
    expect(store.emails.length).toBeGreaterThan(0)
    expect(store.selectedEmail).not.toBeNull()
  })

  it('switches folder and loads folder emails', () => {
    const store = useMailStore()
    const sentId = scopedMailboxId(
      DEMO_ACCOUNT_KEY,
      jmapMailboxIdFromString('sent'),
    )

    store.selectMailbox(sentId)
    expect(store.selectedMailboxId).toEqual(sentId)
    expect(store.emails.length).toBe(1)
    expect(store.selectedEmail?.subject).toContain('Avance del Proyecto')
  })

  it('sends email and adds to sent folder', () => {
    const store = useMailStore()
    const initialSentCount = store.allEmailsByFolder.sent?.length ?? 0

    store.sendEmail('test@destino.com', 'Asunto prueba', 'Cuerpo prueba')
    expect(store.allEmailsByFolder.sent?.length).toBe(initialSentCount + 1)
  })

  it('deletes an email and moves it to trash', () => {
    const store = useMailStore()
    const inboxCount = store.emails.length
    const emailToDelete = store.emails[0]

    store.deleteEmail(emailToDelete.id)
    expect(store.emails.length).toBe(inboxCount - 1)
    expect(store.allEmailsByFolder.trash[0].id).toEqual(emailToDelete.id)
  })
})
