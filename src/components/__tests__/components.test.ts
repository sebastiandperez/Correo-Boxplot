// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { mount, type VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'

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
): VueWrapper {
  return mount(component, {
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
