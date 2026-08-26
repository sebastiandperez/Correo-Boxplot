// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const localSetItem = vi.fn()
const sessionSetItem = vi.fn()

function installStorageSpies() {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { length: 0, setItem: localSetItem },
  })
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: { length: 0, setItem: sessionSetItem },
  })
}

import { BOXPLOT_LOCAL_SMTP_PORT, useAccountSetupStore } from '../account-setup'

function fillValidState() {
  const store = useAccountSetupStore()
  store.setUsername('alice@boxplot.test')
  store.setPassword('manual-secret')
  store.setHost('127.0.0.1')
  store.setPort('1143')
  return store
}

describe('Account setup store (A2-01)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localSetItem.mockReset()
    sessionSetItem.mockReset()
    installStorageSpies()
  })

  it('AS-S01 starts with the frozen Boxplot Local defaults', () => {
    const store = useAccountSetupStore()
    expect(store.profile).toBe('boxplotLocalImap')
    expect(store.host).toBe('127.0.0.1')
    expect(store.port).toBe('1143')
    expect(store.password).toBe('')
    expect(store.phase).toBe('idle')
    expect(store.error).toBeNull()
  })

  it('AS-S02 setting username updates only username', () => {
    const store = useAccountSetupStore()
    const initial = {
      host: store.host,
      port: store.port,
      password: store.password,
    }
    store.setUsername('alice@boxplot.test')
    expect(store.username).toBe('alice@boxplot.test')
    expect({
      host: store.host,
      port: store.port,
      password: store.password,
    }).toEqual(initial)
  })

  it('AS-S03 keeps password only in Pinia memory', () => {
    const store = useAccountSetupStore()
    store.setPassword('manual-secret')
    expect(store.password).toBe('manual-secret')
    expect(localSetItem).not.toHaveBeenCalled()
    expect(sessionSetItem).not.toHaveBeenCalled()
  })

  it('AS-S04 clearSensitive clears only password', () => {
    const store = fillValidState()
    store.clearSensitive()
    expect(store.password).toBe('')
    expect(store.username).toBe('alice@boxplot.test')
    expect(store.host).toBe('127.0.0.1')
    expect(store.port).toBe('1143')
  })

  it('AS-S05 reset restores defaults and clears sensitive state', () => {
    const store = fillValidState()
    store.setHost('mail.example.test')
    store.setPort('993')
    store.reset()
    expect(store.$state).toEqual({
      profile: 'boxplotLocalImap',
      username: '',
      password: '',
      host: '127.0.0.1',
      port: '1143',
      phase: 'idle',
      error: null,
    })
  })

  it.each([
    ['AS-S06 empty username', 'username', '', 'usuario'],
    ['AS-S07 empty password', 'password', '', 'contraseña'],
    ['AS-S08 empty host', 'host', '', 'servidor'],
    ['AS-S09 empty port', 'port', '', 'puerto IMAP'],
  ] as const)('%s fails validation', (_name, field, value, message) => {
    const store = fillValidState()
    store[field] = value
    expect(store.validate()).toBe(false)
    expect(store.error?.toLowerCase()).toContain(message.toLowerCase())
    expect(store.phase).toBe('idle')
  })

  it.each([
    ['AS-S10 zero', '0'],
    ['AS-S11 negative', '-1'],
    ['AS-S12 above range', '65536'],
    ['AS-S14 decimal', '1143.5'],
    ['AS-S15 nonnumeric', 'imap'],
  ])('%s port fails validation', (_name, port) => {
    const store = fillValidState()
    store.setPort(port)
    expect(store.validate()).toBe(false)
    expect(store.error).toContain('1 y 65535')
  })

  it('AS-S13 accepts port 1143', () => {
    expect(fillValidState().validate()).toBe(true)
  })

  it('AS-S16 builds the exact protocol-neutral request', () => {
    const store = fillValidState()
    store.setHost('boxplot.local')
    const result = store.buildRequest()
    expect(result).toEqual({
      ok: true,
      value: {
        profile: 'boxplotLocalImap',
        username: 'alice@boxplot.test',
        password: 'manual-secret',
        host: 'boxplot.local',
        imapPort: 1143,
        smtpPort: BOXPLOT_LOCAL_SMTP_PORT,
      },
    })
  })

  it('AS-S17 buildRequest performs no network or native calls', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const store = fillValidState()
    expect(store.buildRequest().ok).toBe(true)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('does not persist a password marker to browser storage', () => {
    const marker = 'SUPER-SECRET-A2-01-PASSWORD-12345'
    const store = useAccountSetupStore()
    store.setPassword(marker)
    expect(store.password).toBe(marker)
    expect(localSetItem).not.toHaveBeenCalled()
    expect(sessionSetItem).not.toHaveBeenCalled()
  })

  it('reselecting the profile restores network defaults without inventing SMTP input', () => {
    const store = fillValidState()
    store.setHost('changed.test')
    store.setPort('993')
    store.setProfile('boxplotLocalImap')
    expect(store.host).toBe('127.0.0.1')
    expect(store.port).toBe('1143')
    expect(store.smtpPort).toBe(1587)
    expect(store.smtpEndpoint).toBe('127.0.0.1:1587')
  })
})
