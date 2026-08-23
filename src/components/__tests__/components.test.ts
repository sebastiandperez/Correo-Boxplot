// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import MailboxSidebar from '../mailbox/MailboxSidebar.vue'
import MessageList from '../message-list/MessageList.vue'
import MessageViewer from '../message-viewer/MessageViewer.vue'
import Composer from '../composer/Composer.vue'
import { useMailStore } from '../../app/stores/mail'
import { useComposerStore } from '../../app/stores/composer'

describe('Presentation & UI Shell Components (A-04, A-07)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('MailboxSidebar.vue', () => {
    it('renders the brand title, folders, and runtime status badge', () => {
      const wrapper = mount(MailboxSidebar)
      expect(wrapper.text()).toContain('Boxplot Mail')
      expect(wrapper.text()).toContain('Bandeja de entrada')
      expect(wrapper.text()).toContain('Enviados')
      expect(wrapper.text()).toContain('Redactar')

      // Runtime UX check
      expect(wrapper.find('.mailbox-sidebar__runtime-status').exists()).toBe(
        true,
      )
    })

    it('opens composer when clicking Redactar button', async () => {
      const wrapper = mount(MailboxSidebar)
      const composerStore = useComposerStore()

      expect(composerStore.isOpen).toBe(false)
      const composeBtn = wrapper.find('.mailbox-sidebar__compose')
      await composeBtn.trigger('click')
      expect(composerStore.isOpen).toBe(true)
    })
  })

  describe('MessageList.vue', () => {
    it('renders email items and unread indicators', () => {
      const wrapper = mount(MessageList)
      const mailStore = useMailStore()

      expect(mailStore.emails.length).toBeGreaterThan(0)
      const items = wrapper.findAll('.message-item')
      expect(items.length).toBe(mailStore.emails.length)
    })

    it('filters messages in real time when typing in search bar', async () => {
      const wrapper = mount(MessageList)
      const input = wrapper.find('.message-list__search-input')

      await input.setValue('Reunión')
      const filtered = wrapper.findAll('.message-item')
      for (const item of filtered) {
        expect(item.text().toLowerCase()).toContain('reunión')
      }
    })

    it('displays empty state when search finds no results', async () => {
      const wrapper = mount(MessageList)
      const input = wrapper.find('.message-list__search-input')

      await input.setValue('texto_inexistente_xyz_12345')
      expect(wrapper.find('.empty-state').exists()).toBe(true)
      expect(wrapper.text()).toContain('Sin resultados')
    })

    it('displays loading spinner when mailStore.loadState is loading', async () => {
      const mailStore = useMailStore()
      mailStore.setLoadState('loading')

      const wrapper = mount(MessageList)
      expect(wrapper.find('.message-list__loading-state').exists()).toBe(true)
      expect(wrapper.text()).toContain('Cargando mensajes...')
    })
  })

  describe('MessageViewer.vue', () => {
    it('renders empty placeholder when no email is selected', () => {
      const mailStore = useMailStore()
      mailStore.selectEmail(null)

      const wrapper = mount(MessageViewer)
      expect(wrapper.find('.empty-state').exists()).toBe(true)
      expect(wrapper.text()).toContain('Selecciona un mensaje')
    })

    it('renders subject, metadata and sandboxed iframe when an email is selected', async () => {
      const mailStore = useMailStore()
      expect(mailStore.selectedEmail).not.toBeNull()

      const wrapper = mount(MessageViewer)
      expect(wrapper.find('.message-viewer__subject').text()).toBe(
        mailStore.selectedEmail?.subject,
      )

      // Verified: renders iframe with sandbox attribute per security requirements
      const iframe = wrapper.find('iframe')
      expect(iframe.exists()).toBe(true)
      expect(iframe.attributes('sandbox')).toBeDefined()
    })
  })

  describe('Composer.vue', () => {
    it('does not render modal when composerStore.isOpen is false', () => {
      const wrapper = mount(Composer)
      expect(wrapper.find('.composer').exists()).toBe(false)
    })

    it('renders form and allows editing fields when composerStore.isOpen is true', async () => {
      const composerStore = useComposerStore()
      composerStore.open({
        to: 'destinatario@prueba.com',
        subject: 'Asunto de prueba',
        body: 'Cuerpo del mensaje',
      })

      const wrapper = mount(Composer)
      expect(wrapper.find('.composer').exists()).toBe(true)
      expect(
        (wrapper.find('input[type="email"]').element as HTMLInputElement).value,
      ).toBe('destinatario@prueba.com')
      expect(
        (wrapper.find('input[type="text"]').element as HTMLInputElement).value,
      ).toBe('Asunto de prueba')
    })
  })
})
