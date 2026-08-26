// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { openUrl } = vi.hoisted(() => ({ openUrl: vi.fn() }))

vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl }))

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
import MessageViewer from '../message-viewer/MessageViewer.vue'

type TestDependencies = Awaited<
  ReturnType<typeof createSeededMemoryApplication>
> & {
  context: ReturnType<typeof createApplicationContext>
  controller: ReturnType<typeof createMailApplicationController>
}

let dependencies: TestDependencies
let mountedWrappers: VueWrapper[]

function mountViewer(): VueWrapper {
  const wrapper = mount(MessageViewer, {
    global: {
      provide: {
        [applicationContextKey as symbol]: dependencies.context,
        [mailApplicationControllerKey as symbol]: dependencies.controller,
      },
    },
    attachTo: document.body,
  })
  mountedWrappers.push(wrapper)
  return wrapper
}

function loadIframeDocument(wrapper: VueWrapper, html: string) {
  const iframe = wrapper.find('iframe').element as HTMLIFrameElement
  const document = iframe.contentDocument
  if (!document) throw new Error('Test iframe has no document')
  document.body.innerHTML = html
  iframe.dispatchEvent(new Event('load'))
  return { iframe, document }
}

async function clickIframeLink(wrapper: VueWrapper, href: string) {
  const { document } = loadIframeDocument(
    wrapper,
    `<a href="${href}">external</a>`,
  )
  const anchor = document.querySelector('a')
  if (!anchor) throw new Error('Test link was not created')
  const click = new MouseEvent('click', { bubbles: true, cancelable: true })
  anchor.dispatchEvent(click)
  await Promise.resolve()
  return click
}

describe('MessageViewer security regression gate (A2-00)', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    mountedWrappers = []
    openUrl.mockReset()
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

  afterEach(() => {
    for (const wrapper of mountedWrappers) {
      if (wrapper.exists()) wrapper.unmount()
    }
    document.body.innerHTML = ''
  })

  it('MV-S01/S02 uses only the frozen iframe sandbox permission', () => {
    const sandbox = mountViewer().find('iframe').attributes('sandbox')
    expect(sandbox).toBe('allow-same-origin')
    expect(sandbox).not.toMatch(
      /allow-(?:popups|popups-to-escape-sandbox|scripts|forms|top-navigation)/,
    )
  })

  it('MV-S03/S04/S05 removes scripts, handlers, and remote images from srcdoc', () => {
    useMailStore().setEmailBody(
      {
        emailId: dependencies.fixtures.emailA1.id,
        text: null,
        html: '<script>alert(1)</script><p onclick="bad()">Safe</p><img src="https://tracker.example/pixel">',
      },
      'cached',
    )
    const srcdoc = mountViewer().find('iframe').attributes('srcdoc')
    expect(srcdoc).not.toContain('<script')
    expect(srcdoc).not.toContain('onclick')
    expect(srcdoc).not.toContain('<img')
    expect(srcdoc).not.toContain('tracker.example')
    expect(srcdoc).toContain('Safe')
  })

  it.each(['javascript:alert(1)', 'data:text/html,unsafe', 'file:///tmp/mail'])(
    'MV-S06/S07/S08 prevents %s navigation without an allowed open',
    async (href) => {
      const wrapper = mountViewer()
      const locationBefore = window.location.href
      const click = await clickIframeLink(wrapper, href)
      expect(click.defaultPrevented).toBe(true)
      expect(openUrl).not.toHaveBeenCalled()
      expect(window.location.href).toBe(locationBefore)
    },
  )

  it.each(['https://example.test/path', 'http://example.test/path'])(
    'MV-S09/S10 routes %s through the controlled opener exactly once',
    async (href) => {
      const wrapper = mountViewer()
      const locationBefore = window.location.href
      const click = await clickIframeLink(wrapper, href)
      expect(click.defaultPrevented).toBe(true)
      expect(openUrl).toHaveBeenCalledOnce()
      expect(openUrl).toHaveBeenCalledWith(href)
      expect(window.location.href).toBe(locationBefore)
    },
  )

  it('MV-S11 repeated iframe loads do not multiply listeners', async () => {
    const wrapper = mountViewer()
    const { iframe, document } = loadIframeDocument(
      wrapper,
      '<a href="https://example.test">external</a>',
    )
    iframe.dispatchEvent(new Event('load'))
    document
      .querySelector('a')
      ?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      )
    await Promise.resolve()
    expect(openUrl).toHaveBeenCalledOnce()
  })

  it('MV-S12 unmount removes the iframe listener', async () => {
    const wrapper = mountViewer()
    const { document } = loadIframeDocument(
      wrapper,
      '<a href="https://example.test">external</a>',
    )
    wrapper.unmount()
    document
      .querySelector('a')
      ?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      )
    await Promise.resolve()
    expect(openUrl).not.toHaveBeenCalled()
  })

  it('MV-S13 escapes a script-shaped text body', () => {
    useMailStore().setEmailBody(
      {
        emailId: dependencies.fixtures.emailA1.id,
        text: '<script>alert(1)</script>',
        html: null,
      },
      'cached',
    )
    const srcdoc = mountViewer().find('iframe').attributes('srcdoc')
    expect(srcdoc).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(srcdoc).not.toContain('<script>alert(1)</script>')
  })

  it('MV-S14 treats cached null/null as a complete body', () => {
    useMailStore().setEmailBody(dependencies.fixtures.nullBodyA1, 'cached')
    const wrapper = mountViewer()
    expect(wrapper.find('iframe').exists()).toBe(true)
    expect(wrapper.find('iframe').attributes('srcdoc')).toContain(
      'Mensaje sin representación textual o HTML',
    )
  })

  it('MV-S15 does not substitute preview when the body is not cached', () => {
    useMailStore().setEmailBody(null, 'notCached')
    const wrapper = mountViewer()
    expect(wrapper.find('iframe').exists()).toBe(false)
    expect(wrapper.text()).not.toContain(dependencies.fixtures.emailA1.preview)
  })

  it('preserves representative UTF-8 UI strings', async () => {
    const mailStore = useMailStore()
    const wrapper = mountViewer()
    expect(wrapper.text()).toContain('Leído')

    mailStore.setEmailBody(dependencies.fixtures.nullBodyA1, 'cached')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('iframe').attributes('srcdoc')).toContain(
      'representación',
    )

    await wrapper
      .find('button[title="Responder al remitente"]')
      .trigger('click')
    expect(useComposerStore().body).toContain('escribió')

    mailStore.setEmailBody(null, 'notCached')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('caché')
  })
})
