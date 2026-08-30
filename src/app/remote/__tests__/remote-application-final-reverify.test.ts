import { describe, expect, it } from 'vitest'

import { createMemoryLocalEngine } from '../../../adapters/memory'
import { accountKeyFromString, serviceKeyFromString } from '../../../domain/ids'
import {
  mailboxViewFilterAll,
  mailboxViewSort,
  mailboxViewSpec,
} from '../../../domain/mailbox-view'
import type { SyncPort } from '../../../ports/sync-port'
import { localEmailId, localMailboxId } from '../../../remote/compat/domain-ids'
import { RemoteError } from '../../../remote/errors'
import type { RemoteMail } from '../../../remote/mail'
import type { NativeMailIpcPort } from '../../../remote/native/ipc'
import type { RemoteSession } from '../../../remote/session'
import type { Submission } from '../../../remote/submission'
import {
  remoteAccountIdFromString,
  remoteBlobIdFromString,
  remoteEmailIdFromString,
  remoteIdentityIdFromString,
  remoteMailboxIdFromString,
  remoteSyncStateFromString,
  remoteThreadIdFromString,
} from '../../../remote/types'
import { DefaultRemoteApplication } from '../remote-application'
import { createTauriRemoteApplication } from '../tauri-remote-composition'
import type {
  RemoteAccountStatus,
  RemoteConnectRequest,
  RemoteConnectionFactory,
} from '../types'

const accountA = accountKeyFromString('final-reverify-account-a')
const accountB = accountKeyFromString('final-reverify-account-b')
const service = serviceKeyFromString('final-reverify-service')
const remoteA = remoteAccountIdFromString('final-reverify-remote-a')
const remoteB = remoteAccountIdFromString('final-reverify-remote-b')
const configA = {
  provider: 'jmap' as const,
  sessionUrl: 'https://final-reverify.invalid/a',
}
const configB = {
  provider: 'jmap' as const,
  sessionUrl: 'https://final-reverify.invalid/b',
}

type Gate<T> = Readonly<{
  promise: Promise<T>
  release(value: T): void
}>

