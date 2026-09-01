// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { mount, type VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  type AccountConnectionResult,
  type ConnectAccountOptions,
  createApplicationContext,
  createMailApplicationController,
} from '../../app/application'
import { createSeededMemoryApplication } from '../../app/__tests__/application-fixture'
import { useComposerStore } from '../../app/stores/composer'
import { useAccountSetupStore } from '../../app/stores/account-setup'
import { useMailStore } from '../../app/stores/mail'
import { useRuntimeStore } from '../../app/stores/runtime'
import type { AccountKey } from '../../domain/ids'
import {
  applicationContextKey,
  mailApplicationControllerKey,
} from '../../app/vue-application-context'
import Composer from '../composer/Composer.vue'
import AccountReconnectDialog from '../account/AccountReconnectDialog.vue'
import AppShell from '../layout/AppShell.vue'
import MailboxSidebar from '../mailbox/MailboxSidebar.vue'
import MessageList from '../message-list/MessageList.vue'
import MessageViewer from '../message-viewer/MessageViewer.vue'

type TestDependencies = Awaited<
  ReturnType<typeof createSeededMemoryApplication>
> & {
  context: ReturnType<typeof createApplicationContext>
  controller: ReturnType<typeof createMailApplicationController>
}

let dependencies: TestDependencies

function mountWithApplication(
  component: Parameters<typeof mount>[0],
  options: { props?: Record<string, unknown> } = {},
): VueWrapper {
  return mount(component, {
    props: options.props,
    global: {
      provide: {
        [applicationContextKey as symbol]: dependencies.context,
        [mailApplicationControllerKey as symbol]: dependencies.controller,
      },
    },
  })
}

