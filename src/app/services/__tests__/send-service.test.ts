import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { executeSend } from '../send-service'
import { useComposerStore } from '../../stores/composer'
import { useMailStore } from '../../stores/mail'
import { getEngine } from '../../engine'

describe('Send Service - Queue & Fail-Safe Semantics (A-06)', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await getEngine()
  })

  it('successfully stages SendMutation, updates sent folder, and clears composer only on success', async () => {
    const composerStore = useComposerStore()
    const mailStore = useMailStore()

    composerStore.open({
      to: 'amigo@ejemplo.com',
      subject: 'Hola mundo',
      body: 'Contenido del correo importante',
    })

    const initialSentCount = mailStore.allEmailsByFolder.sent?.length ?? 0

    const result = await executeSend()

    expect(result.ok).toBe(true)
    expect(mailStore.allEmailsByFolder.sent?.length).toBe(initialSentCount + 1)
    expect(mailStore.allEmailsByFolder.sent[0].subject).toBe('Hola mundo')

    // Verified: Composer is closed and cleared ONLY after successful commit
    expect(composerStore.isOpen).toBe(false)
    expect(composerStore.phase).toBe('idle')
    expect(composerStore.to).toBe('')
    expect(composerStore.body).toBe('')
  })

  it('fails when recipient is empty and preserves draft text in error state', async () => {
    const composerStore = useComposerStore()
    composerStore.open({
      to: '',
      subject: 'Borrador importante',
      body: 'Mucho texto que no se debe perder.',
    })

    const result = await executeSend()
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('emptyRecipient')
    }

    // Fail-safe check: Draft text MUST NOT be cleared
    expect(composerStore.isOpen).toBe(true)
    expect(composerStore.phase).toBe('error')
    expect(composerStore.subject).toBe('Borrador importante')
    expect(composerStore.body).toBe('Mucho texto que no se debe perder.')
  })

  it('fails when recipient address is invalid and preserves draft text in error state', async () => {
    const composerStore = useComposerStore()
    composerStore.open({
      to: 'direccion-invalida-sin-arroba',
      subject: 'Asunto prueba',
      body: 'Cuerpo prueba',
    })

    const result = await executeSend()
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('invalidAddress')
    }

    // Fail-safe check: Draft text MUST NOT be cleared
    expect(composerStore.isOpen).toBe(true)
    expect(composerStore.phase).toBe('error')
    expect(composerStore.subject).toBe('Asunto prueba')
    expect(composerStore.body).toBe('Cuerpo prueba')
  })
})
