import { describe, expect, it, vi } from 'vitest'

import { createMemoryLocalEngine } from '../../../adapters/memory'
import { account, remoteAccountRef } from '../../../domain/account'
import { accountKeyFromString, serviceKeyFromString } from '../../../domain/ids'
import {
  mailboxViewFilterAll,
  mailboxViewSort,
  mailboxViewSpec,
} from '../../../domain/mailbox-view'
import type { ReadRepository } from '../../../ports/read-repository'
import type { SyncPort } from '../../../ports/sync-port'
import type { RemoteConnection } from '../../../remote/connection'
import { RemoteError, type RemoteErrorKind } from '../../../remote/errors'
import {
  localAccountId,
  localEmailId,
  localMailboxId,
} from '../../../remote/compat/domain-ids'
import type { RemoteSession } from '../../../remote/session'
import type {
  NativeMailIpcPort,
  NativeMailOpenRequest,
} from '../../../remote/native/ipc'
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
import type { RemoteConnectionFactory } from '../types'
import {
  VerificationBarrier,
  VerificationMail,
  VerificationSession,
  VERIFY_CONFIG,
} from './independent-remote-harness'

const ACCOUNT_A = accountKeyFromString('independent-account-a')
const ACCOUNT_B = accountKeyFromString('independent-account-b')
const SERVICE_A = serviceKeyFromString('independent-service-a')
const SERVICE_B = serviceKeyFromString('independent-service-b')
const REMOTE_A = remoteAccountIdFromString('independent-remote-a')
const REMOTE_B = remoteAccountIdFromString('independent-remote-b')
const DISCONNECTED_STATUS = {
  auth: 'anonymous',
  connectivity: 'offline',
  lastError: null,
} as const

function applicationFor(
  readRepository: ReadRepository,
  syncPort: SyncPort,
  connectionFactory: RemoteConnectionFactory,
): DefaultRemoteApplication {
  return new DefaultRemoteApplication({
    readRepository,
    syncPort,
    connectionFactory,
  })
}

function request(
  accountKey = ACCOUNT_A,
  serviceKey = SERVICE_A,
  username = 'verify-user',
) {
  return {
    accountKey,
    serviceKey,
    config: { ...VERIFY_CONFIG, username },
  } as const
}

function remoteFailure(
  kind: RemoteErrorKind,
  session: 'keep' | 'expire' = 'keep',
): RemoteError {
  return new RemoteError('VERIFY_SECRET_MUST_NOT_SURFACE', {
    kind,
    retry: 'never',
    session,
    outcome: 'notApplicable',
  })
}

function nativeIpcProbe(
  openRequests: NativeMailOpenRequest[],
): NativeMailIpcPort {
  return {
    async open(openRequest) {
      openRequests.push(openRequest)
      return {
        sessionId: 'verify-native-session',
        authenticatedUser: 'native-user',
      }
    },
    close: vi.fn(async () => undefined),
    listMailboxes: vi.fn(async () => []),
    snapshotMailbox: vi.fn(async () => {
      throw new Error('snapshotMailbox is outside this verifier')
    }),
    fetchBody: vi.fn(async () => {
      throw new Error('fetchBody is outside this verifier')
    }),
    fetchAttachments: vi.fn(async () => []),
    storeFlags: vi.fn(async () => undefined),
    move: vi.fn(async () => {
      throw new Error('move is outside this verifier')
    }),
    smtpSubmit: vi.fn(async () => {
      throw new Error('smtpSubmit is outside this verifier')
    }),
  }
}

