import { beforeEach, describe, expect, it } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { executeSend } from '../send-service'
import { useComposerStore } from '../../stores/composer'
import { useMailStore } from '../../stores/mail'
import { getEngine } from '../../engine'

describe('send-service', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await getEngine()
  })

  it('successfully stages SendMutation and updates sent folder in mailStore', async () => {
    const composerStore = useComposerStore()
    const mailStore = useMailStore()

    composerStore.open({
      to: 'amigo@ejemplo.com',
      subject: 'Hola mundo',
      body: 'Contenido del correo',
    })

    const initialSentCount = mailStore.allEmailsByFolder.sent?.length ?? 0

    const result = await executeSend()

    expect(result.ok).toBe(true)
    expect(mailStore.allEmailsByFolder.sent?.length).toBe(initialSentCount + 1)
    expect(mailStore.allEmailsByFolder.sent[0].subject).toBe('Hola mundo')
  })

  it('fails when recipient is empty', async () => {
    const composerStore = useComposerStore()
    composerStore.open({
      to: '',
      subject: 'Sin destinatario',
      body: 'Texto',
    })

    const result = await executeSend()
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('emptyRecipient')
    }
  })

  it('fails when recipient address is invalid', async () => {
    const composerStore = useComposerStore()
    composerStore.open({
      to: 'direccion-invalida-sin-arroba',
      subject: 'Test',
      body: 'Texto',
    })

    const result = await executeSend()
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('invalidAddress')
    }
  })
})
