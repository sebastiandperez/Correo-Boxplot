// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createApplicationContext,
  createMailApplicationController,
} from '../../app/application'
import { createSeededMemoryApplication } from '../../app/__tests__/application-fixture'
import { useComposerStore } from '../../app/stores/composer'
import { useMailStore } from '../../app/stores/mail'
import { useRuntimeStore } from '../../app/stores/runtime'
import {
  applicationContextKey,
  mailApplicationControllerKey,
} from '../../app/vue-application-context'
import Composer from '../composer/Composer.vue'

describe('Composer explicit send security selector', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('defaults to plain and only changes to E2EE through the visible explicit choice', async () => {
    const { engine, fixtures } = await createSeededMemoryApplication()
    const context = createApplicationContext(engine)
    const controller = createMailApplicationController(
      context,
      useMailStore(),
      useRuntimeStore(),
    )
    await controller.initialize()
    useMailStore().selectAccount(fixtures.accountA.key)
    const composer = useComposerStore()
    composer.open({ to: 'recipient@example.test' })
    const wrapper = mount(Composer, {
      global: {
        provide: {
          [applicationContextKey as symbol]: context,
          [mailApplicationControllerKey as symbol]: controller,
        },
      },
    })

    expect(composer.securityMode).toBe('plain')
    expect(wrapper.text()).toContain('Seguridad del envío')
    expect(wrapper.text()).toContain('Estándar')
    expect(wrapper.text()).toContain('Boxplot E2EE')
    const encrypted = wrapper.find('input[value="boxplotE2eeV1"]')
    await encrypted.setValue(true)
    expect(composer.securityMode).toBe('boxplotE2eeV1')
    wrapper.unmount()
    controller.dispose()
  })

  it('does not let a failed stage reset the explicit selection', async () => {
    const { engine, fixtures } = await createSeededMemoryApplication()
    const syncPort = new Proxy(engine.syncPort, {
      get(target, property, receiver) {
        if (property === 'stageSendMutation') {
          return vi.fn(async () => ({
            ok: false as const,
            error: { kind: 'unavailable' as const },
          }))
        }
        return Reflect.get(target, property, receiver)
      },
    })
    const context = createApplicationContext({ ...engine, syncPort })
    const controller = createMailApplicationController(
      context,
      useMailStore(),
      useRuntimeStore(),
    )
    await controller.initialize()
    useMailStore().selectAccount(fixtures.accountA.key)
    const composer = useComposerStore()
    composer.open({ to: 'recipient@example.test' })
    composer.securityMode = 'boxplotE2eeV1'
    const wrapper = mount(Composer, {
      global: {
        provide: {
          [applicationContextKey as symbol]: context,
          [mailApplicationControllerKey as symbol]: controller,
        },
      },
    })

    await wrapper
      .find('button[title="Enviar correo (Ctrl+Enter)"]')
      .trigger('click')
    await vi.waitFor(() => expect(composer.phase).toBe('error'))
    expect(composer.securityMode).toBe('boxplotE2eeV1')
    wrapper.unmount()
    controller.dispose()
  })
})
