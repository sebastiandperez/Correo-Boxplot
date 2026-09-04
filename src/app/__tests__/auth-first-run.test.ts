import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
import { imapAccountId } from '../../remote/imap/ids'
import {
  createApplicationContext,
  createMailApplicationController,
  gmailCredentialRefForAccount,
  serviceKeyForSetup,
} from '../application'
import type { GoogleOAuthBroker } from '../google-oauth-broker'
import { DefaultRemoteApplication } from '../remote/remote-application'
import { rootViewMode } from '../root-view-state'
import { useMailStore } from '../stores/mail'
import { useRuntimeStore } from '../stores/runtime'

const canary = 'BOXPLOT_A_AUTH_SECRET_CANARY_01'
const request = {
  profile: 'boxplotLocalImap' as const,
  username: 'alice@boxplot.test',
  password: canary,
  host: 'Boxplot.Local.',
  imapPort: 1143,
  smtpPort: 1587,
}
const prospectiveKey = accountKeyFromString('application-prospective-key')
const remoteId = remoteAccountIdFromString('opaque/boxplot-alice')

function session(accountId = remoteId): RemoteSession {
  return {
    accounts: [{ id: accountId, capabilities: [] }],
    mail: new FakeRemoteMail(),
    submission: new FakeSubmission(async () => ({
      kind: 'accepted',
      remoteEmailId: null,
      receiptId: null,
    })),
    close: async () => undefined,
  }
}

function setup(
  options: {
    open?: () => Promise<RemoteSession>
    googleOAuthBroker?: GoogleOAuthBroker
  } = {},
) {
  const engine = createMemoryLocalEngine()
  const remoteApplication = new DefaultRemoteApplication({
    readRepository: engine.readRepository,
    syncPort: engine.syncPort,
    connectionFactory: () => ({
      open: options.open ?? (async () => session()),
    }),
  })
  const controller = createMailApplicationController(
    createApplicationContext({
      ...engine,
      remoteApplication,
      accountKeyGenerator: () => prospectiveKey,
      googleOAuthBroker: options.googleOAuthBroker,
    }),
    useMailStore(),
    useRuntimeStore(),
  )
  return { engine, remoteApplication, controller }
}

