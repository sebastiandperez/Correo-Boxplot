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
import type {
  RemoteAccountStatus,
  RemoteApplication,
  RemoteConnectRequest,
  RemoteConnectResult,
} from '../remote/types'
import { useMailStore } from '../stores/mail'
import { useRuntimeStore } from '../stores/runtime'

const accountA = accountKeyFromString('verify-concurrent-account-a')
const accountB = accountKeyFromString('verify-concurrent-account-b')
const service = serviceKeyFromString('imap-smtp:127.0.0.1:1143:1587')
const request = {
  profile: 'boxplotLocalImap' as const,
  username: 'verify@boxplot.test',
  password: 'BOXPLOT_VERIFY_RECONNECT_SECRET_02',
  host: '127.0.0.1',
  imapPort: 1143,
  smtpPort: 1587,
}

class VerifierDeferredRemoteApplication implements RemoteApplication {
  readonly connect = vi.fn(
    (requestValue: RemoteConnectRequest) =>
      new Promise<RemoteConnectResult>((resolve) => {
        this.resolveConnect.set(requestValue.accountKey, () =>
          resolve({ accountKey: requestValue.accountKey }),
        )
      }),
  )
  readonly resolveConnect = new Map<string, () => void>()

  async disconnect(): Promise<void> {}
  async refreshAccount(): Promise<void> {}
  async dispose(): Promise<void> {}
  getStatus(): RemoteAccountStatus {
    return { auth: 'anonymous', connectivity: 'offline', lastError: null }
  }
  subscribe(
    _accountKey: RemoteConnectRequest['accountKey'],
    listener: (status: RemoteAccountStatus) => void,
  ): () => void {
    listener(this.getStatus())
    return () => undefined
  }
}

function durable(accountKey: typeof accountA, remoteId: string) {
  return account(
    accountKey,
    remoteAccountRef(service, jmapAccountIdFromString(remoteId)),
  )
}

describe('independent account-lifecycle verification regression', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('VERIFY-CONCURRENT-01 rejects B rather than sharing pending A semantics', async () => {
    const engine = createMemoryLocalEngine()
    await engine.syncPort.registerAccount(
      durable(accountA, 'opaque/verify-concurrent-a'),
    )
    await engine.syncPort.registerAccount(
      durable(accountB, 'opaque/verify-concurrent-b'),
    )
    const remote = new VerifierDeferredRemoteApplication()
    const controller = createMailApplicationController(
      createApplicationContext({ ...engine, remoteApplication: remote }),
      useMailStore(),
      useRuntimeStore(),
    )
    await controller.initialize()

    const reconnectA = controller.reconnectAccount(accountA, request)
    await vi.waitFor(() => expect(remote.connect).toHaveBeenCalledOnce())
    const reconnectB = controller.reconnectAccount(accountB, request)

    await expect(reconnectB).resolves.toEqual({
      ok: false,
      error: {
        kind: 'connectionInProgress',
        message: 'Ya hay una conexión en curso.',
      },
    })
    expect(remote.connect).toHaveBeenCalledWith(
      expect.objectContaining({ accountKey: accountA }),
    )
    expect(remote.connect).toHaveBeenCalledOnce()

    remote.resolveConnect.get(accountA)?.()
    await expect(reconnectA).resolves.toEqual({
      ok: true,
      accountKey: accountA,
    })
    controller.dispose()
  })
})