describe('Presentation and UI shell components', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    const seeded = await createSeededMemoryApplication()
    const context = createApplicationContext(seeded.engine)
    const controller = createMailApplicationController(
      context,
      useMailStore(),
      useRuntimeStore(),
    )
    await controller.initialize()
    dependencies = { ...seeded, context, controller }
  })

  describe('MailboxSidebar', () => {
    it('renders committed mailboxes and runtime status', () => {
      const wrapper = mountWithApplication(MailboxSidebar)
      expect(wrapper.text()).toContain('Boxplot Mail')
      expect(wrapper.text()).toContain(dependencies.fixtures.inboxA.name)
      expect(wrapper.text()).toContain('Redactar')
      expect(wrapper.find('.mailbox-sidebar__runtime-status').exists()).toBe(
        true,
      )
    })

    it('opens the in-memory composer projection', async () => {
      const wrapper = mountWithApplication(MailboxSidebar)
      await wrapper.find('.mailbox-sidebar__compose').trigger('click')
      expect(useComposerStore().isOpen).toBe(true)
    })

    it('shows Local reconnect availability but never reconnects a retained offline session', async () => {
      const wrapper = mountWithApplication(MailboxSidebar)
      expect(wrapper.text()).toContain('Local')
      expect(wrapper.get('.mailbox-sidebar__reconnect').text()).toContain(
        'Conectar para sincronizar',
      )
      await wrapper.get('.mailbox-sidebar__reconnect').trigger('click')
      expect(wrapper.emitted('reconnect')?.[0]).toEqual([
        dependencies.fixtures.accountA.key,
      ])

      useRuntimeStore().setAuth('authenticated')
      useRuntimeStore().setConnectivity('offline')
      await wrapper.vm.$nextTick()
      expect(wrapper.text()).toContain('Sin conexión')
      expect(wrapper.find('.mailbox-sidebar__reconnect').exists()).toBe(false)
    })
  })

  describe('Account reconnect presentation', () => {
    it('keeps the AppShell mounted behind the reconnect dialog', async () => {
      const wrapper = mountWithApplication(AppShell)
      await wrapper
        .findComponent(MailboxSidebar)
        .vm.$emit('reconnect', dependencies.fixtures.accountA.key)
      await wrapper.vm.$nextTick()

      expect(wrapper.findComponent(AccountReconnectDialog).exists()).toBe(true)
      expect(wrapper.findComponent(MessageList).exists()).toBe(true)
    })

    it('clears the reconnect password when the dialog is cancelled', async () => {
      const wrapper = mountWithApplication(AccountReconnectDialog, {
        props: { accountKey: dependencies.fixtures.accountA.key },
      })
      await wrapper
        .find('#account-password')
        .setValue('BOXPLOT_A_RECONNECT_SECRET_CANARY_01')
      await wrapper.get('.account-setup__cancel').trigger('click')

      expect(useAccountSetupStore().password).toBe('')
      expect(wrapper.emitted('close')).toHaveLength(1)
    })

    it('clears the reconnect password after a successful Application result', async () => {
      const reconnectAccount = vi.fn(
        async (
          _accountKey: AccountKey,
          _request: unknown,
          options?: ConnectAccountOptions,
        ) => {
          options?.onAuthenticated?.()
          return {
            ok: true as const,
            accountKey: dependencies.fixtures.accountA.key,
          }
        },
      )
      const wrapper = mount(AccountReconnectDialog, {
        props: { accountKey: dependencies.fixtures.accountA.key },
        global: {
          provide: {
            [mailApplicationControllerKey as symbol]: {
              reconnectAccount,
            },
          },
        },
      })
      await wrapper.find('#account-username').setValue('alice@boxplot.test')
      await wrapper
        .find('#account-password')
        .setValue('BOXPLOT_A_RECONNECT_SECRET_CANARY_01')
      await wrapper.find('form').trigger('submit')

      await vi.waitFor(() => expect(reconnectAccount).toHaveBeenCalledOnce())
      expect(useAccountSetupStore().password).toBe('')
      expect(wrapper.emitted('close')).toHaveLength(1)
    })

    it('does not render a stale error when closed during reconnect', async () => {
      let finish!: (value: AccountConnectionResult) => void
      const reconnectAccount = vi.fn(
        () =>
          new Promise((resolve) => {
            finish = resolve
          }),
      )
      const wrapper = mount(AccountReconnectDialog, {
        props: { accountKey: dependencies.fixtures.accountA.key },
        global: {
          provide: {
            [mailApplicationControllerKey as symbol]: {
              reconnectAccount,
            },
          },
        },
      })
      await wrapper.find('#account-username').setValue('alice@boxplot.test')
      await wrapper
        .find('#account-password')
        .setValue('BOXPLOT_A_RECONNECT_SECRET_CANARY_01')
      await wrapper.find('form').trigger('submit')
      await vi.waitFor(() => expect(reconnectAccount).toHaveBeenCalledOnce())
      await wrapper.get('.account-setup__cancel').trigger('click')
      wrapper.unmount()
      finish({ ok: true, accountKey: dependencies.fixtures.accountA.key })
      await Promise.resolve()

      expect(useAccountSetupStore().password).toBe('')
      expect(useAccountSetupStore().error).toBeNull()
    })
  })

  describe('MessageList', () => {
    it('renders the MailboxView window in its committed order', () => {
      const wrapper = mountWithApplication(MessageList)
      expect(wrapper.findAll('.message-item')).toHaveLength(2)
      expect(wrapper.findAll('.message-item')[0].text()).toContain(
        dependencies.fixtures.emailA1.subject,
      )
    })

    it('filters the materialized local window without inventing coverage', async () => {
      const wrapper = mountWithApplication(MessageList)
      await wrapper.find('.message-list__search-input').setValue('subject-E2')
      expect(wrapper.findAll('.message-item')).toHaveLength(1)
      expect(wrapper.text()).toContain('subject-E2')
    })

    it('shows explicit loading and not-cached states', async () => {
      const mailStore = useMailStore()
      mailStore.setLoadState('loading')
      const wrapper = mountWithApplication(MessageList)
      expect(wrapper.text()).toContain('Cargando mensajes')

      mailStore.setLoadState('notCached')
      mailStore.setEmails([])
      await wrapper.vm.$nextTick()
      expect(wrapper.text()).toContain('Vista no disponible en la caché local')
    })
  })

  describe('MessageViewer', () => {
    it('renders cached HTML through the sanitizer and sandboxed iframe', () => {
      const wrapper = mountWithApplication(MessageViewer)
      const iframe = wrapper.find('iframe')
      expect(iframe.exists()).toBe(true)
      expect(iframe.attributes('sandbox')).toBe('allow-same-origin')
      expect(iframe.attributes('srcdoc')).toContain('body-html-A1')
    })

    it('renders cached text safely and preserves cached null/null as complete', async () => {
      const mailStore = useMailStore()
      mailStore.setEmailBody(
        {
          emailId: dependencies.fixtures.emailA1.id,
          text: '<unsafe>',
          html: null,
        },
        'cached',
      )
      const wrapper = mountWithApplication(MessageViewer)
      expect(wrapper.find('iframe').attributes('srcdoc')).toContain(
        '&lt;unsafe&gt;',
      )

      mailStore.setEmailBody(dependencies.fixtures.nullBodyA1, 'cached')
      await wrapper.vm.$nextTick()
      expect(wrapper.find('iframe').attributes('srcdoc')).toContain(
        'Mensaje sin representación textual o HTML',
      )
    })

    it('shows not-cached body without fabricating preview content', () => {
      useMailStore().setEmailBody(null, 'notCached')
      const wrapper = mountWithApplication(MessageViewer)
      expect(wrapper.find('iframe').exists()).toBe(false)
      expect(wrapper.text()).toContain(
        'Contenido no disponible en la caché local',
      )
      expect(wrapper.text()).not.toContain(
        dependencies.fixtures.emailA1.preview,
      )
    })
  })

  describe('Composer', () => {
    it('renders and edits only its memory-resident draft', () => {
      useComposerStore().open({
        to: 'recipient@example.test',
        subject: 'Draft subject',
        body: 'Draft body',
      })
      const wrapper = mountWithApplication(Composer)
      expect(wrapper.find('.composer').exists()).toBe(true)
      expect(
        (wrapper.find('input[type="email"]').element as HTMLInputElement).value,
      ).toBe('recipient@example.test')
    })
  })
})