function gate<T>(): Gate<T> {
  let release!: (value: T) => void
  const promise = new Promise<T>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

function inactiveMail(): RemoteMail {
  const unused = async (): Promise<never> => {
    throw new Error('unexpected remote mail call')
  }
  return {
    syncIdentities: unused,
    syncMailboxes: unused,
    syncEmails: unused,
    queryMailbox: unused,
    fetchBody: unused,
    fetchAttachments: unused,
    applyKeywordChange: unused,
    applyMembershipChange: unused,
  }
}

function emptySyncMail(
  syncIdentities: RemoteMail['syncIdentities'] = async () => ({
    mode: 'replace',
    state: remoteSyncStateFromString('identity-state'),
    snapshot: [],
  }),
): RemoteMail {
  return {
    syncIdentities,
    syncMailboxes: async () => ({
      mode: 'replace',
      state: remoteSyncStateFromString('mailbox-state'),
      snapshot: [],
    }),
    syncEmails: async () => ({
      mode: 'replace',
      state: remoteSyncStateFromString('email-state'),
      snapshot: [],
    }),
    queryMailbox: async () => ({
      ids: [],
      queryState: remoteSyncStateFromString('query-state'),
      total: 0,
      position: 0,
      canCalculateChanges: false,
    }),
    fetchBody: async () => {
      throw new Error('unexpected body fetch')
    },
    fetchAttachments: async () => {
      throw new Error('unexpected attachment fetch')
    },
    applyKeywordChange: async () => {
      throw new Error('unexpected keyword mutation')
    },
    applyMembershipChange: async () => {
      throw new Error('unexpected membership mutation')
    },
  }
}

function session(
  remoteId = remoteA,
  options: Readonly<{
    mail?: RemoteMail
    close?: () => Promise<void>
  }> = {},
): RemoteSession {
  return {
    accounts: [{ id: remoteId, capabilities: ['mail'] }],
    mail: options.mail ?? inactiveMail(),
    submission: {} as Submission,
    close: options.close ?? (async () => {}),
  }
}

function request(
  accountKey = accountA,
  selectedConfig = configA,
): RemoteConnectRequest {
  return { accountKey, serviceKey: service, config: selectedConfig }
}

function instrumentRegistration(
  delegate: SyncPort,
  onRegister: () => void,
): SyncPort {
  return new Proxy(delegate, {
    get(target, property, receiver) {
      if (property !== 'registerAccount') {
        const value = Reflect.get(target, property, receiver) as unknown
        return typeof value === 'function' ? value.bind(target) : value
      }
      return async (...args: Parameters<SyncPort['registerAccount']>) => {
        onRegister()
        return target.registerAccount(...args)
      }
    },
  })
}

function expectDisconnected(status: RemoteAccountStatus): void {
  expect(status).toEqual({
    auth: 'anonymous',
    connectivity: 'offline',
    lastError: null,
  })
}

describe('RemoteApplication final independent repair falsification', () => {
  it('revokes authority in an authenticating disconnect before factory, open, or registration', async () => {
    const local = createMemoryLocalEngine()
    const statuses: RemoteAccountStatus[] = []
    let factories = 0
    let opens = 0
    let registrations = 0
    let disconnecting: Promise<void> | undefined
    const application = new DefaultRemoteApplication({
      readRepository: local.readRepository,
      syncPort: instrumentRegistration(local.syncPort, () => registrations++),
      connectionFactory: () => {
        factories++
        return {
          open: async () => {
            opens++
            return session()
          },
        }
      },
    })
    application.subscribe(accountA, (status) => {
      statuses.push(status)
      if (status.auth === 'authenticating') {
        disconnecting = application.disconnect(accountA)
      }
    })

    const connecting = application.connect(request())
    await expect(connecting).rejects.toMatchObject({ kind: 'cancelled' })
    await expect(disconnecting).resolves.toBeUndefined()
    expect(statuses).toEqual([
      { auth: 'anonymous', connectivity: 'offline', lastError: null },
      { auth: 'authenticating', connectivity: 'offline', lastError: null },
      { auth: 'anonymous', connectivity: 'offline', lastError: null },
    ])
    expect({ factories, opens, registrations }).toEqual({
      factories: 0,
      opens: 0,
      registrations: 0,
    })
    expectDisconnected(application.getStatus(accountA))
  })

  it('revokes authority in an authenticating dispose and preserves disposed semantics', async () => {
    const local = createMemoryLocalEngine()
    let factories = 0
    let opens = 0
    let registrations = 0
    let disposing: Promise<void> | undefined
    const application = new DefaultRemoteApplication({
      readRepository: local.readRepository,
      syncPort: instrumentRegistration(local.syncPort, () => registrations++),
      connectionFactory: () => {
        factories++
        return {
          open: async () => {
            opens++
            return session()
          },
        }
      },
    })
    application.subscribe(accountA, (status) => {
      if (status.auth === 'authenticating') disposing = application.dispose()
    })

    await expect(application.connect(request())).rejects.toMatchObject({
      kind: 'cancelled',
    })
    await expect(disposing).resolves.toBeUndefined()
    expect({ factories, opens, registrations }).toEqual({
      factories: 0,
      opens: 0,
      registrations: 0,
    })
    await expect(application.connect(request())).rejects.toMatchObject({
      kind: 'disposed',
    })
    await expect(application.disconnect(accountA)).rejects.toMatchObject({
      kind: 'disposed',
    })
    await expect(application.refreshAccount(accountA)).rejects.toMatchObject({
      kind: 'disposed',
    })
    expect(() => application.subscribe(accountA, () => {})).toThrowError(
      expect.objectContaining({ kind: 'disposed' }),
    )
    await expect(application.dispose()).resolves.toBeUndefined()
  })

  it.each([
    ['disconnect', false],
    ['dispose', true],
  ] as const)(
    'blocks open when the factory itself performs %s',
    async (_action, shouldDispose) => {
      const local = createMemoryLocalEngine()
      let factories = 0
      let opens = 0
      const factory: RemoteConnectionFactory = () => {
        factories++
        if (shouldDispose) void application.dispose()
        else void application.disconnect(accountA)
        return {
          open: async () => {
            opens++
            return session()
          },
        }
      }
      const application = new DefaultRemoteApplication({
        readRepository: local.readRepository,
        syncPort: local.syncPort,
        connectionFactory: factory,
      })

      await expect(application.connect(request())).rejects.toMatchObject({
        kind: 'cancelled',
      })
      expect({ factories, opens }).toEqual({ factories: 1, opens: 0 })
      expectDisconnected(application.getStatus(accountA))
    },
  )

  it('cleans a cancelled pending generation and permits a fresh normal connection', async () => {
    const local = createMemoryLocalEngine()
    let cancelFirst = true
    let factories = 0
    let opens = 0
    let registrations = 0
    const application = new DefaultRemoteApplication({
      readRepository: local.readRepository,
      syncPort: instrumentRegistration(local.syncPort, () => registrations++),
      connectionFactory: () => {
        factories++
        return {
          open: async () => {
            opens++
            return session()
          },
        }
      },
    })
    const unsubscribe = application.subscribe(accountA, (status) => {
      if (cancelFirst && status.auth === 'authenticating') {
        cancelFirst = false
        void application.disconnect(accountA)
      }
    })

    await expect(application.connect(request())).rejects.toMatchObject({
      kind: 'cancelled',
    })
    unsubscribe()
    await expect(application.connect(request())).resolves.toEqual({
      accountKey: accountA,
    })
    expect({ factories, opens, registrations }).toEqual({
      factories: 1,
      opens: 1,
      registrations: 1,
    })
    expect(application.getStatus(accountA).auth).toBe('authenticated')
  })

  it('also cleans pending authority after a factory-time disconnect', async () => {
    const local = createMemoryLocalEngine()
    let factories = 0
    let opens = 0
    const factory: RemoteConnectionFactory = () => {
      factories++
      if (factories === 1) void application.disconnect(accountA)
      return {
        open: async () => {
          opens++
          return session()
        },
      }
    }
    const application = new DefaultRemoteApplication({
      readRepository: local.readRepository,
      syncPort: local.syncPort,
      connectionFactory: factory,
    })

    await expect(application.connect(request())).rejects.toMatchObject({
      kind: 'cancelled',
    })
    await expect(application.connect(request())).resolves.toEqual({
      accountKey: accountA,
    })
    expect({ factories, opens }).toEqual({ factories: 2, opens: 1 })
  })

  it('keeps already-started open cancellable and closes its late session exactly once', async () => {
    const local = createMemoryLocalEngine()
    const opened = gate<RemoteSession>()
    let closes = 0
    let registrations = 0
    const application = new DefaultRemoteApplication({
      readRepository: local.readRepository,
      syncPort: instrumentRegistration(local.syncPort, () => registrations++),
      connectionFactory: () => ({ open: () => opened.promise }),
    })

    const connecting = application.connect(request())
    await application.disconnect(accountA)
    opened.release(
      session(remoteA, {
        close: async () => {
          closes++
        },
      }),
    )

    await expect(connecting).rejects.toMatchObject({ kind: 'cancelled' })
    expect({ closes, registrations }).toEqual({ closes: 1, registrations: 0 })
    expectDisconnected(application.getStatus(accountA))
  })

  it('keeps already-started open cancellable across disposal', async () => {
    const local = createMemoryLocalEngine()
    const opened = gate<RemoteSession>()
    let closes = 0
    const application = new DefaultRemoteApplication({
      readRepository: local.readRepository,
      syncPort: local.syncPort,
      connectionFactory: () => ({ open: () => opened.promise }),
    })

    const connecting = application.connect(request())
    await application.dispose()
    opened.release(
      session(remoteA, {
        close: async () => {
          closes++
        },
      }),
    )

    await expect(connecting).rejects.toMatchObject({ kind: 'cancelled' })
    expect(closes).toBe(1)
    await expect(application.refreshAccount(accountA)).rejects.toMatchObject({
      kind: 'disposed',
    })
  })

  it('does not activate when disconnect wins while local registration is pending', async () => {
    const local = createMemoryLocalEngine()
    const allowRegistration = gate<void>()
    const registrationStarted = gate<void>()
    const originalRegister = local.syncPort.registerAccount.bind(local.syncPort)
    let closes = 0
    const syncPort = new Proxy(local.syncPort, {
      get(target, property, receiver) {
        if (property !== 'registerAccount') {
          const value = Reflect.get(target, property, receiver) as unknown
          return typeof value === 'function' ? value.bind(target) : value
        }
        return async (...args: Parameters<SyncPort['registerAccount']>) => {
          registrationStarted.release()
          await allowRegistration.promise
          return originalRegister(...args)
        }
      },
    })
    const application = new DefaultRemoteApplication({
      readRepository: local.readRepository,
      syncPort,
      connectionFactory: () => ({
        open: async () =>
          session(remoteA, {
            close: async () => {
              closes++
            },
          }),
      }),
    })

    const connecting = application.connect(request())
    await registrationStarted.promise
    await application.disconnect(accountA)
    allowRegistration.release()
    await expect(connecting).rejects.toMatchObject({ kind: 'cancelled' })
    expect(closes).toBe(1)
    expectDisconnected(application.getStatus(accountA))
    await expect(
      local.readRepository.readAccount(accountA),
    ).resolves.toMatchObject({ ok: true, value: { kind: 'present' } })
    await expect(application.refreshAccount(accountA)).rejects.toMatchObject({
      kind: 'notConnected',
    })
  })

  it('prevents a late refresh from resurrecting a disconnected account', async () => {
    const local = createMemoryLocalEngine()
    const identitySync =
      gate<Awaited<ReturnType<RemoteMail['syncIdentities']>>>()
    const mail = emptySyncMail(() => identitySync.promise)
    const application = new DefaultRemoteApplication({
      readRepository: local.readRepository,
      syncPort: local.syncPort,
      connectionFactory: () => ({
        open: async () => session(remoteA, { mail }),
      }),
    })
    await application.connect(request())

    const refreshing = application.refreshAccount(accountA)
    await application.disconnect(accountA)
    identitySync.release({
      mode: 'replace',
      state: remoteSyncStateFromString('late-identity-state'),
      snapshot: [],
    })

    await expect(refreshing).rejects.toMatchObject({ kind: 'cancelled' })
    expectDisconnected(application.getStatus(accountA))
    await expect(application.refreshAccount(accountA)).rejects.toMatchObject({
      kind: 'notConnected',
    })
  })

  it('prevents a concurrent refresh from resurrecting an expired session', async () => {
    const local = createMemoryLocalEngine()
    const firstSync = gate<Awaited<ReturnType<RemoteMail['syncIdentities']>>>()
    let calls = 0
    const mail = emptySyncMail(async () => {
      calls++
      if (calls === 1) return firstSync.promise
      throw new RemoteError('expired independently', {
        kind: 'auth',
        retry: 'never',
        session: 'expire',
        outcome: 'notApplicable',
      })
    })
    const application = new DefaultRemoteApplication({
      readRepository: local.readRepository,
      syncPort: local.syncPort,
      connectionFactory: () => ({
        open: async () => session(remoteA, { mail }),
      }),
    })
    await application.connect(request())

    const lateRefresh = application.refreshAccount(accountA)
    const expiringRefresh = application.refreshAccount(accountA)
    await expect(expiringRefresh).rejects.toMatchObject({ kind: 'auth' })
    firstSync.release({
      mode: 'replace',
      state: remoteSyncStateFromString('stale-identity-state'),
      snapshot: [],
    })
    await expect(lateRefresh).rejects.toMatchObject({ kind: 'cancelled' })
    expect(application.getStatus(accountA)).toEqual({
      auth: 'expired',
      connectivity: 'online',
      lastError: 'auth',
    })
    await expect(application.refreshAccount(accountA)).rejects.toMatchObject({
      kind: 'notConnected',
    })
  })

  it('isolates observer failures, collection mutation, and account A cancellation from B', async () => {
    const local = createMemoryLocalEngine()
    let cancelA = true
    let newListenerCalls = 0
    const application = new DefaultRemoteApplication({
      readRepository: local.readRepository,
      syncPort: local.syncPort,
      connectionFactory: (config) => ({
        open: async () =>
          session(config === configB ? remoteB : remoteA, {
            mail: emptySyncMail(),
          }),
      }),
    })
    await application.connect(request(accountB, configB))
    const statusB = application.getStatus(accountB)
    application.subscribe(accountA, (status) => {
      if (status.auth !== 'authenticating') return
      throw new Error('observer must be isolated')
    })
    let unsubscribe = (): void => {}
    unsubscribe = application.subscribe(accountA, (status) => {
      if (!cancelA || status.auth !== 'authenticating') return
      cancelA = false
      unsubscribe()
      application.subscribe(accountA, () => newListenerCalls++)
      void application.disconnect(accountA)
    })

    await expect(application.connect(request())).rejects.toMatchObject({
      kind: 'cancelled',
    })
    expect(newListenerCalls).toBeGreaterThan(0)
    expect(application.getStatus(accountB)).toEqual(statusB)
    await expect(application.refreshAccount(accountB)).resolves.toBeUndefined()
    expect(application.getStatus(accountB)).toEqual(statusB)
  })

  it('treats an authenticated-listener disconnect as a subsequent valid lifecycle action', async () => {
    const local = createMemoryLocalEngine()
    let closes = 0
    let disconnecting: Promise<void> | undefined
    const application = new DefaultRemoteApplication({
      readRepository: local.readRepository,
      syncPort: local.syncPort,
      connectionFactory: () => ({
        open: async () =>
          session(remoteA, {
            close: async () => {
              closes++
            },
          }),
      }),
    })
    application.subscribe(accountA, (status) => {
      if (status.auth === 'authenticated') {
        disconnecting = application.disconnect(accountA)
      }
    })

    await expect(application.connect(request())).resolves.toEqual({
      accountKey: accountA,
    })
    await expect(disconnecting).resolves.toBeUndefined()
    expect(closes).toBe(1)
    expectDisconnected(application.getStatus(accountA))
  })

  it('keeps and expires sessions according to all remote error classes', async () => {
    const cases = [
      ['network', 'keep', 'network', 'offline', 'authenticated'],
      ['auth', 'keep', 'auth', 'online', 'authenticated'],
      ['protocol', 'keep', 'remote', 'online', 'authenticated'],
      ['auth', 'expire', 'auth', 'online', 'expired'],
      ['network', 'expire', 'network', 'offline', 'expired'],
      ['protocol', 'expire', 'remote', 'online', 'expired'],
    ] as const

    for (const [
      remoteKind,
      disposition,
      resultKind,
      connectivity,
      auth,
    ] of cases) {
      const local = createMemoryLocalEngine()
      let closes = 0
      const mail = emptySyncMail(async () => {
        throw new RemoteError('classified without sensitive data', {
          kind: remoteKind,
          retry: 'never',
          session: disposition,
          outcome: 'notApplicable',
        })
      })
      const application = new DefaultRemoteApplication({
        readRepository: local.readRepository,
        syncPort: local.syncPort,
        connectionFactory: () => ({
          open: async () =>
            session(remoteA, {
              mail,
              close: async () => {
                closes++
              },
            }),
        }),
      })
      await application.connect(request())
      await expect(application.refreshAccount(accountA)).rejects.toMatchObject({
        kind: resultKind,
      })
      expect(application.getStatus(accountA)).toEqual({
        auth,
        connectivity,
        lastError: resultKind,
      })
      if (disposition === 'expire') {
        expect(closes).toBe(1)
        await expect(
          application.refreshAccount(accountA),
        ).rejects.toMatchObject({ kind: 'notConnected' })
      } else {
        expect(closes).toBe(0)
        await application.disconnect(accountA)
        expect(closes).toBe(1)
      }
    }
  })

  it('removes authority even when disconnect close fails and disposes all sessions best-effort', async () => {
    const local = createMemoryLocalEngine()
    let closeA = 0
    let closeB = 0
    const application = new DefaultRemoteApplication({
      readRepository: local.readRepository,
      syncPort: local.syncPort,
      connectionFactory: (config) => ({
        open: async () =>
          session(config === configB ? remoteB : remoteA, {
            close: async () => {
              if (config === configB) closeB++
              else {
                closeA++
                throw new Error('close failure')
              }
            },
          }),
      }),
    })
    await application.connect(request())
    await application.connect(request(accountB, configB))

    await expect(application.disconnect(accountA)).rejects.toMatchObject({
      kind: 'remote',
    })
    expectDisconnected(application.getStatus(accountA))
    await expect(application.refreshAccount(accountA)).rejects.toMatchObject({
      kind: 'notConnected',
    })
    await application.dispose()
    await application.dispose()
    expect({ closeA, closeB }).toEqual({ closeA: 1, closeB: 1 })
  })

  it('drives a nontrivial real Coordinator vertical while returning no remote data', async () => {
    const local = createMemoryLocalEngine()
    const inbox = remoteMailboxIdFromString('vertical-inbox')
    const archive = remoteMailboxIdFromString('vertical-archive')
    const emailOne = remoteEmailIdFromString('vertical-email-1')
    const emailTwo = remoteEmailIdFromString('vertical-email-2')
    const rights = {
      mayReadItems: true,
      mayAddItems: true,
      mayRemoveItems: true,
      maySetSeen: true,
      maySetKeywords: true,
      maySubmit: true,
    }
    const mail: RemoteMail = {
      syncIdentities: async () => ({
        mode: 'replace',
        state: remoteSyncStateFromString('vertical-identity-state'),
        snapshot: [
          {
            id: remoteIdentityIdFromString('vertical-identity-1'),
            name: 'Alice',
            email: 'alice@example.test',
            replyTo: null,
            bcc: null,
          },
          {
            id: remoteIdentityIdFromString('vertical-identity-2'),
            name: 'Alias',
            email: 'alias@example.test',
            replyTo: null,
            bcc: null,
          },
        ],
      }),
      syncMailboxes: async () => ({
        mode: 'replace',
        state: remoteSyncStateFromString('vertical-mailbox-state'),
        snapshot: [
          {
            id: inbox,
            name: 'Inbox',
            parent: null,
            role: 'inbox',
            sortOrder: 0,
            totalEmails: 1,
            unreadEmails: 1,
            rights,
          },
          {
            id: archive,
            name: 'Archive',
            parent: null,
            role: 'archive',
            sortOrder: 1,
            totalEmails: 2,
            unreadEmails: 0,
            rights,
          },
        ],
      }),
      syncEmails: async () => ({
        mode: 'replace',
        state: remoteSyncStateFromString('vertical-email-state'),
        snapshot: [
          {
            id: emailOne,
            blobId: remoteBlobIdFromString('vertical-blob-1'),
            threadId: remoteThreadIdFromString('vertical-thread-1'),
            sender: [{ name: 'Bob', email: 'bob@example.test' }],
            from: [{ name: 'Bob', email: 'bob@example.test' }],
            replyTo: null,
            to: [{ name: 'Alice', email: 'alice@example.test' }],
            cc: null,
            bcc: null,
            subject: 'One',
            sentAt: '2026-08-30T12:00:00Z',
            receivedAt: '2026-08-30T12:00:01Z',
            size: 101,
            preview: 'first',
            hasAttachment: false,
            keywords: new Set(['$seen']),
            mailboxIds: [inbox, archive],
          },
          {
            id: emailTwo,
            blobId: remoteBlobIdFromString('vertical-blob-2'),
            threadId: remoteThreadIdFromString('vertical-thread-2'),
            sender: [{ name: 'Carol', email: 'carol@example.test' }],
            from: [{ name: 'Carol', email: 'carol@example.test' }],
            replyTo: null,
            to: [{ name: 'Alice', email: 'alice@example.test' }],
            cc: null,
            bcc: null,
            subject: 'Two',
            sentAt: '2026-08-30T13:00:00Z',
            receivedAt: '2026-08-30T13:00:01Z',
            size: 202,
            preview: 'second',
            hasAttachment: true,
            keywords: new Set<string>(),
            mailboxIds: [archive],
          },
        ],
      }),
      queryMailbox: async (_accountId, mailboxId) => {
        const ids = mailboxId === inbox ? [emailOne] : [emailOne, emailTwo]
        return {
          ids,
          queryState: remoteSyncStateFromString(`view-${mailboxId}`),
          total: ids.length,
          position: 0,
          canCalculateChanges: true,
        }
      },
      fetchBody: async () => {
        throw new Error('unexpected body fetch')
      },
      fetchAttachments: async () => {
        throw new Error('unexpected attachment fetch')
      },
      applyKeywordChange: async () => {
        throw new Error('unexpected keyword mutation')
      },
      applyMembershipChange: async () => {
        throw new Error('unexpected membership mutation')
      },
    }
    const application = new DefaultRemoteApplication({
      readRepository: local.readRepository,
      syncPort: local.syncPort,
      connectionFactory: () => ({
        open: async () => session(remoteA, { mail }),
      }),
    })
    await application.connect(request())

    await expect(application.refreshAccount(accountA)).resolves.toBeUndefined()
    await expect(
      local.readRepository.listIdentities(accountA),
    ).resolves.toMatchObject({
      ok: true,
      value: { kind: 'present', value: [{}, {}] },
    })
    await expect(
      local.readRepository.listMailboxes(accountA),
    ).resolves.toMatchObject({
      ok: true,
      value: { kind: 'present', value: [{}, {}] },
    })
    const emails = await local.readRepository.readEmails([
      localEmailId(accountA, emailOne),
      localEmailId(accountA, emailTwo),
    ])
    expect(emails).toMatchObject({
      ok: true,
      value: [{ kind: 'present' }, { kind: 'present' }],
    })
    const firstMemberships = await local.readRepository.readEmailMemberships(
      localEmailId(accountA, emailOne),
    )
    const secondMemberships = await local.readRepository.readEmailMemberships(
      localEmailId(accountA, emailTwo),
    )
    expect(firstMemberships).toMatchObject({
      ok: true,
      value: { kind: 'present', value: [{}, {}] },
    })
    expect(secondMemberships).toMatchObject({
      ok: true,
      value: { kind: 'present', value: [{}] },
    })
    for (const mailboxId of [inbox, archive]) {
      await expect(
        local.readRepository.readMailboxView(
          mailboxViewSpec(
            localMailboxId(accountA, mailboxId),
            mailboxViewFilterAll(),
            mailboxViewSort('descending'),
          ),
        ),
      ).resolves.toMatchObject({
        ok: true,
        value: { kind: 'cached' },
      })
    }
    for (const dataType of ['identity', 'mailbox', 'email'] as const) {
      await expect(
        local.readRepository.readCollectionSyncCursor(accountA, dataType),
      ).resolves.toMatchObject({
        ok: true,
        value: { kind: 'present' },
      })
    }
  })

  it('never exposes or retains the final credential canary across connect outcomes', async () => {
    const canary = 'BOXPL0T_RA_FINAL_FREEZE_SECRET_52917'
    const sensitiveConfig = {
      provider: 'imapSmtp' as const,
      host: '127.0.0.1',
      username: 'final-reverify-user',
      password: canary,
      imapPort: 1143,
      smtpPort: 1025,
    }
    const scenarios = [
      'success',
      'reentrantCancel',
      'factoryCancel',
      'authError',
      'networkError',
    ] as const

    for (const scenario of scenarios) {
      const local = createMemoryLocalEngine()
      const observed: unknown[] = []
      const factory: RemoteConnectionFactory = () => {
        if (scenario === 'factoryCancel') {
          void application.disconnect(accountA)
        }
        return {
          open: async () => {
            if (scenario === 'authError') {
              throw new RemoteError('safe authentication failure', {
                kind: 'auth',
                retry: 'never',
                session: 'keep',
                outcome: 'notApplicable',
              })
            }
            if (scenario === 'networkError') {
              throw new RemoteError('safe network failure', {
                kind: 'network',
                retry: 'safeBackoff',
                session: 'keep',
                outcome: 'knownNotApplied',
              })
            }
            return session()
          },
        }
      }
      const application = new DefaultRemoteApplication({
        readRepository: local.readRepository,
        syncPort: local.syncPort,
        connectionFactory: factory,
      })
      application.subscribe(accountA, (status) => {
        observed.push(status)
        if (
          scenario === 'reentrantCancel' &&
          status.auth === 'authenticating'
        ) {
          void application.disconnect(accountA)
        }
      })

      try {
        observed.push(
          await application.connect({
            accountKey: accountA,
            serviceKey: service,
            config: sensitiveConfig,
          }),
        )
      } catch (error: unknown) {
        observed.push(error)
      }
      observed.push(application.getStatus(accountA))
      expect(JSON.stringify({ observed, application })).not.toContain(canary)
    }
  })

  it('starts no native IPC at construction, opens only for IMAP/SMTP, and never falls JMAP back to native', async () => {
    const local = createMemoryLocalEngine()
    let nativeOpens = 0
    const native = new Proxy(
      {},
      {
        get(_target, property) {
          if (property === 'open') {
            return async () => {
              nativeOpens++
              return {
                sessionId: 'final-reverify-native-session',
                authenticatedUser: 'alice@example.test',
              }
            }
          }
          if (property === 'close') return async () => {}
          return async () => {
            throw new Error(`unexpected native call: ${String(property)}`)
          }
        },
      },
    ) as NativeMailIpcPort
    const application = createTauriRemoteApplication({
      readRepository: local.readRepository,
      syncPort: local.syncPort,
      nativeMailIpc: native,
    })
    expect(nativeOpens).toBe(0)

    await expect(
      application.connect({
        accountKey: accountA,
        serviceKey: service,
        config: {
          provider: 'imapSmtp',
          host: 'mail.example.test',
          username: 'alice@example.test',
          password: 'BOXPL0T_RA_FINAL_FREEZE_SECRET_52917',
          imapPort: 993,
          smtpPort: 465,
        },
      }),
    ).resolves.toEqual({ accountKey: accountA })
    expect(nativeOpens).toBe(1)
    await expect(
      application.connect(request(accountB, configB)),
    ).rejects.toMatchObject({ kind: 'remote' })
    expect(nativeOpens).toBe(1)
    expect(JSON.stringify(application)).not.toContain(
      'BOXPL0T_RA_FINAL_FREEZE_SECRET_52917',
    )
  })
})
