import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { emailBody } from '../../domain/email-body'
import type { E2eePort } from '../../e2ee/port'
import type {
  RemoteBodyFetch,
  RemoteBodySource,
} from '../../remote/body-source'
import type { RemoteSession } from '../../remote/session'
import { FakeRemoteMail, FakeSubmission } from '../../remote/testing'
import { remoteAccountIdFromString } from '../../remote/types'
import { DefaultBodyMaterializer } from '../../sync/body-materializer'
import { BodyMaterializationError } from '../../sync/body-materialization-errors'
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
import { useMailStore } from '../stores/mail'
import { useRuntimeStore } from '../stores/runtime'
import { JmapWorkerClient } from '../worker-client'
import { createSeededMemoryApplication } from './application-fixture'

const localStatus: RemoteAccountStatus = {
  auth: 'anonymous',
  connectivity: 'offline',
  lastError: null,
}

class DeferredRemoteApplication implements RemoteApplication {
  readonly refreshAccount = vi.fn(async () => undefined)
  async connect(request: RemoteConnectRequest): Promise<RemoteConnectResult> {
    return { accountKey: request.accountKey }
  }
  async disconnect(): Promise<void> {}
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
  async dispose(): Promise<void> {}
}

function inactiveE2eePort(): E2eePort {
  return {
    ensureLocalIdentity: vi.fn(),
    trustPeerPublicKey: vi.fn(),
    peerKeyStatus: vi.fn(),
    encryptFor: vi.fn(),
    decryptFrom: vi.fn(),
  } as unknown as E2eePort
}

