import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMemoryLocalEngine } from '../../adapters/memory'
import { account, remoteAccountRef } from '../../domain/account'
import {
  accountKeyFromString,
  jmapAccountIdFromString,
  serviceKeyFromString,
} from '../../domain/ids'
import type { RemoteSession } from '../../remote/session'
import { FakeRemoteMail, FakeSubmission } from '../../remote/testing'
import { remoteAccountIdFromString } from '../../remote/types'
import {
  createApplicationContext,
  createMailApplicationController,
} from '../application'
import { RemoteApplicationError } from '../remote/errors'
import { DefaultRemoteApplication } from '../remote/remote-application'
import type {
  RemoteAccountStatus,
  RemoteApplication,
  RemoteConnectRequest,
  RemoteConnectResult,
} from '../remote/types'
import { rootViewMode } from '../root-view-state'
import { useMailStore } from '../stores/mail'
import { useRuntimeStore } from '../stores/runtime'

const reconnectCanary = 'BOXPLOT_A_RECONNECT_SECRET_CANARY_01'
const accountA = accountKeyFromString('status-account-a')
const accountB = accountKeyFromString('status-account-b')
const service = serviceKeyFromString('imap-smtp:127.0.0.1:1143:1587')
const remoteA = jmapAccountIdFromString('opaque/status-account-a')
const remoteB = jmapAccountIdFromString('opaque/status-account-b')
const request = {
  profile: 'boxplotLocalImap' as const,
  username: 'alice@boxplot.test',
  password: reconnectCanary,
  host: '127.0.0.1',
  imapPort: 1143,
  smtpPort: 1587,
}

const localStatus: RemoteAccountStatus = {
  auth: 'anonymous',
  connectivity: 'offline',
  lastError: null,
}

class StatusRemoteApplication implements RemoteApplication {
  readonly connect = vi.fn(
    async (
      requestValue: RemoteConnectRequest,
    ): Promise<RemoteConnectResult> => {
      this.publish(requestValue.accountKey, {
        auth: 'authenticated',
        connectivity: 'online',
        lastError: null,
      })
      return { accountKey: requestValue.accountKey }
    },
  )
  readonly subscribe = vi.fn(
    (
      accountKey: RemoteConnectRequest['accountKey'],
      listener: (status: RemoteAccountStatus) => void,
    ) => {
      const listeners = this.listeners.get(accountKey) ?? new Set()
      listeners.add(listener)
      this.listeners.set(accountKey, listeners)
      listener(this.getStatus(accountKey))
      return () => {
        this.unsubscribeCount += 1
        listeners.delete(listener)
      }
    },
  )
  unsubscribeCount = 0
  private readonly statuses = new Map<string, RemoteAccountStatus>()
  private readonly listeners = new Map<
    string,
    Set<(status: RemoteAccountStatus) => void>
  >()

  async disconnect(): Promise<void> {}
  async refreshAccount(): Promise<void> {}
  async dispose(): Promise<void> {}

  getStatus(
    accountKey: RemoteConnectRequest['accountKey'],
  ): RemoteAccountStatus {
    return this.statuses.get(accountKey) ?? localStatus
  }

  publish(
    accountKey: RemoteConnectRequest['accountKey'],
    status: RemoteAccountStatus,
  ) {
    this.statuses.set(accountKey, status)
    for (const listener of this.listeners.get(accountKey) ?? [])
      listener(status)
  }

  capturedListener(accountKey: RemoteConnectRequest['accountKey']) {
    return [...(this.listeners.get(accountKey) ?? [])][0]
  }
}

function durable(key: typeof accountA, remote: typeof remoteA) {
  return account(key, remoteAccountRef(service, remote))
}

function session(remote = remoteA): RemoteSession {
  return {
    accounts: [
      { id: remoteAccountIdFromString(String(remote)), capabilities: [] },
    ],
    mail: new FakeRemoteMail(),
    submission: new FakeSubmission(async () => ({
      kind: 'accepted',
      remoteEmailId: null,
      receiptId: null,
    })),
    close: async () => undefined,
  }
}