describe('A2-02/A2-03 Application auth bridge and local-first routing', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('AUTH-01 routes a fresh, ready Local Engine to setup', async () => {
    const { controller } = setup()
    await controller.initialize()

    expect(rootViewMode(useRuntimeStore().local, useMailStore().accounts)).toBe(
      'setup',
    )
  })

  it('AUTH-02/03/04 uses real RemoteApplication registration then P-01 authority', async () => {
    const { engine, remoteApplication, controller } = setup()
    const connect = vi.spyOn(remoteApplication, 'connect')
    const register = vi.spyOn(engine.syncPort, 'registerAccount')
    const listAccounts = vi.spyOn(engine.readRepository, 'listAccounts')
    await controller.initialize()

    const result = await controller.connectAccount(request)

    expect(result).toEqual({ ok: true, accountKey: prospectiveKey })
    expect(connect).toHaveBeenCalledOnce()
    expect(connect).toHaveBeenCalledWith({
      accountKey: prospectiveKey,
      serviceKey: 'imap-smtp:boxplot.local:1143:1587',
      config: {
        provider: 'imapSmtp',
        host: 'Boxplot.Local.',
        username: 'alice@boxplot.test',
        password: canary,
        imapPort: 1143,
        smtpPort: 1587,
      },
    })
    expect(register).toHaveBeenCalledOnce()
    expect(listAccounts.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(useMailStore().accounts).toHaveLength(1)
    expect(useMailStore().accounts[0].key).toBe(prospectiveKey)
    expect(rootViewMode(useRuntimeStore().local, useMailStore().accounts)).toBe(
      'shell',
    )
    expect(useRuntimeStore().auth).toBe('authenticated')
    expect(useRuntimeStore().connectivity).toBe('online')
    controller.dispose()
  })

  it('AUTH-05/06 leaves setup authoritative on auth or network failure', async () => {
    const { controller } = setup({
      open: async () =>
        Promise.reject(
          new RemoteError('safe auth failure', {
            kind: 'auth',
            retry: 'never',
            session: 'keep',
            outcome: 'notApplicable',
          }),
        ),
    })
    await controller.initialize()

    const result = await controller.connectAccount(request)

    expect(result).toEqual({
      ok: false,
      error: { kind: 'auth', message: 'No se pudo autenticar la cuenta.' },
    })
    expect(useMailStore().accounts).toEqual([])
    expect(useRuntimeStore().local).toBe('ready')
    expect(useRuntimeStore().auth).toBe('anonymous')
    expect(useRuntimeStore().connectivity).toBe('online')
    expect(rootViewMode(useRuntimeStore().local, useMailStore().accounts)).toBe(
      'setup',
    )
    expect(JSON.stringify(useMailStore().$state)).not.toContain(canary)
    expect(JSON.stringify(useRuntimeStore().$state)).not.toContain(canary)
    controller.dispose()
  })

  it('AUTH-06 keeps Local Engine ready when the remote network is unavailable', async () => {
    const { controller } = setup({
      open: async () =>
        Promise.reject(
          new RemoteError('safe network failure', {
            kind: 'network',
            retry: 'safeBackoff',
            session: 'keep',
            outcome: 'notApplicable',
          }),
        ),
    })
    await controller.initialize()

    await expect(controller.connectAccount(request)).resolves.toEqual({
      ok: false,
      error: { kind: 'network', message: 'No se pudo contactar al servidor.' },
    })
    expect(useRuntimeStore().local).toBe('ready')
    expect(useRuntimeStore().auth).toBe('anonymous')
    expect(useRuntimeStore().connectivity).toBe('offline')
    expect(useMailStore().accounts).toEqual([])
    controller.dispose()
  })

  it('AUTH-07 coalesces rapid submits into one RemoteApplication connect', async () => {
    let open!: () => void
    const gate = new Promise<RemoteSession>((resolve) => {
      open = () => resolve(session())
    })
    const { remoteApplication, controller } = setup({ open: () => gate })
    const connect = vi.spyOn(remoteApplication, 'connect')
    await controller.initialize()

    const first = controller.connectAccount(request)
    const second = controller.connectAccount(request)
    await vi.waitFor(() => expect(connect).toHaveBeenCalledOnce())
    open()
    await expect(first).resolves.toMatchObject({ ok: true })
    await expect(second).resolves.toMatchObject({ ok: true })
    controller.dispose()
  })

  it('AUTH-09 clears presentation-owned credentials only after authenticated success', async () => {
    const { controller } = setup()
    const cleanup = vi.fn()
    await controller.initialize()

    await controller.connectAccount(request, { onAuthenticated: cleanup })

    expect(cleanup).toHaveBeenCalledOnce()
    controller.dispose()
  })

  it('AUTH-10/11 preserves shell routing for a durable offline or expired account', async () => {
    const { engine, remoteApplication, controller } = setup()
    const existing = account(
      accountKeyFromString('durable-offline-account'),
      remoteAccountRef(
        serviceKeyFromString('durable-service'),
        jmapAccountIdFromString('durable-remote-account'),
      ),
    )
    await engine.syncPort.registerAccount(existing)
    await controller.initialize()

    expect(useRuntimeStore().auth).toBe('anonymous')
    expect(useRuntimeStore().connectivity).toBe('offline')
    expect(rootViewMode(useRuntimeStore().local, useMailStore().accounts)).toBe(
      'shell',
    )
    expect(remoteApplication.getStatus(existing.key).auth).toBe('anonymous')
    controller.dispose()
  })

  it('AUTH-12 refreshes Accounts from a P-03 invalidation without synthetic writes', async () => {
    const { engine, controller } = setup()
    await controller.initialize()
    const existing = account(
      accountKeyFromString('p03-account'),
      remoteAccountRef(
        serviceKeyFromString('p03-service'),
        jmapAccountIdFromString('p03-remote-account'),
      ),
    )

    await engine.syncPort.registerAccount(existing)
    await vi.waitFor(() => {
      expect(useMailStore().accounts).toEqual([existing])
    })
    expect(rootViewMode(useRuntimeStore().local, useMailStore().accounts)).toBe(
      'shell',
    )
    controller.dispose()
  })

  it('AUTH-15 derives a stable service identity without a password', async () => {
    const { controller } = setup()
    await controller.initialize()
    const first = controller.connectAccount(request)
    await first
    const local = useMailStore().accounts[0]

    expect(local.remoteRef.serviceKey).toBe('imap-smtp:boxplot.local:1143:1587')
    expect(String(local.remoteRef.serviceKey)).not.toContain(canary)
    expect(serviceKeyForSetup(request)).toBe(
      serviceKeyForSetup({ ...request, password: 'different-password' }),
    )
    controller.dispose()
  })

  it('GMAIL-01 keeps OAuth values out of Application state and registers through RemoteApplication', async () => {
    const credentialRef = gmailCredentialRefForAccount(prospectiveKey)
    const broker: GoogleOAuthBroker = {
      authorize: vi.fn(async () => ({ credentialRef })),
      forget: vi.fn(async () => undefined),
    }
    const { remoteApplication, controller } = setup({
      googleOAuthBroker: broker,
    })
    const connect = vi.spyOn(remoteApplication, 'connect')
    await controller.initialize()

    await expect(
      controller.connectAccount({
        profile: 'gmailOAuth',
        username: 'alice@gmail.com',
      }),
    ).resolves.toEqual({ ok: true, accountKey: prospectiveKey })

    expect(broker.authorize).toHaveBeenCalledWith(
      prospectiveKey,
      'alice@gmail.com',
    )
    expect(connect).toHaveBeenCalledWith({
      accountKey: prospectiveKey,
      serviceKey: 'gmail:imap-smtp:v1',
      config: {
        provider: 'gmail',
        username: 'alice@gmail.com',
        credentialRef,
      },
    })
    expect(JSON.stringify(useMailStore().$state)).not.toContain(credentialRef)
    expect(JSON.stringify(useRuntimeStore().$state)).not.toContain(
      credentialRef,
    )
    expect(
      serviceKeyForSetup({
        profile: 'gmailOAuth',
        username: 'another@gmail.com',
      }),
    ).toBe('gmail:imap-smtp:v1')
    controller.dispose()
  })

  it('GMAIL-02 reconnects a durable Gmail account without reopening the browser', async () => {
    const accountKey = accountKeyFromString('gmail-restart-account')
    const username = 'alice@gmail.com'
    const remoteAccount = imapAccountId(username)
    const broker: GoogleOAuthBroker = {
      authorize: vi.fn(),
      forget: vi.fn(),
    }
    const { engine, remoteApplication, controller } = setup({
      googleOAuthBroker: broker,
      open: async () => session(remoteAccount),
    })
    const existing = account(
      accountKey,
      remoteAccountRef(
        serviceKeyFromString('gmail:imap-smtp:v1'),
        jmapAccountIdFromString(String(remoteAccount)),
      ),
    )
    await engine.syncPort.registerAccount(existing)
    const connect = vi.spyOn(remoteApplication, 'connect')
    await controller.initialize()

    await expect(
      controller.reconnectAccount(accountKey, {
        profile: 'gmailOAuth',
        username,
      }),
    ).resolves.toEqual({ ok: true, accountKey })

    expect(broker.authorize).not.toHaveBeenCalled()
    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({
        accountKey,
        serviceKey: 'gmail:imap-smtp:v1',
        config: {
          provider: 'gmail',
          username,
          credentialRef: gmailCredentialRefForAccount(accountKey),
        },
      }),
    )
    controller.dispose()
  })

  it('GMAIL-03 rejects a mismatched Gmail session without rebinding the durable account', async () => {
    const accountKey = accountKeyFromString('gmail-account-a')
    const username = 'alice@gmail.com'
    const expectedRemote = imapAccountId(username)
    const { engine, controller } = setup({
      open: async () => session(imapAccountId('bob@gmail.com')),
    })
    const existing = account(
      accountKey,
      remoteAccountRef(
        serviceKeyFromString('gmail:imap-smtp:v1'),
        jmapAccountIdFromString(String(expectedRemote)),
      ),
    )
    await engine.syncPort.registerAccount(existing)
    await controller.initialize()

    await expect(
      controller.reconnectAccount(accountKey, {
        profile: 'gmailOAuth',
        username,
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        kind: 'accountMismatch',
        message: 'La cuenta remota no coincide con la configuración local.',
      },
    })
    expect(useMailStore().accounts).toEqual([existing])
    expect(useRuntimeStore().local).toBe('ready')
    controller.dispose()
  })

  it('reuses the durable AccountKey and ServiceKey for a later connection', async () => {
    const { engine, remoteApplication, controller } = setup()
    const existing = account(
      accountKeyFromString('durable-reconnect-key'),
      remoteAccountRef(
        serviceKeyFromString('durable-reconnect-service'),
        jmapAccountIdFromString(String(remoteId)),
      ),
    )
    await engine.syncPort.registerAccount(existing)
    const connect = vi.spyOn(remoteApplication, 'connect')
    await controller.initialize()

    await expect(controller.connectAccount(request)).resolves.toEqual({
      ok: true,
      accountKey: existing.key,
    })
    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({
        accountKey: existing.key,
        serviceKey: existing.remoteRef.serviceKey,
      }),
    )
    controller.dispose()
  })

  it('AUTH-13 reports a Local Engine read failure as local state, not auth', async () => {
    const engine = createMemoryLocalEngine()
    const failingReadRepository = {
      ...engine.readRepository,
      listAccounts: async () => ({
        ok: false as const,
        error: { kind: 'unavailable' as const },
      }),
    }
    const controller = createMailApplicationController(
      createApplicationContext({
        ...engine,
        readRepository: failingReadRepository,
      }),
      useMailStore(),
      useRuntimeStore(),
    )

    await expect(controller.initialize()).rejects.toThrow('listAccounts failed')
    expect(useRuntimeStore().local).toBe('error')
    expect(useRuntimeStore().auth).toBe('anonymous')
    expect(rootViewMode(useRuntimeStore().local, useMailStore().accounts)).toBe(
      'localError',
    )
    controller.dispose()
  })
})
