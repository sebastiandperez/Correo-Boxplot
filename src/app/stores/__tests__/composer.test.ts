import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useComposerStore } from '../composer'

describe('Composer Store (A-01, A-06)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('starts closed, idle, and cannot send when empty', () => {
    const store = useComposerStore()
    expect(store.isOpen).toBe(false)
    expect(store.phase).toBe('idle')
    expect(store.canSend).toBe(false)
    expect(store.to).toBe('')
    expect(store.subject).toBe('')
    expect(store.body).toBe('')
  })

  it('opens in editing phase and populates initial fields', () => {
    const store = useComposerStore()
    store.open({
      to: 'contacto@empresa.com',
      subject: 'Reunión de avance',
      body: 'Hola equipo, adjunto minuta.',
    })

    expect(store.isOpen).toBe(true)
    expect(store.phase).toBe('editing')
    expect(store.to).toBe('contacto@empresa.com')
    expect(store.subject).toBe('Reunión de avance')
    expect(store.body).toBe('Hola equipo, adjunto minuta.')
    expect(store.canSend).toBe(true)
  })

  it('preserves draft content during queueing and error phases (Fail-Safe semantics)', () => {
    const store = useComposerStore()
    store.open({
      to: 'cliente@empresa.com',
      subject: 'Propuesta comercial',
      body: 'Texto muy importante que no debe perderse.',
    })

    // Transition to queueing
    store.setPhase('queueing')
    expect(store.phase).toBe('queueing')
    expect(store.canSend).toBe(false) // cannot double-send while queueing
    expect(store.body).toBe('Texto muy importante que no debe perderse.')

    // Transition to error (e.g. database/network mutation failed)
    store.setPhase('error', 'Error al encolar mutación')
    expect(store.phase).toBe('error')
    expect(store.error).toBe('Error al encolar mutación')
    // Draft text MUST be preserved
    expect(store.to).toBe('cliente@empresa.com')
    expect(store.body).toBe('Texto muy importante que no debe perderse.')
    expect(store.canSend).toBe(true) // user can retry
  })

  it('resets completely and clears memory-only draft upon explicit discard or success', () => {
    const store = useComposerStore()
    store.open({ to: 'test@example.com', body: 'Draft' })
    store.reset()

    expect(store.isOpen).toBe(false)
    expect(store.to).toBe('')
    expect(store.body).toBe('')
    expect(store.phase).toBe('idle')
    expect(store.error).toBeNull()
  })
})
