import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMemoryLocalEngine } from '../../adapters/memory'
import { account, remoteAccountRef } from '../../domain/account'
import {
  accountKeyFromString,
  jmapAccountIdFromString,
  serviceKeyFromString,
} from '../../domain/ids'
import {
  createApplicationContext,
  createMailApplicationController,
} from '../application'
import { RemoteApplicationError } from '../remote/errors'
import type {
  RemoteAccountStatus,
  RemoteApplication,
  RemoteConnectRequest,
  RemoteConnectResult,
} from '../remote/types'
import { useMailStore } from '../stores/mail'
import { useRuntimeStore } from '../stores/runtime'

const accountA = accountKeyFromString('repair-coalescing-account-a')
const accountB = accountKeyFromString('repair-coalescing-account-b')
const service = serviceKeyFromString('imap-smtp:127.0.0.1:1143:1587')
const request = {
  profile: 'boxplotLocalImap' as const,
  username: 'repair@boxplot.test',
  password: 'BOXPLOT_REPAIR_CONNECTION_SECRET_01',
  host: '127.0.0.1',
  imapPort: 1143,
  smtpPort: 1587,
}

const localStatus: RemoteAccountStatus = {
  auth: 'anonymous',
  connectivity: 'offline',
  lastError: null,
}

class DeferredRemoteApplication implements RemoteApplication {
  readonly connect = vi.fn(
    (requestValue: RemoteConnectRequest) =>
      new Promise<RemoteConnectResult>((resolve, reject) => {
        this.pending.set(requestValue.accountKey, { resolve, reject })
      }),
  )
  private readonly pending = new Map<
    string,
    {
      resolve: (result: RemoteConnectResult) => void
      reject: (error: unknown) => void
    }
  >()

  resolve(accountKey: RemoteConnectRequest['accountKey']) {
    this.pending.get(accountKey)?.resolve({ accountKey })
  }

  reject(accountKey: RemoteConnectRequest['accountKey'], error: unknown) {
    this.pending.get(accountKey)?.reject(error)
  }

  async disconnect(): Promise<void> {}
  async refreshAccount(): Promise<void> {}
  async dispose(): Promise<void> {}
  getStatus(): RemoteAccountStatus {
    return localStatus
  }
  subscribe(
    _accountKey: RemoteConnectRequest['accountKey'],
    listener: (status: RemoteAccountStatus) => void,
  ): () => void {
    listener(localStatus)
    return () => undefined
  }
}

function durable(accountKey: typeof accountA, remoteId: string) {
  return account(
    accountKey,
    remoteAccountRef(service, jmapAccountIdFromString(remoteId)),
  )
}

async function setup() {
  const engine = createMemoryLocalEngine()
  await engine.syncPort.registerAccount(durable(accountA, 'opaque/repair-a'))
  await engine.syncPort.registerAccount(durable(accountB, 'opaque/repair-b'))
  const remote = new DeferredRemoteApplication()
  const controller = createMailApplicationController(
    createApplicationContext({ ...engine, remoteApplication: remote }),
    useMailStore(),
    useRuntimeStore(),
  )
  await controller.initialize()
  return { controller, remote }
}

async function expectConnectFor(
  remote: DeferredRemoteApplication,
  accountKey: typeof accountA,
) {
  await vi.waitFor(() =>
    expect(remote.connect).toHaveBeenCalledWith(
      expect.objectContaining({ accountKey }),
    ),
  )
}

const inProgress = {
  ok: false,
  error: {
    kind: 'connectionInProgress',
    message: 'Ya hay una conexión en curso.',
  },
}

describe('account connection attempt coalescing', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('REPAIR-01 coalesces duplicate reconnect requests for the same account', async () => {
    const { controller, remote } = await setup()
    const first = controller.reconnectAccount(accountA, request)
    const second = controller.reconnectAccount(accountA, request)

    expect(second).toBe(first)
    await expectConnectFor(remote, accountA)
    expect(remote.connect).toHaveBeenCalledOnce()
    remote.resolve(accountA)
    await expect(first).resolves.toEqual({ ok: true, accountKey: accountA })
    await expect(second).resolves.toEqual({ ok: true, accountKey: accountA })
    controller.dispose()
  })

  it('REPAIR-02/03/04/06 rejects B without touching pending A, then allows B after A settles', async () => {
    const { controller, remote } = await setup()
    const reconnectA = controller.reconnectAccount(accountA, request)
    await expectConnectFor(remote, accountA)

    const reconnectBWhileAIsPending = controller.reconnectAccount(
      accountB,
      request,
    )
    await expect(reconnectBWhileAIsPending).resolves.toEqual(inProgress)
    expect(remote.connect).toHaveBeenCalledOnce()

    remote.resolve(accountA)
    await expect(reconnectA).resolves.toEqual({
      ok: true,
      accountKey: accountA,
    })

    const reconnectBAfterA = controller.reconnectAccount(accountB, request)
    await expectConnectFor(remote, accountB)
    expect(remote.connect).toHaveBeenCalledTimes(2)
    remote.resolve(accountB)
    await expect(reconnectBAfterA).resolves.toEqual({
      ok: true,
      accountKey: accountB,
    })
    controller.dispose()
  })

  it('REPAIR-05 clears the slot after a failed A reconnect', async () => {
    const { controller, remote } = await setup()
    const reconnectA = controller.reconnectAccount(accountA, request)
    await expectConnectFor(remote, accountA)
    remote.reject(accountA, new RemoteApplicationError('network'))
    await expect(reconnectA).resolves.toMatchObject({
      ok: false,
      error: { kind: 'network' },
    })

    const reconnectB = controller.reconnectAccount(accountB, request)
    await expectConnectFor(remote, accountB)
    expect(remote.connect).toHaveBeenCalledTimes(2)
    remote.resolve(accountB)
    await expect(reconnectB).resolves.toEqual({
      ok: true,
      accountKey: accountB,
    })
    controller.dispose()
  })

  it('REPAIR-11 rejects a first-run operation while a reconnect is pending', async () => {
    const { controller, remote } = await setup()
    const reconnectA = controller.reconnectAccount(accountA, request)
    await expectConnectFor(remote, accountA)

    await expect(controller.connectAccount(request)).resolves.toEqual(
      inProgress,
    )
    expect(remote.connect).toHaveBeenCalledOnce()

    remote.resolve(accountA)
    await expect(reconnectA).resolves.toEqual({
      ok: true,
      accountKey: accountA,
    })
    controller.dispose()
  })
})