describe('A2-05/A2-06 remote read path', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('REFRESH-06/10/12/14 calls C once for A and rejects B without changing local readiness', async () => {
    const { engine, fixtures } = await createSeededMemoryApplication()
    const remote = new DeferredRemoteApplication()
    const workerClient = Object.create(
      JmapWorkerClient.prototype,
    ) as JmapWorkerClient
    const syncAccount = vi.spyOn(workerClient, 'syncAccount')
    let release!: () => void
    remote.refreshAccount.mockImplementation(
      () =>
        new Promise<undefined>((resolve) => {
          release = () => resolve(undefined)
        }),
    )
    const controller = createMailApplicationController(
      createApplicationContext({
        ...engine,
        remoteApplication: remote,
        workerClient,
      }),
      useMailStore(),
      useRuntimeStore(),
    )
    await controller.initialize()

    const refreshA = controller.refreshAccount(fixtures.accountA.key)
    const refreshAAgain = controller.refreshAccount(fixtures.accountA.key)
    expect(refreshAAgain).toBe(refreshA)
    await vi.waitFor(() => expect(remote.refreshAccount).toHaveBeenCalledOnce())

    const accountB = 'refresh-other-account' as typeof fixtures.accountA.key
    await expect(controller.refreshAccount(accountB)).resolves.toEqual({
      ok: false,
      error: {
        kind: 'connectionInProgress',
        message: 'Ya hay una sincronización en curso.',
      },
    })
    expect(remote.refreshAccount).toHaveBeenCalledWith(fixtures.accountA.key)
    expect(remote.refreshAccount).toHaveBeenCalledOnce()
    expect(syncAccount).not.toHaveBeenCalled()
    expect(useRuntimeStore().local).toBe('ready')
    expect(useMailStore().emails).toHaveLength(2)

    release()
    await expect(refreshA).resolves.toEqual({ ok: true })
    controller.dispose()
  })

  it('REFRESH-10 maps remote failure without clearing cached mail or changing local state', async () => {
    const { engine, fixtures } = await createSeededMemoryApplication()
    const remote = new DeferredRemoteApplication()
    remote.refreshAccount.mockRejectedValue(
      new RemoteApplicationError('network'),
    )
    const controller = createMailApplicationController(
      createApplicationContext({ ...engine, remoteApplication: remote }),
      useMailStore(),
      useRuntimeStore(),
    )
    await controller.initialize()

    await expect(
      controller.refreshAccount(fixtures.accountA.key),
    ).resolves.toEqual({
      ok: false,
      error: {
        kind: 'network',
        message: 'No se pudo contactar al servidor.',
      },
    })
    expect(useRuntimeStore().local).toBe('ready')
    expect(useMailStore().emails).toHaveLength(2)
    controller.dispose()
  })

  it('REFRESH-08 uses real DefaultRemoteApplication and Coordinator writes before local rereads', async () => {
    const { engine, fixtures } = await createSeededMemoryApplication()
    const remoteAccountId = remoteAccountIdFromString(
      String(fixtures.accountA.remoteRef.jmapAccountId),
    )
    const session: RemoteSession = {
      accounts: [{ id: remoteAccountId, capabilities: [] }],
      mail: new FakeRemoteMail(),
      submission: new FakeSubmission(async () => ({
        kind: 'accepted',
        remoteEmailId: null,
        receiptId: null,
      })),
      close: async () => undefined,
    }
    const remoteApplication = new DefaultRemoteApplication({
      readRepository: engine.readRepository,
      syncPort: engine.syncPort,
      connectionFactory: () => ({ open: async () => session }),
    })
    const apply = vi.spyOn(engine.syncPort, 'applyCollectionSync')
    const controller = createMailApplicationController(
      createApplicationContext({ ...engine, remoteApplication }),
      useMailStore(),
      useRuntimeStore(),
    )
    await controller.initialize()
    await remoteApplication.connect({
      accountKey: fixtures.accountA.key,
      serviceKey: fixtures.accountA.remoteRef.serviceKey,
      config: {
        provider: 'imapSmtp',
        host: '127.0.0.1',
        username: 'refresh@boxplot.test',
        password: 'memory-only',
        imapPort: 1143,
        smtpPort: 1587,
      },
    })

    await expect(
      controller.refreshAccount(fixtures.accountA.key),
    ).resolves.toEqual({
      ok: true,
    })
    expect(apply).toHaveBeenCalledTimes(3)
    expect(await engine.readRepository.listAccounts()).toMatchObject({
      ok: true,
      value: [fixtures.accountA],
    })
    controller.dispose()
  })

  it('BODY-02/03 materializes a selected uncached body through real C then rereads local state', async () => {
    const { engine, fixtures } = await createSeededMemoryApplication()
    const source: RemoteBodySource = {
      fetchBody: vi.fn(async () => ({
        body: {
          kind: 'plain' as const,
          text: 'body from frozen materializer',
          html: '<p>body from frozen materializer</p>',
        },
        assertCurrent: () => undefined,
      })),
    }
    const bodyMaterializer = new DefaultBodyMaterializer({
      readRepository: engine.readRepository,
      syncPort: engine.syncPort,
      remoteBodySource: source,
      e2eePort: inactiveE2eePort(),
    })
    const controller = createMailApplicationController(
      createApplicationContext({
        ...engine,
        remoteApplication: new DeferredRemoteApplication(),
        bodyMaterializer,
      }),
      useMailStore(),
      useRuntimeStore(),
    )
    await controller.initialize()

    await controller.selectEmail(fixtures.emailA2.id)
    await vi.waitFor(() => {
      expect(useMailStore().bodyLoadState).toBe('cached')
    })

    expect(source.fetchBody).toHaveBeenCalledWith(
      fixtures.emailA2.id.accountKey,
      fixtures.emailA2.id.jmapId,
    )
    expect(useMailStore().emailBody).toEqual(
      emailBody({
        emailId: fixtures.emailA2.id,
        text: 'body from frozen materializer',
        html: '<p>body from frozen materializer</p>',
      }),
    )
    expect(
      await engine.readRepository.readEmailBody(fixtures.emailA2.id),
    ).toMatchObject({ value: { kind: 'cached' } })
    controller.dispose()
  })

  it('BODY-10 keeps B selected while pending A materialization completes', async () => {
    const { engine, fixtures } = await createSeededMemoryApplication()
    let release!: () => void
    const source: RemoteBodySource = {
      fetchBody: vi.fn(
        () =>
          new Promise<RemoteBodyFetch>((resolve) => {
            release = () =>
              resolve({
                body: { kind: 'plain', text: 'A body', html: null },
                assertCurrent: () => undefined,
              })
          }),
      ),
    }
    const bodyMaterializer = new DefaultBodyMaterializer({
      readRepository: engine.readRepository,
      syncPort: engine.syncPort,
      remoteBodySource: source,
      e2eePort: inactiveE2eePort(),
    })
    const controller = createMailApplicationController(
      createApplicationContext({ ...engine, bodyMaterializer }),
      useMailStore(),
      useRuntimeStore(),
    )
    await controller.initialize()
    await controller.selectEmail(fixtures.emailA2.id)
    await vi.waitFor(() => expect(source.fetchBody).toHaveBeenCalledOnce())

    await controller.selectEmail(fixtures.emailA1.id)
    release()
    await vi.waitFor(() =>
      expect(useMailStore().selectedEmailId).toEqual(fixtures.emailA1.id),
    )
    expect(useMailStore().emailBody).toEqual(fixtures.standardBodyA1)
    controller.dispose()
  })

  it('BODY-05/06 preserves metadata and local readiness when materialization cannot connect', async () => {
    const { engine, fixtures } = await createSeededMemoryApplication()
    const materialize = vi.fn(async () =>
      Promise.reject(new BodyMaterializationError('notConnected')),
    )
    const controller = createMailApplicationController(
      createApplicationContext({
        ...engine,
        bodyMaterializer: { materialize },
      }),
      useMailStore(),
      useRuntimeStore(),
    )
    await controller.initialize()
    await controller.selectEmail(fixtures.emailA2.id)

    await vi.waitFor(() => {
      expect(useMailStore().bodyError).toBe(
        'Conecta la cuenta para cargar este contenido.',
      )
    })
    expect(useRuntimeStore().local).toBe('ready')
    expect(useMailStore().selectedEmail).toEqual(fixtures.emailA2)
    expect(useMailStore().bodyLoadState).toBe('notCached')
    expect(materialize).toHaveBeenCalledWith(fixtures.emailA2.id)
    controller.dispose()
  })
})
