// @vitest-environment happy-dom
import { createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import App from '../../App.vue'
import { createMemoryLocalEngine } from '../../adapters/memory'
import { account, remoteAccountRef } from '../../domain/account'
import {
  accountKeyFromString,
  jmapAccountIdFromString,
  serviceKeyFromString,
} from '../../domain/ids'
import { RemoteError } from '../../remote/errors'
import type { RemoteSession } from '../../remote/session'
import { FakeRemoteMail, FakeSubmission } from '../../remote/testing'
import { remoteAccountIdFromString } from '../../remote/types'
import { createApplicationContext } from '../../app/application'
import { DefaultRemoteApplication } from '../../app/remote/remote-application'
import { applicationContextKey } from '../../app/vue-application-context'

const request = {
  profile: 'boxplotLocalImap' as const,
  username: 'alice@boxplot.test',
  password: 'BOXPLOT_A_AUTH_SECRET_CANARY_01',
  host: '127.0.0.1',
  imapPort: 1143,
  smtpPort: 1587,
}

function mountApp(
  options: { remote?: boolean; open?: () => Promise<RemoteSession> } = {},
) {
  const engine = createMemoryLocalEngine()
  const remoteApplication = options.remote
    ? new DefaultRemoteApplication({
        readRepository: engine.readRepository,
        syncPort: engine.syncPort,
        connectionFactory: () => ({
          open:
            options.open ??
            (async () => ({
              accounts: [
                {
                  id: remoteAccountIdFromString('opaque/app-routing-account'),
                  capabilities: [],
                },
              ],
              mail: new FakeRemoteMail(),
              submission: new FakeSubmission(async () => ({
                kind: 'accepted' as const,
                remoteEmailId: null,
                receiptId: null,
              })),
              close: async () => undefined,
            })),
        }),
      })
    : undefined
  const context = createApplicationContext({
    ...engine,
    remoteApplication,
    accountKeyGenerator: () => accountKeyFromString('app-routing-account'),
  })
  const wrapper = mount(App, {
    global: {
      plugins: [createPinia()],
      provide: { [applicationContextKey as symbol]: context },
      stubs: { AppShell: { template: '<div data-test="shell">shell</div>' } },
    },
  })
  return { engine, wrapper }
}

describe('first-run root projection (A2-03)', () => {
  it('UI-01 shows AccountSetup, never an empty AppShell, on a fresh engine', async () => {
    const { wrapper } = mountApp()
    await vi.waitFor(() =>
      expect(wrapper.find('.account-setup').exists()).toBe(true),
    )

    expect(wrapper.find('[data-test="shell"]').exists()).toBe(false)
    wrapper.unmount()
  })

  it('UI-02/UI-06 shows cached AppShell while remote auth is anonymous/offline', async () => {
    const { engine, wrapper } = mountApp()
    await engine.syncPort.registerAccount(
      account(
        accountKeyFromString('cached-account'),
        remoteAccountRef(
          serviceKeyFromString('cached-service'),
          jmapAccountIdFromString('cached-remote'),
        ),
      ),
    )

    await vi.waitFor(() =>
      expect(wrapper.find('[data-test="shell"]').exists()).toBe(true),
    )
    expect(wrapper.find('.account-setup').exists()).toBe(false)
    wrapper.unmount()
  })

  it('UI-05 switches to AppShell only after the local Account reread', async () => {
    const { wrapper } = mountApp({ remote: true })
    await vi.waitFor(() =>
      expect(wrapper.find('.account-setup').exists()).toBe(true),
    )

    wrapper.findComponent({ name: 'AccountSetup' }).vm.$emit('submit', request)

    await vi.waitFor(() =>
      expect(wrapper.find('[data-test="shell"]').exists()).toBe(true),
    )
    expect(wrapper.text()).not.toContain(request.password)
    wrapper.unmount()
  })

  it('UI-04 keeps setup visible and shows a safe authentication error', async () => {
    const { wrapper } = mountApp({
      remote: true,
      open: async () =>
        Promise.reject(
          new RemoteError('credential rejected', {
            kind: 'auth',
            retry: 'never',
            session: 'keep',
            outcome: 'notApplicable',
          }),
        ),
    })
    await vi.waitFor(() =>
      expect(wrapper.find('.account-setup').exists()).toBe(true),
    )

    wrapper.findComponent({ name: 'AccountSetup' }).vm.$emit('submit', request)

    await vi.waitFor(() =>
      expect(wrapper.get('[role="alert"]').text()).toContain(
        'No se pudo autenticar la cuenta.',
      ),
    )
    expect(wrapper.find('.account-setup').exists()).toBe(true)
    expect(wrapper.find('[data-test="shell"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain(request.password)
    wrapper.unmount()
  })
})
