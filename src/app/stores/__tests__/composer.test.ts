import { beforeEach, describe, expect, it } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useComposerStore } from '../composer'

describe('useComposerStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('starts closed and idle', () => {
    const store = useComposerStore()
    expect(store.isOpen).toBe(false)
    expect(store.phase).toBe('idle')
    expect(store.canSend).toBe(false)
  })

  it('opens and updates fields', () => {
    const store = useComposerStore()
    store.open({ to: 'test@example.com', subject: 'Hola' })

    expect(store.isOpen).toBe(true)
    expect(store.phase).toBe('editing')
    expect(store.to).toBe('test@example.com')
    expect(store.subject).toBe('Hola')
    expect(store.canSend).toBe(true)
  })

  it('resets completely on reset()', () => {
    const store = useComposerStore()
    store.open({ to: 'test@example.com' })
    store.reset()

    expect(store.isOpen).toBe(false)
    expect(store.to).toBe('')
    expect(store.phase).toBe('idle')
  })
})
