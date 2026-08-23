import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import type { ApplicationContext } from '../../application'
import { createApplicationContext } from '../../application'
import { createSeededMemoryApplication } from '../../__tests__/application-fixture'
import { useComposerStore } from '../../stores/composer'
import { useMailStore } from '../../stores/mail'
import { executeSend } from '../send-service'

describe('Send service queue semantics', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('persists SendMutation, clears after commit, and creates no fake Email', async () => {
    const { engine, fixtures } = await createSeededMemoryApplication()
    const context = createApplicationContext(engine)
    useMailStore().selectAccount(fixtures.accountA.key)
    const composer = useComposerStore()
    composer.open({
      to: 'recipient@example.test',
      subject: 'Queued subject',
      body: 'Queued body',
    })
    const emailsBefore = await engine.readRepository.readEmails([
      fixtures.emailA1.id,
      fixtures.emailA2.id,
    ])

    expect(await executeSend(context)).toEqual({ ok: true })
    expect(composer.isOpen).toBe(false)
    const mutations = await engine.readRepository.listPendingMutations(
      fixtures.accountA.key,
    )
    expect(mutations.ok && mutations.value.kind === 'present').toBe(true)
    if (mutations.ok && mutations.value.kind === 'present') {
      expect(mutations.value.value).toHaveLength(1)
      expect(mutations.value.value[0].kind).toBe('send')
    }
    expect(
      await engine.readRepository.readEmails([
        fixtures.emailA1.id,
        fixtures.emailA2.id,
      ]),
    ).toEqual(emailsBefore)
  })

  it('preserves the composer when the local commit fails', async () => {
    const { engine, fixtures } = await createSeededMemoryApplication()
    const unavailableSyncPort = new Proxy(engine.syncPort, {
      get(target, property, receiver) {
        if (property === 'stageSendMutation') {
          return async () => ({
            ok: false as const,
            error: { kind: 'unavailable' as const },
          })
        }
        return Reflect.get(target, property, receiver)
      },
    })
    const context: ApplicationContext = createApplicationContext({
      readRepository: engine.readRepository,
      syncPort: unavailableSyncPort,
      localChangeSource: engine.localChangeSource,
    })
    useMailStore().selectAccount(fixtures.accountA.key)
    const composer = useComposerStore()
    composer.open({
      to: 'recipient@example.test',
      subject: 'Keep subject',
      body: 'Keep body',
    })

    expect(await executeSend(context)).toEqual({
      ok: false,
      error: 'engineError',
    })
    expect(composer.isOpen).toBe(true)
    expect(composer.subject).toBe('Keep subject')
    expect(composer.body).toBe('Keep body')
    expect(composer.phase).toBe('error')
  })

  it('rejects invalid or missing recipients without losing the draft', async () => {
    const { engine, fixtures } = await createSeededMemoryApplication()
    useMailStore().selectAccount(fixtures.accountA.key)
    const composer = useComposerStore()
    composer.open({ to: '', subject: 'Draft', body: 'Preserve me' })

    expect(await executeSend(createApplicationContext(engine))).toEqual({
      ok: false,
      error: 'emptyRecipient',
    })
    expect(composer.body).toBe('Preserve me')
  })
})