describe('RemoteApplication independent deterministic verification', () => {
  it('starts disconnected, publishes exact connect order, and performs no implicit sync', async () => {
    const local = createMemoryLocalEngine()
    const mail = new VerificationMail()
    const session = new VerificationSession(REMOTE_A, mail)
    let factoryCalls = 0
    const application = applicationFor(
      local.readRepository,
      local.syncPort,
      () => {
        factoryCalls += 1
        return {
          async open(): Promise<RemoteSession> {
            return session
          },
        }
      },
    )
    const events: unknown[] = []
    application.subscribe(ACCOUNT_A, (status) => events.push(status))

    expect(application.getStatus(ACCOUNT_A)).toEqual({
      auth: 'anonymous',
      connectivity: 'offline',
      lastError: null,
    })
    expect(factoryCalls).toBe(0)
    await expect(application.connect(request())).resolves.toEqual({
      accountKey: ACCOUNT_A,
    })

    expect(events).toEqual([
      { auth: 'anonymous', connectivity: 'offline', lastError: null },
      { auth: 'authenticating', connectivity: 'offline', lastError: null },
      { auth: 'authenticated', connectivity: 'online', lastError: null },
    ])
    expect(mail.calls).toEqual([])
    expect(JSON.stringify(application)).not.toContain('verify-password')
    expect(JSON.stringify(application)).not.toContain('verify-user')
    expect(JSON.stringify(application)).not.toContain('127.0.0.1')
  })

  it('accepts only an exact existing binding and never rewrites it', async () => {
    const cases = [
      {
        name: 'exact binding among multiple accounts',
        storedService: SERVICE_A,
        requestedService: SERVICE_A,
        accounts: [REMOTE_B, REMOTE_A],
        expected: 'success',
      },
      {
        name: 'wrong service',
        storedService: SERVICE_B,
        requestedService: SERVICE_A,
        accounts: [REMOTE_A],
        expected: 'accountMismatch',
      },
      {
        name: 'bound remote ID absent',
        storedService: SERVICE_A,
        requestedService: SERVICE_A,
        accounts: [REMOTE_B],
        expected: 'accountMismatch',
      },
      {
        name: 'remote account list empty',
        storedService: SERVICE_A,
        requestedService: SERVICE_A,
        accounts: [],
        expected: 'accountMismatch',
      },
    ] as const

    for (const scenario of cases) {
      const local = createMemoryLocalEngine()
      const original = account(
        ACCOUNT_A,
        remoteAccountRef(scenario.storedService, localAccountId(REMOTE_A)),
      )
      await expect(local.syncPort.registerAccount(original)).resolves.toEqual({
        ok: true,
        value: undefined,
      })
      const mail = new VerificationMail()
      const session = new VerificationSession(
        scenario.accounts[0] ?? REMOTE_B,
        mail,
        scenario.accounts.slice(1),
      )
      Object.defineProperty(session, 'accounts', {
        value: scenario.accounts.map((id) => ({ id, capabilities: [] })),
      })
      const application = applicationFor(
        local.readRepository,
        local.syncPort,
        () => ({
          async open(): Promise<RemoteSession> {
            return session
          },
        }),
      )

      if (scenario.expected === 'success') {
        await expect(
          application.connect(request(ACCOUNT_A, scenario.requestedService)),
          scenario.name,
        ).resolves.toEqual({ accountKey: ACCOUNT_A })
      } else {
        await expect(
          application.connect(request(ACCOUNT_A, scenario.requestedService)),
          scenario.name,
        ).rejects.toMatchObject({ kind: scenario.expected })
        expect(session.closeCalls).toBe(1)
      }
      await expect(
        local.readRepository.readAccount(ACCOUNT_A),
      ).resolves.toEqual({
        ok: true,
        value: { kind: 'present', value: original },
      })
    }
  })

  it('enforces exact-one selection for a new account and preserves opaque IDs', async () => {
    const opaqueValues = [
      'opaque:/Case Sensitive?x=1',
      'imap-account-v1:alice@example',
      '{"id":"strange"}',
      'á/🔥/X:Y',
      ' spaces ',
    ]
    for (const opaque of opaqueValues) {
      const local = createMemoryLocalEngine()
      const id = remoteAccountIdFromString(opaque)
      const session = new VerificationSession(id, new VerificationMail())
      const application = applicationFor(
        local.readRepository,
        local.syncPort,
        () => ({
          async open(): Promise<RemoteSession> {
            return session
          },
        }),
      )
      await application.connect(request())
      const stored = await local.readRepository.readAccount(ACCOUNT_A)
      expect(stored).toEqual({
        ok: true,
        value: {
          kind: 'present',
          value: account(
            ACCOUNT_A,
            remoteAccountRef(SERVICE_A, localAccountId(id)),
          ),
        },
      })
      if (stored.ok && stored.value.kind === 'present') {
        expect(String(stored.value.value.remoteRef.jmapAccountId)).toBe(opaque)
      }
    }

    for (const ids of [[], [REMOTE_A, REMOTE_B]]) {
      const local = createMemoryLocalEngine()
      const session = new VerificationSession(REMOTE_A, new VerificationMail())
      Object.defineProperty(session, 'accounts', {
        value: ids.map((id) => ({ id, capabilities: [] })),
      })
      const application = applicationFor(
        local.readRepository,
        local.syncPort,
        () => ({
          async open(): Promise<RemoteSession> {
            return session
          },
        }),
      )
      await expect(application.connect(request())).rejects.toMatchObject({
        kind: 'accountSelectionRequired',
      })
      expect(session.closeCalls).toBe(1)
      await expect(
        local.readRepository.readAccount(ACCOUNT_A),
      ).resolves.toEqual({ ok: true, value: { kind: 'absent' } })
    }
  })

  it('accepts a concurrent exact registration but rejects a concurrent rebind', async () => {
    for (const sameBinding of [true, false]) {
      const local = createMemoryLocalEngine()
      let reads = 0
      const readAccount: ReadRepository['readAccount'] = async (key) => {
        reads += 1
        return local.readRepository.readAccount(key)
      }
      const readRepository = new Proxy(local.readRepository, {
        get(target, property) {
          if (property === 'readAccount') return readAccount
          const member = Reflect.get(target, property)
          return typeof member === 'function' ? member.bind(target) : member
        },
      })
      const registerAccount: SyncPort['registerAccount'] = async (
        candidate,
      ) => {
        const winner = sameBinding
          ? candidate
          : account(
              candidate.key,
              remoteAccountRef(SERVICE_B, localAccountId(REMOTE_B)),
            )
        await local.syncPort.registerAccount(winner)
        return { ok: false, error: { kind: 'conflict' } }
      }
      const syncPort = new Proxy(local.syncPort, {
        get(target, property) {
          if (property === 'registerAccount') return registerAccount
          const member = Reflect.get(target, property)
          return typeof member === 'function' ? member.bind(target) : member
        },
      })
      const session = new VerificationSession(REMOTE_A, new VerificationMail())
      const application = applicationFor(readRepository, syncPort, () => ({
        async open(): Promise<RemoteSession> {
          return session
        },
      }))

      if (sameBinding) {
        await expect(application.connect(request())).resolves.toEqual({
          accountKey: ACCOUNT_A,
        })
        expect(session.closeCalls).toBe(0)
      } else {
        await expect(application.connect(request())).rejects.toMatchObject({
          kind: 'accountMismatch',
        })
        expect(session.closeCalls).toBe(1)
      }
      expect(reads).toBe(2)
    }
  })

  it.each([
    ['readAccount unavailable', 'read', 'unavailable'],
    ['readAccount corruptState', 'read', 'corruptState'],
    ['registerAccount unavailable', 'write', 'unavailable'],
    ['registerAccount unexpected', 'write', 'unexpected'],
  ] as const)(
    'closes an opened session after local failure: %s',
    async (_name, stage, kind) => {
      const local = createMemoryLocalEngine()
      const readAccount: ReadRepository['readAccount'] =
        stage === 'read'
          ? async () => ({ ok: false, error: { kind } })
          : local.readRepository.readAccount.bind(local.readRepository)
      const registerAccount: SyncPort['registerAccount'] =
        stage === 'write'
          ? async () => ({ ok: false, error: { kind } })
          : local.syncPort.registerAccount.bind(local.syncPort)
      const readRepository = new Proxy(local.readRepository, {
        get(target, property) {
          if (property === 'readAccount') return readAccount
          const member = Reflect.get(target, property)
          return typeof member === 'function' ? member.bind(target) : member
        },
      })
      const syncPort = new Proxy(local.syncPort, {
        get(target, property) {
          if (property === 'registerAccount') return registerAccount
          const member = Reflect.get(target, property)
          return typeof member === 'function' ? member.bind(target) : member
        },
      })
      const session = new VerificationSession(REMOTE_A, new VerificationMail())
      const application = applicationFor(readRepository, syncPort, () => ({
        async open(): Promise<RemoteSession> {
          return session
        },
      }))
      await expect(application.connect(request())).rejects.toMatchObject({
        kind: 'local',
      })
      expect(session.closeCalls).toBe(1)
      expect(application.getStatus(ACCOUNT_A)).toEqual({
        auth: 'anonymous',
        connectivity: 'online',
        lastError: 'local',
      })
    },
  )

  it.each([
    ['auth', 'auth', 'online'],
    ['network', 'network', 'offline'],
    ['unavailable', 'network', 'offline'],
    ['protocol', 'remote', 'offline'],
    ['malformedRemoteData', 'remote', 'offline'],
    ['stateInvalid', 'remote', 'offline'],
    ['conflict', 'remote', 'offline'],
    ['unsupported', 'remote', 'offline'],
    ['rateLimited', 'remote', 'offline'],
    ['tooLarge', 'remote', 'offline'],
    ['rejected', 'remote', 'offline'],
    ['unexpected', 'remote', 'offline'],
  ] as const)(
    'maps open %s without leaking the remote message',
    async (remoteKind, applicationKind, connectivity) => {
      const local = createMemoryLocalEngine()
      const application = applicationFor(
        local.readRepository,
        local.syncPort,
        () => ({
          async open(): Promise<RemoteSession> {
            throw remoteFailure(remoteKind)
          },
        }),
      )
      const connecting = application.connect(request())
      await expect(connecting).rejects.toMatchObject({
        kind: applicationKind,
        message: expect.not.stringContaining('VERIFY_SECRET'),
      })
      expect(application.getStatus(ACCOUNT_A)).toEqual({
        auth: 'anonymous',
        connectivity,
        lastError: applicationKind,
      })
    },
  )

  it.each([
    new Error('plain secret'),
    new TypeError('typed secret'),
    'unknown secret',
  ])('sanitizes ordinary pre-session failures', async (failure) => {
    const local = createMemoryLocalEngine()
    const application = applicationFor(
      local.readRepository,
      local.syncPort,
      () => ({
        async open(): Promise<RemoteSession> {
          throw failure
        },
      }),
    )
    await expect(application.connect(request())).rejects.toMatchObject({
      kind: 'unexpected',
      message: 'An unexpected remote application error occurred',
    })
    expect(application.getStatus(ACCOUNT_A)).toEqual({
      auth: 'anonymous',
      connectivity: 'offline',
      lastError: 'unexpected',
    })
  })

  it.each([
    ['auth', 'auth', 'online'],
    ['network', 'network', 'offline'],
    ['unavailable', 'network', 'offline'],
    ['protocol', 'remote', 'online'],
    ['malformedRemoteData', 'remote', 'online'],
    ['stateInvalid', 'remote', 'online'],
    ['conflict', 'remote', 'online'],
    ['unsupported', 'remote', 'online'],
    ['rateLimited', 'remote', 'online'],
    ['tooLarge', 'remote', 'online'],
    ['rejected', 'remote', 'online'],
    ['unexpected', 'remote', 'online'],
  ] as const)(
    'honors session keep for %s',
    async (remoteKind, applicationKind, connectivity) => {
      const local = createMemoryLocalEngine()
      const mail = new VerificationMail()
      const session = new VerificationSession(REMOTE_A, mail)
      const application = applicationFor(
        local.readRepository,
        local.syncPort,
        () => ({
          async open(): Promise<RemoteSession> {
            return session
          },
        }),
      )
      await application.connect(request())
      mail.syncFailure = remoteFailure(remoteKind, 'keep')
      await expect(application.refreshAccount(ACCOUNT_A)).rejects.toMatchObject(
        {
          kind: applicationKind,
        },
      )
      expect(application.getStatus(ACCOUNT_A)).toEqual({
        auth: 'authenticated',
        connectivity,
        lastError: applicationKind,
      })
      expect(session.closeCalls).toBe(0)
      mail.syncFailure = null
      await expect(
        application.refreshAccount(ACCOUNT_A),
      ).resolves.toBeUndefined()
      expect(session.closeCalls).toBe(0)
    },
  )

  it.each([
    ['auth', 'auth', 'online'],
    ['network', 'network', 'offline'],
    ['unavailable', 'network', 'offline'],
    ['protocol', 'remote', 'online'],
    ['malformedRemoteData', 'remote', 'online'],
    ['unexpected', 'remote', 'online'],
  ] as const)(
    'honors session expire for %s even when cleanup fails',
    async (remoteKind, applicationKind, connectivity) => {
      const local = createMemoryLocalEngine()
      const mail = new VerificationMail()
      const session = new VerificationSession(REMOTE_A, mail)
      session.closeFailure = new Error('cleanup failure')
      const application = applicationFor(
        local.readRepository,
        local.syncPort,
        () => ({
          async open(): Promise<RemoteSession> {
            return session
          },
        }),
      )
      await application.connect(request())
      mail.syncFailure = remoteFailure(remoteKind, 'expire')
      await expect(application.refreshAccount(ACCOUNT_A)).rejects.toMatchObject(
        {
          kind: applicationKind,
        },
      )
      expect(application.getStatus(ACCOUNT_A)).toEqual({
        auth: 'expired',
        connectivity,
        lastError: applicationKind,
      })
      expect(session.closeCalls).toBe(1)
      await expect(application.refreshAccount(ACCOUNT_A)).rejects.toMatchObject(
        {
          kind: 'notConnected',
        },
      )
    },
  )

  it('retains the session and classifies an ordinary Coordinator failure as local', async () => {
    const local = createMemoryLocalEngine()
    const mail = new VerificationMail()
    const session = new VerificationSession(REMOTE_A, mail)
    const application = applicationFor(
      local.readRepository,
      local.syncPort,
      () => ({
        async open(): Promise<RemoteSession> {
          return session
        },
      }),
    )
    await application.connect(request())
    mail.syncFailure = new Error('local-port-shaped failure')
    await expect(application.refreshAccount(ACCOUNT_A)).rejects.toMatchObject({
      kind: 'local',
    })
    expect(application.getStatus(ACCOUNT_A)).toEqual({
      auth: 'authenticated',
      connectivity: 'online',
      lastError: 'local',
    })
    expect(session.closeCalls).toBe(0)
  })

  it('refreshes through the real Coordinator into the real MemoryLocalEngine', async () => {
    const local = createMemoryLocalEngine()
    const mail = new VerificationMail()
    const inbox = remoteMailboxIdFromString('inbox')
    const archive = remoteMailboxIdFromString('archive')
    const emailOne = remoteEmailIdFromString('email-one')
    const emailTwo = remoteEmailIdFromString('email-two')
    mail.identities = {
      mode: 'replace',
      state: remoteSyncStateFromString('identity-cursor-exact'),
      snapshot: [
        {
          id: remoteIdentityIdFromString('identity-one'),
          name: 'Alice',
          email: 'alice@example.test',
          replyTo: null,
          bcc: [],
        },
      ],
    }
    const rights = {
      mayReadItems: true,
      mayAddItems: true,
      mayRemoveItems: true,
      maySetSeen: true,
      maySetKeywords: true,
      maySubmit: true,
    }
    mail.mailboxes = {
      mode: 'replace',
      state: remoteSyncStateFromString('mailbox-cursor-exact'),
      snapshot: [
        {
          id: inbox,
          name: 'Inbox',
          parent: null,
          role: 'inbox',
          sortOrder: 1,
          totalEmails: 2,
          unreadEmails: 1,
          rights,
        },
        {
          id: archive,
          name: 'Archive',
          parent: null,
          role: 'archive',
          sortOrder: 2,
          totalEmails: 1,
          unreadEmails: 0,
          rights,
        },
      ],
    }
    const baseEmail = {
      blobId: remoteBlobIdFromString('blob'),
      threadId: remoteThreadIdFromString('thread'),
      sender: null,
      from: [{ name: 'Sender', email: 'sender@example.test' }],
      replyTo: null,
      to: [{ name: null, email: 'alice@example.test' }],
      cc: null,
      bcc: null,
      subject: 'Verifier mail',
      sentAt: '2026-08-30T01:00:00.000Z',
      receivedAt: '2026-08-30T01:00:01.000Z',
      size: 42,
      preview: 'independent',
      hasAttachment: false,
      keywords: new Set<string>(),
    }
    mail.emails = {
      mode: 'replace',
      state: remoteSyncStateFromString('email-cursor-exact'),
      snapshot: [
        { ...baseEmail, id: emailOne, mailboxIds: [inbox, archive] },
        { ...baseEmail, id: emailTwo, mailboxIds: [inbox] },
      ],
    }
    mail.queries.set(inbox, {
      ids: [emailTwo, emailOne],
      queryState: remoteSyncStateFromString('inbox-query-exact'),
      total: 2,
      position: 0,
      canCalculateChanges: true,
    })
    mail.queries.set(archive, {
      ids: [emailOne],
      queryState: remoteSyncStateFromString('archive-query-exact'),
      total: 1,
      position: 0,
      canCalculateChanges: true,
    })
    const session = new VerificationSession(REMOTE_A, mail)
    const application = applicationFor(
      local.readRepository,
      local.syncPort,
      () => ({
        async open(): Promise<RemoteSession> {
          return session
        },
      }),
    )
    await application.connect(request())
    const refreshResult = await application.refreshAccount(ACCOUNT_A)
    expect(refreshResult).toBeUndefined()

    await expect(
      local.readRepository.listIdentities(ACCOUNT_A),
    ).resolves.toMatchObject({
      ok: true,
      value: { kind: 'present', value: [{ name: 'Alice' }] },
    })
    await expect(
      local.readRepository.listMailboxes(ACCOUNT_A),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        kind: 'present',
        value: expect.arrayContaining([
          expect.objectContaining({ name: 'Inbox' }),
          expect.objectContaining({ name: 'Archive' }),
        ]),
      },
    })
    await expect(
      local.readRepository.readEmailMemberships(
        localEmailId(ACCOUNT_A, emailOne),
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        kind: 'present',
        value: expect.arrayContaining([
          {
            emailId: localEmailId(ACCOUNT_A, emailOne),
            mailboxId: localMailboxId(ACCOUNT_A, inbox),
          },
          {
            emailId: localEmailId(ACCOUNT_A, emailOne),
            mailboxId: localMailboxId(ACCOUNT_A, archive),
          },
        ]),
      },
    })
    for (const [type, state] of [
      ['identity', 'identity-cursor-exact'],
      ['mailbox', 'mailbox-cursor-exact'],
      ['email', 'email-cursor-exact'],
    ] as const) {
      await expect(
        local.readRepository.readCollectionSyncCursor(ACCOUNT_A, type),
      ).resolves.toMatchObject({
        ok: true,
        value: { kind: 'present', value: { state } },
      })
    }
    await expect(
      local.readRepository.readMailboxView(
        mailboxViewSpec(
          localMailboxId(ACCOUNT_A, inbox),
          mailboxViewFilterAll(),
          mailboxViewSort('descending'),
        ),
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: { kind: 'cached', value: { total: 2 } },
    })
  })

  it('keeps account sessions, status, and notifications isolated', async () => {
    const local = createMemoryLocalEngine()
    const mailA = new VerificationMail()
    const mailB = new VerificationMail()
    const sessionA = new VerificationSession(REMOTE_A, mailA)
    const sessionB = new VerificationSession(REMOTE_B, mailB)
    const factory: RemoteConnectionFactory = (config): RemoteConnection => ({
      async open(): Promise<RemoteSession> {
        return config.provider === 'imapSmtp' && config.username === 'account-a'
          ? sessionA
          : sessionB
      },
    })
    const application = applicationFor(
      local.readRepository,
      local.syncPort,
      factory,
    )
    const eventsA: unknown[] = []
    const eventsB: unknown[] = []
    application.subscribe(ACCOUNT_A, (status) => eventsA.push(status))
    application.subscribe(ACCOUNT_B, (status) => eventsB.push(status))
    await application.connect(request(ACCOUNT_A, SERVICE_A, 'account-a'))
    const bEventsBefore = eventsB.length
    await application.connect(request(ACCOUNT_B, SERVICE_B, 'account-b'))
    const aEventsBeforeFailure = eventsA.length
    mailA.syncFailure = remoteFailure('network', 'keep')
    await expect(application.refreshAccount(ACCOUNT_A)).rejects.toMatchObject({
      kind: 'network',
    })
    expect(eventsB).toHaveLength(bEventsBefore + 2)
    expect(eventsA).toHaveLength(aEventsBeforeFailure + 1)
    expect(application.getStatus(ACCOUNT_B)).toEqual({
      auth: 'authenticated',
      connectivity: 'online',
      lastError: null,
    })
    expect(mailB.calls).toEqual([])
    await application.disconnect(ACCOUNT_A)
    expect(application.getStatus(ACCOUNT_B).auth).toBe('authenticated')
    expect(sessionB.closeCalls).toBe(0)
  })

  it('isolates observer errors, snapshots, unsubscribe, mutation, and deduplication', async () => {
    const local = createMemoryLocalEngine()
    const session = new VerificationSession(REMOTE_A, new VerificationMail())
    const application = applicationFor(
      local.readRepository,
      local.syncPort,
      () => ({
        async open(): Promise<RemoteSession> {
          return session
        },
      }),
    )
    let safeCalls = 0
    let removedCalls = 0
    application.subscribe(ACCOUNT_A, () => {
      throw new Error('observer')
    })
    const stop = application.subscribe(ACCOUNT_A, (status) => {
      safeCalls += 1
      ;(status as { auth: string }).auth = 'expired'
    })
    application.subscribe(ACCOUNT_B, () => {
      throw new Error('unrelated observer')
    })
    await application.connect(request())
    expect(application.getStatus(ACCOUNT_A).auth).toBe('authenticated')
    stop()
    stop()
    removedCalls = safeCalls
    await application.disconnect(ACCOUNT_A)
    await application.disconnect(ACCOUNT_A)
    expect(safeCalls).toBe(removedCalls)
    expect(application.getStatus(ACCOUNT_A)).toEqual({
      auth: 'anonymous',
      connectivity: 'offline',
      lastError: null,
    })
  })

  it('disposes all sessions best-effort and rejects future lifecycle APIs', async () => {
    const local = createMemoryLocalEngine()
    const keys = [
      ACCOUNT_A,
      ACCOUNT_B,
      accountKeyFromString('independent-account-c'),
    ]
    const services = [
      SERVICE_A,
      SERVICE_B,
      serviceKeyFromString('independent-service-c'),
    ]
    const sessions = keys.map(
      (_, index) =>
        new VerificationSession(
          remoteAccountIdFromString(`dispose-remote-${index}`),
          new VerificationMail(),
        ),
    )
    sessions[1].closeFailure = new Error('close failure')
    let next = 0
    const application = applicationFor(
      local.readRepository,
      local.syncPort,
      () => {
        const session = sessions[next++]
        return {
          async open(): Promise<RemoteSession> {
            return session
          },
        }
      },
    )
    for (let index = 0; index < keys.length; index++) {
      await application.connect(
        request(keys[index], services[index], `dispose-${index}`),
      )
    }
    await application.dispose()
    await application.dispose()
    expect(sessions.map((session) => session.closeCalls)).toEqual([1, 1, 1])
    for (const key of keys) {
      expect(application.getStatus(key)).toEqual({
        auth: 'anonymous',
        connectivity: 'offline',
        lastError: null,
      })
      await expect(application.disconnect(key)).rejects.toMatchObject({
        kind: 'disposed',
      })
      await expect(application.refreshAccount(key)).rejects.toMatchObject({
        kind: 'disposed',
      })
      expect(() => application.subscribe(key, () => undefined)).toThrowError(
        expect.objectContaining({ kind: 'disposed' }),
      )
    }
  })

  it('does not let close failure replace binding mismatch and disconnect stays authoritative', async () => {
    const local = createMemoryLocalEngine()
    const session = new VerificationSession(REMOTE_B, new VerificationMail())
    session.closeFailure = new Error('cleanup secret')
    const application = applicationFor(
      local.readRepository,
      local.syncPort,
      () => ({
        async open(): Promise<RemoteSession> {
          return session
        },
      }),
    )
    await local.syncPort.registerAccount(
      account(ACCOUNT_A, remoteAccountRef(SERVICE_A, localAccountId(REMOTE_A))),
    )
    await expect(application.connect(request())).rejects.toMatchObject({
      kind: 'accountMismatch',
    })
    expect(session.closeCalls).toBe(1)

    const connected = new VerificationSession(REMOTE_A, new VerificationMail())
    connected.closeFailure = new Error('disconnect close')
    const second = applicationFor(local.readRepository, local.syncPort, () => ({
      async open(): Promise<RemoteSession> {
        return connected
      },
    }))
    await second.connect(request())
    await expect(second.disconnect(ACCOUNT_A)).rejects.toMatchObject({
      kind: 'remote',
    })
    expect(second.getStatus(ACCOUNT_A)).toEqual({
      auth: 'anonymous',
      connectivity: 'offline',
      lastError: null,
    })
    await expect(second.refreshAccount(ACCOUNT_A)).rejects.toMatchObject({
      kind: 'notConnected',
    })
    await expect(second.disconnect(ACCOUNT_A)).resolves.toBeUndefined()
  })

  it('blocks a second same-account connect and cancels a late open after disconnect', async () => {
    const local = createMemoryLocalEngine()
    const openGate = new VerificationBarrier<RemoteSession>()
    const session = new VerificationSession(REMOTE_A, new VerificationMail())
    let factoryCalls = 0
    const application = applicationFor(
      local.readRepository,
      local.syncPort,
      () => {
        factoryCalls += 1
        return { open: () => openGate.promise }
      },
    )
    const first = application.connect(request())
    await expect(application.connect(request())).rejects.toMatchObject({
      kind: 'busy',
    })
    expect(factoryCalls).toBe(1)
    await application.disconnect(ACCOUNT_A)
    openGate.release(session)
    await expect(first).rejects.toMatchObject({ kind: 'cancelled' })
    expect(session.closeCalls).toBe(1)
    await expect(local.readRepository.readAccount(ACCOUNT_A)).resolves.toEqual({
      ok: true,
      value: { kind: 'absent' },
    })
    expect(application.getStatus(ACCOUNT_A)).toEqual({
      auth: 'anonymous',
      connectivity: 'offline',
      lastError: null,
    })
  })

  it('cannot activate after disconnect while account registration is pending', async () => {
    const local = createMemoryLocalEngine()
    const registrationEntered = new VerificationBarrier<void>()
    const registrationRelease = new VerificationBarrier<void>()
    const registerAccount: SyncPort['registerAccount'] = async (value) => {
      registrationEntered.release(undefined)
      await registrationRelease.promise
      return local.syncPort.registerAccount(value)
    }
    const gatedSyncPort = new Proxy(local.syncPort, {
      get(target, property) {
        if (property === 'registerAccount') return registerAccount
        const member = Reflect.get(target, property)
        return typeof member === 'function' ? member.bind(target) : member
      },
    })
    const session = new VerificationSession(REMOTE_A, new VerificationMail())
    const application = applicationFor(
      local.readRepository,
      gatedSyncPort,
      () => ({
        async open(): Promise<RemoteSession> {
          return session
        },
      }),
    )
    const connecting = application.connect(request())
    await registrationEntered.promise
    await application.disconnect(ACCOUNT_A)
    registrationRelease.release(undefined)
    await expect(connecting).rejects.toMatchObject({ kind: 'cancelled' })
    expect(session.closeCalls).toBe(1)
    expect(application.getStatus(ACCOUNT_A)).toEqual({
      auth: 'anonymous',
      connectivity: 'offline',
      lastError: null,
    })
  })

  it('cannot resurrect status after disconnect while real Coordinator refresh is pending', async () => {
    const local = createMemoryLocalEngine()
    const refreshEntered = new VerificationBarrier<void>()
    const refreshRelease = new VerificationBarrier<void>()
    const mail = new VerificationMail()
    const immediateIdentities = mail.syncIdentities.bind(mail)
    mail.syncIdentities = async (accountId, previousState) => {
      refreshEntered.release(undefined)
      await refreshRelease.promise
      return immediateIdentities(accountId, previousState)
    }
    const session = new VerificationSession(REMOTE_A, mail)
    const application = applicationFor(
      local.readRepository,
      local.syncPort,
      () => ({
        async open(): Promise<RemoteSession> {
          return session
        },
      }),
    )
    await application.connect(request())
    const refreshing = application.refreshAccount(ACCOUNT_A)
    await refreshEntered.promise
    await application.disconnect(ACCOUNT_A)
    refreshRelease.release(undefined)
    await expect(refreshing).rejects.toMatchObject({ kind: 'cancelled' })
    expect(application.getStatus(ACCOUNT_A)).toEqual({
      auth: 'anonymous',
      connectivity: 'offline',
      lastError: null,
    })
    expect(session.closeCalls).toBe(1)
  })

  it('invalidates and closes multiple sessions that resolve after dispose', async () => {
    const local = createMemoryLocalEngine()
    const gates = [
      new VerificationBarrier<RemoteSession>(),
      new VerificationBarrier<RemoteSession>(),
    ]
    const sessions = [
      new VerificationSession(REMOTE_A, new VerificationMail()),
      new VerificationSession(REMOTE_B, new VerificationMail()),
    ]
    let next = 0
    const application = applicationFor(
      local.readRepository,
      local.syncPort,
      () => ({ open: () => gates[next++].promise }),
    )
    const connects = [
      application.connect(request(ACCOUNT_A, SERVICE_A, 'pending-a')),
      application.connect(request(ACCOUNT_B, SERVICE_B, 'pending-b')),
    ]
    await application.dispose()
    gates.forEach((gate, index) => gate.release(sessions[index]))
    await Promise.all(
      connects.map((connecting) =>
        expect(connecting).rejects.toMatchObject({ kind: 'cancelled' }),
      ),
    )
    expect(sessions.map((session) => session.closeCalls)).toEqual([1, 1])
    expect(application.getStatus(ACCOUNT_A)).toEqual(DISCONNECTED_STATUS)
    expect(application.getStatus(ACCOUNT_B)).toEqual(DISCONNECTED_STATUS)
  })

  it('constructs productive composition without IPC and forwards native config only on connect', async () => {
    const local = createMemoryLocalEngine()
    const openRequests: NativeMailOpenRequest[] = []
    const ipc = nativeIpcProbe(openRequests)
    const application = createTauriRemoteApplication({
      readRepository: local.readRepository,
      syncPort: local.syncPort,
      nativeMailIpc: ipc,
    })
    expect(openRequests).toEqual([])
    expect(ipc.close).not.toHaveBeenCalled()

    const config = {
      provider: 'imapSmtp' as const,
      host: '127.0.0.1',
      username: 'native-user',
      password: 'BOXPL0T_RA_VERIFY_SECRET_CANARY_84137',
      imapPort: 1143,
      smtpPort: 1025,
    }
    const result = await application.connect({
      accountKey: ACCOUNT_A,
      serviceKey: SERVICE_A,
      config,
    })
    expect(openRequests).toEqual([
      {
        host: config.host,
        username: config.username,
        password: config.password,
        imapPort: config.imapPort,
        smtpPort: config.smtpPort,
      },
    ])
    expect(JSON.stringify(result)).not.toContain(config.password)
    expect(JSON.stringify(application.getStatus(ACCOUNT_A))).not.toContain(
      config.password,
    )
    expect(JSON.stringify(application)).not.toContain(config.password)
  })

  it('rejects productive JMAP explicitly without native IPC fallback', async () => {
    const local = createMemoryLocalEngine()
    const openRequests: NativeMailOpenRequest[] = []
    const ipc = nativeIpcProbe(openRequests)
    const application = createTauriRemoteApplication({
      readRepository: local.readRepository,
      syncPort: local.syncPort,
      nativeMailIpc: ipc,
    })
    await expect(
      application.connect({
        accountKey: ACCOUNT_A,
        serviceKey: SERVICE_A,
        config: {
          provider: 'jmap',
          sessionUrl: 'https://verify.invalid/.well-known/jmap',
        },
      }),
    ).rejects.toMatchObject({ kind: 'remote' })
    expect(openRequests).toEqual([])
    expect(ipc.close).not.toHaveBeenCalled()
    expect(application.getStatus(ACCOUNT_A)).toEqual({
      auth: 'anonymous',
      connectivity: 'offline',
      lastError: 'remote',
    })
  })
})
