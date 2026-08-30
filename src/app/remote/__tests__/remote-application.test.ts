import { describe, expect, it, vi } from 'vitest'

import { account, remoteAccountRef } from '../../../domain/account'
import {
  accountKeyFromString,
  jmapAccountIdFromString,
  serviceKeyFromString,
} from '../../../domain/ids'
import { createMemoryLocalEngine } from '../../../adapters/memory'
import type { ReadRepository } from '../../../ports/read-repository'
import type { SyncPort } from '../../../ports/sync-port'
import type { RemoteConnection } from '../../../remote/connection'
import { RemoteError } from '../../../remote/errors'
import type { RemoteMail } from '../../../remote/mail'
import type { RemoteSession } from '../../../remote/session'
import type { RemoteConnectionConfig } from '../../../remote/runtime'
import { FakeRemoteMail, FakeSubmission } from '../../../remote/testing'
import {
  remoteAccountIdFromString,
  remoteSyncStateFromString,
  type RemoteAccountId,
} from '../../../remote/types'
import {
  localAccountId,
  remoteAccountId,
} from '../../../remote/compat/domain-ids'
import { createApplicationContext } from '../../application'
import { RemoteApplicationError } from '../errors'
import { DefaultRemoteApplication } from '../remote-application'
import { createTauriRemoteApplication } from '../tauri-remote-composition'
import type { RemoteConnectRequest } from '../types'
import type { NativeMailIpcPort } from '../../../remote/native/ipc'

const accountKeyA = accountKeyFromString('remote-application-a')
const accountKeyB = accountKeyFromString('remote-application-b')
const serviceKeyA = serviceKeyFromString('service-a')
const serviceKeyB = serviceKeyFromString('service-b')
const remoteIdA = remoteAccountIdFromString('opaque/remote:A')
const remoteIdB = remoteAccountIdFromString('opaque/remote:B')

const nativeConfig: Extract<RemoteConnectionConfig, { provider: 'imapSmtp' }> =
  {
    provider: 'imapSmtp',
    host: 'localhost',
    username: 'alice',
    password: 'secret',
    imapPort: 1143,
    smtpPort: 1025,
  }