function controllerFor(
  remoteApplication: RemoteApplication,
  engine = createMemoryLocalEngine(),
) {
  const controller = createMailApplicationController(
    createApplicationContext({ ...engine, remoteApplication }),
    useMailStore(),
    useRuntimeStore(),
  )
  return { engine, controller }
}

describe('A2-04/A2-09 account status and session recovery', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('MULTI-01/02/03 changes the sole status subscription with account selection', async () => {
    const remote = new StatusRemoteApplication()
    remote.publish(accountA, {
      auth: 'authenticated',
      connectivity: 'online',
      lastError: null,
    })
    const { engine, controller } = controllerFor(remote)
    await engine.syncPort.registerAccount(durable(accountA, remoteA))
    await engine.syncPort.registerAccount(durable(accountB, remoteB))
    await controller.initialize()
    const staleA = remote.capturedListener(accountA)

    expect(useRuntimeStore().auth).toBe('authenticated')
    expect(remote.subscribe).toHaveBeenCalledWith(
      accountA,
      expect.any(Function),
    )
    await controller.selectAccount(accountB)

    expect(remote.unsubscribeCount).toBe(1)
    expect(remote.subscribe).toHaveBeenLastCalledWith(
      accountB,
      expect.any(Function),
    )
    expect(useRuntimeStore().auth).toBe('anonymous')
    staleA?.({ auth: 'expired', connectivity: 'offline', lastError: 'network' })
    expect(useRuntimeStore().auth).toBe('anonymous')
    expect(useRuntimeStore().connectivity).toBe('offline')
    controller.dispose()
    expect(remote.unsubscribeCount).toBe(2)
  })

  it('REC-05 fails closed before C when the service endpoint differs', async () => {
    const remote = new StatusRemoteApplication()
    const { engine, controller } = controllerFor(remote)
    const existing = durable(accountA, remoteA)
    await engine.syncPort.registerAccount(existing)
    await controller.initialize()

    const result = await controller.reconnectAccount(accountA, {
      ...request,
      host: 'other.example',
    })

    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'serviceMismatch',
        message: 'La configuración del servidor no corresponde a esta cuenta.',
      },
    })
    expect(remote.connect).not.toHaveBeenCalled()
    expect(await engine.readRepository.readAccount(accountA)).toEqual({
      ok: true,
      value: { kind: 'present', value: existing },
    })
    expect(useRuntimeStore().local).toBe('ready')
    expect(rootViewMode(useRuntimeStore().local, useMailStore().accounts)).toBe(
      'shell',
    )
    controller.dispose()
  })

  it('REC-03/04/13 reconnects a durable account through real C without duplication', async () => {
    const engine = createMemoryLocalEngine()
    const existing = durable(accountA, remoteA)
    await engine.syncPort.registerAccount(existing)
    const remote = new DefaultRemoteApplication({
      readRepository: engine.readRepository,
      syncPort: engine.syncPort,
      connectionFactory: () => ({ open: async () => session() }),
    })
    const connect = vi.spyOn(remote, 'connect')
    const { controller } = controllerFor(remote, engine)
    await controller.initialize()

    expect(useRuntimeStore().auth).toBe('anonymous')
    expect(useRuntimeStore().connectivity).toBe('offline')
    await expect(
      controller.reconnectAccount(accountA, request),
    ).resolves.toEqual({
      ok: true,
      accountKey: accountA,
    })
    expect(connect).toHaveBeenCalledOnce()
    expect(connect).toHaveBeenCalledWith(
      expect.objectContaining({ accountKey: accountA, serviceKey: service }),
    )
    expect(useMailStore().accounts).toEqual([existing])
    expect(useRuntimeStore().auth).toBe('authenticated')
    expect(useRuntimeStore().connectivity).toBe('online')
    expect(JSON.stringify(useMailStore().$state)).not.toContain(reconnectCanary)
    expect(JSON.stringify(useRuntimeStore().$state)).not.toContain(
      reconnectCanary,
    )
    controller.dispose()
  })

  it('REC-08 keeps shell on expiry and reconnects the same selected account', async () => {
    const remote = new StatusRemoteApplication()
    const { engine, controller } = controllerFor(remote)
    await engine.syncPort.registerAccount(durable(accountA, remoteA))
    await controller.initialize()
    remote.publish(accountA, {
      auth: 'expired',
      connectivity: 'offline',
      lastError: 'network',
    })

    expect(useRuntimeStore().auth).toBe('expired')
    expect(rootViewMode(useRuntimeStore().local, useMailStore().accounts)).toBe(
      'shell',
    )
    await expect(
      controller.reconnectAccount(accountA, request),
    ).resolves.toMatchObject({
      ok: true,
      accountKey: accountA,
    })
    expect(useRuntimeStore().auth).toBe('authenticated')
    expect(useRuntimeStore().connectivity).toBe('online')
    controller.dispose()
  })

  it('REC-06/07 leaves durable cached state untouched after remote failure', async () => {
    const remote = new StatusRemoteApplication()
    remote.connect.mockRejectedValue(new RemoteApplicationError('auth'))
    const { engine, controller } = controllerFor(remote)
    const existing = durable(accountA, remoteA)
    await engine.syncPort.registerAccount(existing)
    await controller.initialize()

    await expect(
      controller.reconnectAccount(accountA, request),
    ).resolves.toEqual({
      ok: false,
      error: { kind: 'auth', message: 'No se pudo autenticar la cuenta.' },
    })
    expect(useRuntimeStore().local).toBe('ready')
    expect(useMailStore().accounts).toEqual([existing])
    expect(rootViewMode(useRuntimeStore().local, useMailStore().accounts)).toBe(
      'shell',
    )
    controller.dispose()
  })

  it('REC-09 coalesces a double reconnect into one logical connect', async () => {
    const remote = new StatusRemoteApplication()
    let release!: () => void
    remote.connect.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ accountKey: accountA })
        }),
    )
    const { engine, controller } = controllerFor(remote)
    await engine.syncPort.registerAccount(durable(accountA, remoteA))
    await controller.initialize()

    const first = controller.reconnectAccount(accountA, request)
    const second = controller.reconnectAccount(accountA, request)
    await vi.waitFor(() => expect(remote.connect).toHaveBeenCalledOnce())
    release()
    await expect(first).resolves.toMatchObject({ ok: true })
    await expect(second).resolves.toMatchObject({ ok: true })
    controller.dispose()
  })

  it('MULTI-04 reconnects the explicit B identity without changing A status ownership', async () => {
    const remote = new StatusRemoteApplication()
    remote.publish(accountA, {
      auth: 'authenticated',
      connectivity: 'online',
      lastError: null,
    })
    const { engine, controller } = controllerFor(remote)
    await engine.syncPort.registerAccount(durable(accountA, remoteA))
    await engine.syncPort.registerAccount(durable(accountB, remoteB))
    await controller.initialize()

    await expect(
      controller.reconnectAccount(accountB, request),
    ).resolves.toEqual({
      ok: true,
      accountKey: accountB,
    })
    expect(remote.connect).toHaveBeenCalledWith(
      expect.objectContaining({ accountKey: accountB, serviceKey: service }),
    )
    expect(useMailStore().selectedAccountKey).toBe(accountA)
    expect(useRuntimeStore().auth).toBe('authenticated')
    expect(useRuntimeStore().connectivity).toBe('online')
    controller.dispose()
  })

  it('REC-14 revalidates local existence before reconnecting', async () => {
    const engine = createMemoryLocalEngine()
    await engine.syncPort.registerAccount(durable(accountA, remoteA))
    let removed = false
    const readRepository = Object.assign(Object.create(engine.readRepository), {
      listAccounts: async () =>
        removed
          ? { ok: true as const, value: [] }
          : engine.readRepository.listAccounts(),
    })
    const remote = new StatusRemoteApplication()
    const controller = createMailApplicationController(
      createApplicationContext({
        ...engine,
        readRepository,
        remoteApplication: remote,
      }),
      useMailStore(),
      useRuntimeStore(),
    )
    await controller.initialize()
    removed = true
    expect(await readRepository.listAccounts()).toEqual({
      ok: true,
      value: [],
    })

    const result = await controller.reconnectAccount(accountA, request)
    expect(remote.connect).not.toHaveBeenCalled()
    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'accountUnavailable',
        message: 'La cuenta local ya no está disponible.',
      },
    })
    controller.dispose()
  })
})
