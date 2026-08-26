// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const localSetItem = vi.fn()
const sessionSetItem = vi.fn()

import { useAccountSetupStore } from '../../app/stores/account-setup'
import AccountSetup from '../account/AccountSetup.vue'

function mountSetup() {
  return mount(AccountSetup, { attachTo: document.body })
}

async function fillValidForm(wrapper: ReturnType<typeof mountSetup>) {
  await wrapper.find('#account-username').setValue('alice@boxplot.test')
  await wrapper.find('#account-password').setValue('manual-secret')
  await wrapper.find('#account-host').setValue('127.0.0.1')
  await wrapper.find('#account-imap-port').setValue('1143')
}

describe('AccountSetup presentation (A2-01)', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    setActivePinia(createPinia())
    localSetItem.mockReset()
    sessionSetItem.mockReset()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { length: 0, setItem: localSetItem },
    })
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      value: { length: 0, setItem: sessionSetItem },
    })
  })

  it('AS-C01 renders the complete accessible setup form', () => {
    const wrapper = mountSetup()
    expect(wrapper.text()).toContain('Configurar cuenta')
    expect(wrapper.text()).toContain('Perfil / protocolo')
    expect(wrapper.text()).toContain('Usuario')
    expect(wrapper.text()).toContain('Contraseña')
    expect(wrapper.text()).toContain('Servidor')
    expect(wrapper.text()).toContain('Puerto IMAP')
    expect(wrapper.get('button[type="submit"]').text()).toBe('Conectar')
    expect(wrapper.findAll('label')).toHaveLength(5)
  })

  it('AS-C02 uses a password input and never renders its value as text', async () => {
    const wrapper = mountSetup()
    const password = wrapper.get('#account-password')
    expect(password.attributes('type')).toBe('password')
    expect(password.attributes('autocomplete')).toBe('current-password')
    await password.setValue('VISIBLE-NOWHERE-SECRET')
    expect(wrapper.text()).not.toContain('VISIBLE-NOWHERE-SECRET')
  })

  it('AS-C03/C04 displays profile, IMAP, host, and derived SMTP defaults', () => {
    const wrapper = mountSetup()
    expect(wrapper.get('select').text()).toContain('Boxplot Local / IMAP')
    expect(
      (wrapper.get('#account-host').element as HTMLInputElement).value,
    ).toBe('127.0.0.1')
    expect(
      (wrapper.get('#account-imap-port').element as HTMLInputElement).value,
    ).toBe('1143')
    expect(wrapper.text()).toContain('SMTP: 127.0.0.1:1587')
  })

  it('AS-C05 updates only the informational SMTP host', async () => {
    const wrapper = mountSetup()
    await wrapper.get('#account-host').setValue('mail.boxplot.test')
    expect(wrapper.text()).toContain('SMTP: mail.boxplot.test:1587')
    expect(wrapper.find('input[name="smtpPort"]').exists()).toBe(false)
  })

  it('AS-C06/C07 emits one validated request with numeric and derived ports', async () => {
    const wrapper = mountSetup()
    await fillValidForm(wrapper)
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('submit')).toHaveLength(1)
    expect(wrapper.emitted('submit')?.[0]?.[0]).toEqual({
      profile: 'boxplotLocalImap',
      username: 'alice@boxplot.test',
      password: 'manual-secret',
      host: '127.0.0.1',
      imapPort: 1143,
      smtpPort: 1587,
    })
  })

  it('AS-C08/C09 invalid form does not emit and shows an understandable error', async () => {
    const wrapper = mountSetup()
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('submit')).toBeUndefined()
    expect(wrapper.get('[role="alert"]').text()).toContain(
      'El usuario es obligatorio.',
    )
  })

  it('AS-C10 keeps password solely in the memory-backed store', async () => {
    const wrapper = mountSetup()
    const marker = 'SUPER-SECRET-A2-01-PASSWORD-12345'
    await wrapper.get('#account-password').setValue(marker)
    expect(useAccountSetupStore().password).toBe(marker)
    expect(wrapper.text()).not.toContain(marker)
    expect(localSetItem).not.toHaveBeenCalled()
    expect(sessionSetItem).not.toHaveBeenCalled()
  })

  it('AS-C11 native form submit follows the same validation path', async () => {
    const wrapper = mountSetup()
    await fillValidForm(wrapper)
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('submit')).toHaveLength(1)
  })

  it('has no concrete remote, Tauri, E2EE, or persistence imports', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/components/account/AccountSetup.vue'),
      'utf8',
    )
    expect(source).not.toMatch(
      /src\/jmap|src\/workers|ImapAdapter|SmtpSubmission|JmapClient|@tauri-apps|invoke\(|E2eePort|ReadRepository|SyncPort/,
    )
  })
})