const requestA: RemoteConnectRequest = {
  accountKey: accountKeyA,
  serviceKey: serviceKeyA,
  config: nativeConfig,
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function remoteError(
  kind: RemoteError['kind'],
  session: RemoteError['session'] = 'keep',
): RemoteError {
  return new RemoteError('sanitized remote failure', {
    kind,
    retry: 'never',
    session,
    outcome: 'notApplicable',
  })
}

function makeSession(
  options: {
    accounts?: readonly RemoteAccountId[]
    mail?: RemoteMail
    close?: () => Promise<void>
  } = {},
): RemoteSession {
  return {
    accounts: (options.accounts ?? [remoteIdA]).map((id) => ({
      id,
      capabilities: [],
    })),
    mail: options.mail ?? new FakeRemoteMail(),
    submission: new FakeSubmission(async () => ({
      kind: 'accepted',
      remoteEmailId: null,
      receiptId: null,
    })),
    close: options.close ?? vi.fn(async () => undefined),
  }
}

function makeApplication(
  options: {
    readRepository?: ReadRepository
    syncPort?: SyncPort
    connectionFactory?: (
      config: RemoteConnectRequest['config'],
    ) => RemoteConnection
    session?: RemoteSession
  } = {},
) {
  const engine = createMemoryLocalEngine()
  const session = options.session ?? makeSession()
  const open = vi.fn(async () => session)
  const connectionFactory = options.connectionFactory ?? vi.fn(() => ({ open }))
  const application = new DefaultRemoteApplication({
    readRepository: options.readRepository ?? engine.readRepository,
    syncPort: options.syncPort ?? engine.syncPort,
    connectionFactory,
  })
  return { application, engine, session, open, connectionFactory }
}

async function expectApplicationError(
  operation: Promise<unknown>,
  kind: RemoteApplicationError['kind'],
): Promise<void> {
  await expect(operation).rejects.toMatchObject({
    name: 'RemoteApplicationError',
    kind,
  })
}

describe('RemoteApplication account binding and lifecycle', () => {
  it('RA01 registers and activates one exact remote account without syncing', async () => {
    const { application, engine, session } = makeApplication()
    const syncIdentities = vi.spyOn(session.mail, 'syncIdentities')

    await expect(application.connect(requestA)).resolves.toEqual({
      accountKey: accountKeyA,
    })

    const local = await engine.readRepository.readAccount(accountKeyA)
    expect(local).toEqual({
      ok: true,
      value: {
        kind: 'present',
        value: account(
          accountKeyA,
          remoteAccountRef(serviceKeyA, localAccountId(remoteIdA)),
        ),
      },
    })
    expect(syncIdentities).not.toHaveBeenCalled()
    expect(application.getStatus(accountKeyA)).toEqual({
      auth: 'authenticated',
      connectivity: 'online',
      lastError: null,
    })
  })

  it('RA02 accepts an existing exact ServiceKey and RemoteAccountId binding', async () => {
    const { application, engine } = makeApplication()
    await engine.syncPort.registerAccount(
      account(
        accountKeyA,
        remoteAccountRef(serviceKeyA, localAccountId(remoteIdA)),
      ),
    )
    const register = vi.spyOn(engine.syncPort, 'registerAccount')

    await expect(application.connect(requestA)).resolves.toEqual({
      accountKey: accountKeyA,
    })
    expect(register).not.toHaveBeenCalled()
  })

  it('RA03 rejects a ServiceKey mismatch without rebinding', async () => {
    const session = makeSession()
    const close = vi.spyOn(session, 'close')
    const { application, engine } = makeApplication({ session })
    const original = account(
      accountKeyA,
      remoteAccountRef(serviceKeyB, localAccountId(remoteIdA)),
    )
    await engine.syncPort.registerAccount(original)

    await expectApplicationError(
      application.connect(requestA),
      'accountMismatch',
    )
    expect(close).toHaveBeenCalledOnce()
    expect(await engine.readRepository.readAccount(accountKeyA)).toEqual({
      ok: true,
      value: { kind: 'present', value: original },
    })
  })

  it('RA04 rejects a remote account mismatch and preserves the local binding', async () => {
    const session = makeSession({ accounts: [remoteIdB] })
    const { application, engine } = makeApplication({ session })
    const original = account(
      accountKeyA,
      remoteAccountRef(serviceKeyA, localAccountId(remoteIdA)),
    )
    await engine.syncPort.registerAccount(original)

    await expectApplicationError(
      application.connect(requestA),
      'accountMismatch',
    )
    expect(await engine.readRepository.readAccount(accountKeyA)).toEqual({
      ok: true,
      value: { kind: 'present', value: original },
    })
  })

  it.each([
    { label: 'zero', accounts: [] },
    { label: 'multiple', accounts: [remoteIdA, remoteIdB] },
  ])(
    'RA05 requires explicit selection for a new account with $label descriptors',
    async ({ accounts }) => {
      const session = makeSession({ accounts })
      const close = vi.spyOn(session, 'close')
      const { application, engine } = makeApplication({ session })

      await expectApplicationError(
        application.connect(requestA),
        'accountSelectionRequired',
      )
      expect(close).toHaveBeenCalledOnce()
      expect(await engine.readRepository.readAccount(accountKeyA)).toEqual({
        ok: true,
        value: { kind: 'absent' },
      })
    },
  )

  it('RA06 accepts a concurrent idempotent registration after conflict', async () => {
    const engine = createMemoryLocalEngine()
    const registerAccount = vi.fn(async (value) => {
      await engine.syncPort.registerAccount(value)
      return { ok: false as const, error: { kind: 'conflict' as const } }
    })
    const { application } = makeApplication({
      readRepository: engine.readRepository,
      syncPort: { ...engine.syncPort, registerAccount },
    })

    await expect(application.connect(requestA)).resolves.toEqual({
      accountKey: accountKeyA,
    })
    expect(registerAccount).toHaveBeenCalledOnce()
  })

  it('RA07 preserves opaque account IDs through the compatibility boundary', () => {
    const opaque = remoteAccountIdFromString('opaque:/Case Sensitive?x=1')
    expect(remoteAccountId(localAccountId(opaque))).toBe(opaque)
  })

  it('RA08 maps open authentication failure without creating a session', async () => {
    const { application } = makeApplication({
      connectionFactory: () => ({
        open: async () => Promise.reject(remoteError('auth')),
      }),
    })
    await expectApplicationError(application.connect(requestA), 'auth')
    expect(application.getStatus(accountKeyA)).toEqual({
      auth: 'anonymous',
      connectivity: 'online',
      lastError: 'auth',
    })
  })

  it.each(['network', 'unavailable'] as const)(
    'RA09 maps %s open failure to offline network status',
    async (kind) => {
      const { application } = makeApplication({
        connectionFactory: () => ({
          open: async () => Promise.reject(remoteError(kind)),
        }),
      })
      await expectApplicationError(application.connect(requestA), 'network')
      expect(application.getStatus(accountKeyA)).toEqual({
        auth: 'anonymous',
        connectivity: 'offline',
        lastError: 'network',
      })
    },
  )

  it.each(['protocol', 'unsupported'] as const)(
    'RA10 maps pre-session %s failure to remote/offline',
    async (kind) => {
      const { application } = makeApplication({
        connectionFactory: () => ({
          open: async () => Promise.reject(remoteError(kind)),
        }),
      })
      await expectApplicationError(application.connect(requestA), 'remote')
      expect(application.getStatus(accountKeyA)).toEqual({
        auth: 'anonymous',
        connectivity: 'offline',
        lastError: 'remote',
      })
    },
  )

  it('keeps a binding error primary when session cleanup also fails', async () => {
    const session = makeSession({
      accounts: [],
      close: async () => Promise.reject(remoteError('network')),
    })
    const { application } = makeApplication({ session })

    await expectApplicationError(
      application.connect(requestA),
      'accountSelectionRequired',
    )
    expect(application.getStatus(accountKeyA).lastError).toBe(
      'accountSelectionRequired',
    )
  })

  it('maps local read failure after open to local/online and closes', async () => {
    const engine = createMemoryLocalEngine()
    vi.spyOn(engine.readRepository, 'readAccount').mockResolvedValue({
      ok: false,
      error: { kind: 'corruptState' },
    })
    const session = makeSession()
    const close = vi.spyOn(session, 'close')
    const { application } = makeApplication({
      session,
      readRepository: engine.readRepository,
      syncPort: engine.syncPort,
    })

    await expectApplicationError(application.connect(requestA), 'local')
    expect(close).toHaveBeenCalledOnce()
    expect(application.getStatus(accountKeyA)).toEqual({
      auth: 'anonymous',
      connectivity: 'online',
      lastError: 'local',
    })
  })
})

describe('RemoteApplication refresh and error disposition', () => {
  it('RA11 refreshes through the real Coordinator and Memory SyncPort', async () => {
    const { application, engine, session } = makeApplication()
    const identities = vi.spyOn(session.mail, 'syncIdentities')
    const mailboxes = vi.spyOn(session.mail, 'syncMailboxes')
    const emails = vi.spyOn(session.mail, 'syncEmails')
    await application.connect(requestA)
    const apply = vi.spyOn(engine.syncPort, 'applyCollectionSync')

    await application.refreshAccount(accountKeyA)

    expect(identities).toHaveBeenCalledWith(remoteIdA, null)
    expect(mailboxes).toHaveBeenCalledWith(remoteIdA, null)
    expect(emails).toHaveBeenCalledWith(remoteIdA, null)
    expect(apply).toHaveBeenCalledTimes(3)
  })

  it('RA12 retains a session for network/session-keep failures', async () => {
    let fail = true
    const mail = new FakeRemoteMail({
      syncIdentities: async () => {
        if (fail) throw remoteError('network', 'keep')
        return {
          mode: 'replace',
          state: remoteSyncStateFromString('identity-ok'),
          snapshot: [],
        }
      },
    })
    const { application } = makeApplication({ session: makeSession({ mail }) })
    await application.connect(requestA)
    await expectApplicationError(
      application.refreshAccount(accountKeyA),
      'network',
    )
    expect(application.getStatus(accountKeyA)).toEqual({
      auth: 'authenticated',
      connectivity: 'offline',
      lastError: 'network',
    })
    fail = false
    await expect(
      application.refreshAccount(accountKeyA),
    ).resolves.toBeUndefined()
  })

  it.each([
    ['auth', 'online', 'auth'],
    ['network', 'offline', 'network'],
    ['protocol', 'online', 'remote'],
  ] as const)(
    'RA13 expires before cleanup for %s/session-expire',
    async (remoteKind, connectivity, applicationKind) => {
      const mail = new FakeRemoteMail({
        syncIdentities: async () =>
          Promise.reject(remoteError(remoteKind, 'expire')),
      })
      const session = makeSession({ mail })
      const close = vi.spyOn(session, 'close')
      const { application } = makeApplication({ session })
      await application.connect(requestA)

      await expectApplicationError(
        application.refreshAccount(accountKeyA),
        applicationKind,
      )
      expect(application.getStatus(accountKeyA)).toEqual({
        auth: 'expired',
        connectivity,
        lastError: applicationKind,
      })
      expect(close).toHaveBeenCalledOnce()
      await expectApplicationError(
        application.refreshAccount(accountKeyA),
        'notConnected',
      )
    },
  )

  it.each([
    ['auth', 'auth'],
    ['protocol', 'remote'],
  ] as const)(
    'RA14 honors session-keep for %s',
    async (remoteKind, applicationKind) => {
      const mail = new FakeRemoteMail({
        syncIdentities: async () =>
          Promise.reject(remoteError(remoteKind, 'keep')),
      })
      const { application } = makeApplication({
        session: makeSession({ mail }),
      })
      await application.connect(requestA)
      await expectApplicationError(
        application.refreshAccount(accountKeyA),
        applicationKind,
      )
      expect(application.getStatus(accountKeyA)).toEqual({
        auth: 'authenticated',
        connectivity: 'online',
        lastError: applicationKind,
      })
    },
  )

  it('RA15 classifies ordinary Coordinator failures as local without logout', async () => {
    const { application, engine } = makeApplication()
    vi.spyOn(engine.syncPort, 'applyCollectionSync').mockResolvedValue({
      ok: false,
      error: { kind: 'unexpected' },
    })
    await application.connect(requestA)

    await expectApplicationError(
      application.refreshAccount(accountKeyA),
      'local',
    )
    expect(application.getStatus(accountKeyA)).toEqual({
      auth: 'authenticated',
      connectivity: 'online',
      lastError: 'local',
    })
  })
})

describe('RemoteApplication concurrency, subscriptions, and disposal', () => {
  it('RA16 removes the active session before disconnect close and is idempotent', async () => {
    const closeGate = deferred<void>()
    const session = makeSession({ close: () => closeGate.promise })
    const { application } = makeApplication({ session })
    await application.connect(requestA)
    const disconnecting = application.disconnect(accountKeyA)

    expect(application.getStatus(accountKeyA)).toEqual({
      auth: 'anonymous',
      connectivity: 'offline',
      lastError: null,
    })
    await expectApplicationError(
      application.refreshAccount(accountKeyA),
      'notConnected',
    )
    await expect(application.disconnect(accountKeyA)).resolves.toBeUndefined()
    closeGate.resolve()
    await disconnecting
  })

  it('RA17 does not resurrect a session when close fails', async () => {
    const session = makeSession({
      close: async () => Promise.reject(new Error('close failed')),
    })
    const { application } = makeApplication({ session })
    await application.connect(requestA)

    await expectApplicationError(application.disconnect(accountKeyA), 'remote')
    expect(application.getStatus(accountKeyA)).toEqual({
      auth: 'anonymous',
      connectivity: 'offline',
      lastError: null,
    })
    await expectApplicationError(
      application.refreshAccount(accountKeyA),
      'notConnected',
    )
  })

  it('RA18 rejects concurrent and already-active connects as busy', async () => {
    const opened = deferred<RemoteSession>()
    const { application, session } = makeApplication({
      connectionFactory: () => ({ open: () => opened.promise }),
    })
    const first = application.connect(requestA)
    await expectApplicationError(application.connect(requestA), 'busy')
    opened.resolve(session)
    await first
    await expectApplicationError(application.connect(requestA), 'busy')
  })

  it('RA19 allows different accounts to connect independently', async () => {
    const sessions = new Map([
      ['alice', makeSession({ accounts: [remoteIdA] })],
      ['bob', makeSession({ accounts: [remoteIdB] })],
    ])
    const { application } = makeApplication({
      connectionFactory: (config) => ({
        open: async () => {
          const selected = sessions.get(
            config.provider === 'imapSmtp' ? config.username : '',
          )
          if (selected === undefined) throw new Error('missing test session')
          return selected
        },
      }),
    })
    const requestB: RemoteConnectRequest = {
      ...requestA,
      accountKey: accountKeyB,
      serviceKey: serviceKeyB,
      config: { ...nativeConfig, username: 'bob' },
    }

    await Promise.all([
      application.connect(requestA),
      application.connect(requestB),
    ])
    expect(application.getStatus(accountKeyA).auth).toBe('authenticated')
    expect(application.getStatus(accountKeyB).auth).toBe('authenticated')
  })

  it('RA20 closes a session resolving after disconnect and never registers it', async () => {
    const opened = deferred<RemoteSession>()
    const session = makeSession()
    const close = vi.spyOn(session, 'close')
    const { application, engine } = makeApplication({
      connectionFactory: () => ({ open: () => opened.promise }),
    })
    const register = vi.spyOn(engine.syncPort, 'registerAccount')
    const connecting = application.connect(requestA)
    await application.disconnect(accountKeyA)
    opened.resolve(session)

    await expectApplicationError(connecting, 'cancelled')
    expect(close).toHaveBeenCalledOnce()
    expect(register).not.toHaveBeenCalled()
    expect(application.getStatus(accountKeyA).auth).toBe('anonymous')
  })

  it('maps a stale open rejection to cancelled without overwriting disconnect', async () => {
    const opened = deferred<RemoteSession>()
    const { application } = makeApplication({
      connectionFactory: () => ({ open: () => opened.promise }),
    })
    const connecting = application.connect(requestA)
    await application.disconnect(accountKeyA)
    opened.reject(remoteError('auth'))

    await expectApplicationError(connecting, 'cancelled')
    expect(application.getStatus(accountKeyA)).toEqual({
      auth: 'anonymous',
      connectivity: 'offline',
      lastError: null,
    })
  })

  it('RA21 allows an in-flight registration commit but blocks stale activation', async () => {
    const engine = createMemoryLocalEngine()
    const writeGate =
      deferred<Awaited<ReturnType<SyncPort['registerAccount']>>>()
    const registerAccount = vi.fn(async (value) => {
      await engine.syncPort.registerAccount(value)
      return writeGate.promise
    })
    const session = makeSession()
    const close = vi.spyOn(session, 'close')
    const { application } = makeApplication({
      session,
      readRepository: engine.readRepository,
      syncPort: { ...engine.syncPort, registerAccount },
    })
    const connecting = application.connect(requestA)
    await vi.waitFor(() => expect(registerAccount).toHaveBeenCalledOnce())
    await application.disconnect(accountKeyA)
    writeGate.resolve({ ok: true, value: undefined })

    await expectApplicationError(connecting, 'cancelled')
    expect(close).toHaveBeenCalledOnce()
    expect(application.getStatus(accountKeyA).auth).toBe('anonymous')
    expect(await engine.readRepository.readAccount(accountKeyA)).toMatchObject({
      ok: true,
      value: { kind: 'present' },
    })
  })

  it('RA22 ignores late refresh completion after disconnect', async () => {
    const refreshGate =
      deferred<
        ReturnType<RemoteMail['syncIdentities']> extends Promise<infer T>
          ? T
          : never
      >()
    const mail = new FakeRemoteMail({
      syncIdentities: () => refreshGate.promise,
    })
    const { application } = makeApplication({ session: makeSession({ mail }) })
    await application.connect(requestA)
    const refreshing = application.refreshAccount(accountKeyA)
    await application.disconnect(accountKeyA)
    refreshGate.resolve({
      mode: 'replace',
      state: remoteSyncStateFromString('late'),
      snapshot: [],
    })

    await expectApplicationError(refreshing, 'cancelled')
    expect(application.getStatus(accountKeyA)).toEqual({
      auth: 'anonymous',
      connectivity: 'offline',
      lastError: null,
    })
  })

  it('RA23 scopes subscriptions, emits immediately, deduplicates, and unsubscribes', async () => {
    const { application } = makeApplication()
    const statusesA = vi.fn()
    const statusesB = vi.fn()
    const unsubscribeA = application.subscribe(accountKeyA, statusesA)
    application.subscribe(accountKeyB, statusesB)

    expect(statusesA).toHaveBeenCalledWith({
      auth: 'anonymous',
      connectivity: 'offline',
      lastError: null,
    })
    await application.disconnect(accountKeyA)
    expect(statusesA).toHaveBeenCalledTimes(1)
    await application.connect(requestA)
    expect(statusesA).toHaveBeenCalledTimes(3)
    expect(statusesB).toHaveBeenCalledTimes(1)
    unsubscribeA()
    unsubscribeA()
    await application.disconnect(accountKeyA)
    expect(statusesA).toHaveBeenCalledTimes(3)
  })

  it('RA24 returns status snapshots that cannot mutate internal state', () => {
    const { application } = makeApplication()
    const status = application.getStatus(accountKeyA)
    Reflect.set(status, 'auth', 'authenticated')
    expect(application.getStatus(accountKeyA).auth).toBe('anonymous')
  })

  it('RA25 disposes all sessions best-effort and rejects lifecycle APIs afterwards', async () => {
    const firstClose = vi.fn(async () => Promise.reject(new Error('one')))
    const secondClose = vi.fn(async () => undefined)
    const sessions = [
      makeSession({ accounts: [remoteIdA], close: firstClose }),
      makeSession({ accounts: [remoteIdB], close: secondClose }),
    ]
    const { application } = makeApplication({
      connectionFactory: () => ({
        open: async () => {
          const selected = sessions.shift()
          if (selected === undefined) throw new Error('missing test session')
          return selected
        },
      }),
    })
    await application.connect(requestA)
    await application.connect({
      ...requestA,
      accountKey: accountKeyB,
      serviceKey: serviceKeyB,
    })

    await application.dispose()
    expect(firstClose).toHaveBeenCalledOnce()
    expect(secondClose).toHaveBeenCalledOnce()
    await expectApplicationError(application.connect(requestA), 'disposed')
    await expectApplicationError(
      application.disconnect(accountKeyA),
      'disposed',
    )
    await expectApplicationError(
      application.refreshAccount(accountKeyA),
      'disposed',
    )
    expect(() => application.subscribe(accountKeyA, vi.fn())).toThrowError(
      expect.objectContaining({ kind: 'disposed' }),
    )
    expect(application.getStatus(accountKeyA).auth).toBe('anonymous')
  })
})

describe('RemoteApplication security and productive composition', () => {
  it('RA26 does not retain or expose credential-bearing connect configuration', async () => {
    const canary = 'BOXPL0T_REMOTE_APPLICATION_SECRET_CANARY_6721'
    const request: RemoteConnectRequest = {
      ...requestA,
      config: { ...nativeConfig, password: canary },
    }
    const { application } = makeApplication()
    const result = await application.connect(request)

    expect(JSON.stringify(result)).not.toContain(canary)
    expect(JSON.stringify(application)).not.toContain(canary)
    expect(JSON.stringify(application.getStatus(accountKeyA))).not.toContain(
      canary,
    )
  })

  it('RA27 starts native IPC only on connect and forwards exact credentials', async () => {
    const engine = createMemoryLocalEngine()
    const nativeMailIpc = nativeIpcStub()
    vi.mocked(nativeMailIpc.open).mockResolvedValue({
      sessionId: 'opaque-native-session',
      authenticatedUser: 'alice@example.test',
    })
    const application = createTauriRemoteApplication({
      ...engine,
      nativeMailIpc,
    })
    expect(nativeMailIpc.open).not.toHaveBeenCalled()

    await application.connect(requestA)

    expect(nativeMailIpc.open).toHaveBeenCalledWith({
      host: nativeConfig.host,
      username: nativeConfig.username,
      password: nativeConfig.password,
      imapPort: nativeConfig.imapPort,
      smtpPort: nativeConfig.smtpPort,
    })
  })

  it('RA28 fails typed unsupported for JMAP without Worker fallback', async () => {
    const engine = createMemoryLocalEngine()
    const application = createTauriRemoteApplication({
      ...engine,
      nativeMailIpc: nativeIpcStub(),
    })
    await expectApplicationError(
      application.connect({
        accountKey: accountKeyA,
        serviceKey: serviceKeyA,
        config: { provider: 'jmap', sessionUrl: 'https://example.test/jmap' },
      }),
      'remote',
    )
  })

  it('RA29 preserves WorkerClient and RemoteApplication additively in context', () => {
    const engine = createMemoryLocalEngine()
    const remoteApplication = makeApplication().application
    const workerClient = Object.create(null)
    const context = createApplicationContext({
      ...engine,
      workerClient,
      remoteApplication,
    })
    expect(context.workerClient).toBe(workerClient)
    expect(context.remoteApplication).toBe(remoteApplication)
  })

  it('RA30 maps conflicting concurrent registration to mismatch without rebind', async () => {
    const engine = createMemoryLocalEngine()
    const conflicting = account(
      accountKeyA,
      remoteAccountRef(serviceKeyB, jmapAccountIdFromString('other')),
    )
    const registerAccount = vi.fn(async () => {
      await engine.syncPort.registerAccount(conflicting)
      return { ok: false as const, error: { kind: 'conflict' as const } }
    })
    const { application } = makeApplication({
      readRepository: engine.readRepository,
      syncPort: { ...engine.syncPort, registerAccount },
    })

    await expectApplicationError(
      application.connect(requestA),
      'accountMismatch',
    )
    expect(await engine.readRepository.readAccount(accountKeyA)).toEqual({
      ok: true,
      value: { kind: 'present', value: conflicting },
    })
  })
})

function nativeIpcStub(): NativeMailIpcPort {
  return {
    open: vi.fn<NativeMailIpcPort['open']>(),
    close: vi.fn<NativeMailIpcPort['close']>(),
    listMailboxes: vi.fn<NativeMailIpcPort['listMailboxes']>(),
    snapshotMailbox: vi.fn<NativeMailIpcPort['snapshotMailbox']>(),
    fetchBody: vi.fn<NativeMailIpcPort['fetchBody']>(),
    fetchAttachments: vi.fn<NativeMailIpcPort['fetchAttachments']>(),
    storeFlags: vi.fn<NativeMailIpcPort['storeFlags']>(),
    move: vi.fn<NativeMailIpcPort['move']>(),
    smtpSubmit: vi.fn<NativeMailIpcPort['smtpSubmit']>(),
  }
}
