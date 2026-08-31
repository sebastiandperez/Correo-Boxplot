import { describe, expect, it, vi } from 'vitest'

import { createMemoryLocalEngine } from '../../../adapters/memory'
import { account, remoteAccountRef } from '../../../domain/account'
import { email } from '../../../domain/email'
import { startMutationAttempt } from '../../../domain/pending-mutation'
import type { E2eePort } from '../../../e2ee/port'
import { createApplicationContext } from '../../application'
import { localAccountId, localEmailId } from '../../../remote/compat/domain-ids'
import { RemoteError } from '../../../remote/errors'
import { imapAccountId, imapEmailId } from '../../../remote/imap/ids'
import type { RemoteMail } from '../../../remote/mail'
import type { NativeMailIpcPort } from '../../../remote/native/ipc'
import type { RemoteMutationReconciler } from '../../../remote/reconciliation'
import type { RemoteSession } from '../../../remote/session'
import type { Submission } from '../../../remote/submission'
import { FakeRemoteMail, FakeSubmission } from '../../../remote/testing'
import { remoteAccountId } from '../../../remote/compat/domain-ids'
import {
  createTestAccount,
  createTestCollectionSyncCursor,
  createTestEmail,
  createTestEmailMailbox,
  createTestMailbox,
  createTestIdentity,
  createTestSendMutation,
} from '../../../tests/contracts/fixtures'
import { remoteEmailIdFromString } from '../../../remote/types'
import { createRemoteProductRuntime } from '../remote-runtime-composition'
import { createTauriRemoteRuntime } from '../tauri-remote-composition'

function crypto(): E2eePort {
  const unavailable = async () => ({
    ok: false as const,
    error: { kind: 'unexpected' as const },
  })
  return {
    ensureLocalIdentity: unavailable,
    trustPeerPublicKey: unavailable,
    peerKeyStatus: unavailable,
    encryptFor: unavailable,
    decryptFrom: unavailable,
  }
}

async function seedLocal(
  count = 3,
  engine = createMemoryLocalEngine(),
  token = `capability-${Math.random()}`,
) {
  const owner = createTestAccount(token)
  const mailbox = createTestMailbox(owner, 'inbox', { role: 'inbox' })
  const emails = Array.from({ length: count }, (_, index) =>
    createTestEmail(owner, `body-${index}`),
  )
  await engine.syncPort.registerAccount(owner)
  await engine.syncPort.applyCollectionSync({
    kind: 'mailbox',
    mode: 'replace',
    expectedCursor: { kind: 'absent' },
    nextCursor: createTestCollectionSyncCursor(owner, 'mailbox', 'm1'),
    snapshot: [mailbox],
  })
  await engine.syncPort.applyCollectionSync({
    kind: 'email',
    mode: 'replace',
    expectedCursor: { kind: 'absent' },
    nextCursor: createTestCollectionSyncCursor(owner, 'email', 'e1'),
    snapshot: emails.map((value) => ({
      email: value,
      memberships: [createTestEmailMailbox(value, mailbox)],
    })),
  })
  return { engine, owner, mailbox, emails }
}

function session(
  accountId: ReturnType<typeof remoteAccountId>,
  mail: RemoteMail,
  submission: Submission = new FakeSubmission(async () => ({
    kind: 'accepted',
    remoteEmailId: null,
    receiptId: null,
  })),
  reconciler?: RemoteMutationReconciler,
): RemoteSession {
  return {
    accounts: [{ id: accountId, capabilities: ['mail'] }],
    mail,
    submission,
    reconciler,
    close: vi.fn(async () => undefined),
  }
}

function request(setup: Awaited<ReturnType<typeof seedLocal>>) {
  return {
    accountKey: setup.owner.key,
    serviceKey: setup.owner.remoteRef.serviceKey,
    config: {
      provider: 'imapSmtp' as const,
      host: 'localhost',
      username: 'alice',
      password: 'BODY_REMOTE_PASSWORD_CANARY_7419',
      imapPort: 1143,
      smtpPort: 1025,
    },
  }
}

async function expectMaterializationKind(
  operation: Promise<unknown>,
  kind: string,
) {
  await expect(operation).rejects.toMatchObject({
    name: 'BodyMaterializationError',
    kind,
  })
}

describe('account-scoped remote body capability', () => {
  it('shares one connected session across body materialization and mutation execution', async () => {
    const setup = await seedLocal(1)
    const fetchBody = vi.fn(async () => ({
      kind: 'plain' as const,
      text: 'body',
      html: null,
    }))
    const submission = new FakeSubmission(async () => ({
      kind: 'accepted' as const,
      remoteEmailId: remoteEmailIdFromString('sent-through-shared-session'),
      receiptId: 'receipt',
    }))
    const open = vi.fn(async () =>
      session(
        remoteAccountId(setup.owner.remoteRef.jmapAccountId),
        new FakeRemoteMail({ fetchBody }),
        submission,
      ),
    )
    const runtime = createRemoteProductRuntime({
      readRepository: setup.engine.readRepository,
      syncPort: setup.engine.syncPort,
      e2eePort: crypto(),
      connectionFactory: () => ({ open }),
    })
    const mutation = createTestSendMutation(
      setup.owner,
      createTestIdentity(setup.owner, 'shared'),
      'shared-session',
    )
    await setup.engine.syncPort.stageSendMutation(mutation)

    await runtime.remoteApplication.connect(request(setup))
    await expect(
      runtime.bodyMaterializer.materialize(setup.emails[0].id),
    ).resolves.toBe('materialized')
    await expect(
      runtime.mutationRunner.runMutation(setup.owner.key, mutation.mutationId),
    ).resolves.toEqual({ kind: 'confirmed' })

    expect(open).toHaveBeenCalledTimes(1)
    expect(fetchBody).toHaveBeenCalledTimes(1)
    expect(submission.calls).toHaveLength(1)
  })

  it('reconciles an inFlight send through the same account-scoped session capability', async () => {
    const setup = await seedLocal(0)
    const remoteId = remoteEmailIdFromString('authoritative-after-smtp')
    const reconcileSend = vi.fn(async () => ({
      kind: 'applied' as const,
      emailId: remoteId,
    }))
    const submission = new FakeSubmission(async () => ({
      kind: 'accepted' as const,
      remoteEmailId: null,
      receiptId: '<diagnostic-only>',
    }))
    const open = vi.fn(async () =>
      session(
        remoteAccountId(setup.owner.remoteRef.jmapAccountId),
        new FakeRemoteMail(),
        submission,
        {
          reconcileSend,
          reconcileMembership: vi.fn(async () => ({
            kind: 'inconclusive' as const,
          })),
        },
      ),
    )
    const runtime = createRemoteProductRuntime({
      readRepository: setup.engine.readRepository,
      syncPort: setup.engine.syncPort,
      e2eePort: crypto(),
      connectionFactory: () => ({ open }),
    })
    const mutation = createTestSendMutation(
      setup.owner,
      createTestIdentity(setup.owner, 'reconcile-shared-session'),
      'reconcile-shared-session',
    )
    await setup.engine.syncPort.stageSendMutation(mutation)
    await runtime.remoteApplication.connect(request(setup))

    await expect(
      runtime.mutationRunner.runMutation(setup.owner.key, mutation.mutationId),
    ).resolves.toEqual({ kind: 'needsReconciliation' })
    await expect(
      runtime.mutationRunner.runMutation(setup.owner.key, mutation.mutationId),
    ).resolves.toEqual({ kind: 'confirmed' })

    expect(open).toHaveBeenCalledTimes(1)
    expect(submission.calls).toHaveLength(1)
    expect(reconcileSend).toHaveBeenCalledWith({
      remoteAccountId: remoteAccountId(setup.owner.remoteRef.jmapAccountId),
      idempotencyKey: mutation.mutationId,
    })
  })

  it('invalidates reconciliation authority when disconnect wins after lookup starts', async () => {
    const setup = await seedLocal(0)
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const reconcileSend = vi.fn(async () => {
      await gate
      return {
        kind: 'applied' as const,
        emailId: remoteEmailIdFromString('stale-result'),
      }
    })
    const runtime = createRemoteProductRuntime({
      readRepository: setup.engine.readRepository,
      syncPort: setup.engine.syncPort,
      e2eePort: crypto(),
      connectionFactory: () => ({
        open: async () =>
          session(
            remoteAccountId(setup.owner.remoteRef.jmapAccountId),
            new FakeRemoteMail(),
            undefined,
            {
              reconcileSend,
              reconcileMembership: vi.fn(async () => ({
                kind: 'inconclusive' as const,
              })),
            },
          ),
      }),
    })
    const mutation = createTestSendMutation(
      setup.owner,
      createTestIdentity(setup.owner, 'stale-reconcile'),
      'stale-reconcile',
    )
    await setup.engine.syncPort.stageSendMutation(mutation)
    await setup.engine.syncPort.replacePendingMutationIfCurrent(
      mutation,
      startMutationAttempt(mutation),
    )
    await runtime.remoteApplication.connect(request(setup))

    const operation = runtime.mutationRunner.runMutation(
      setup.owner.key,
      mutation.mutationId,
    )
    await vi.waitFor(() => expect(reconcileSend).toHaveBeenCalledTimes(1))
    await runtime.remoteApplication.disconnect(setup.owner.key)
    release()

    await expect(operation).resolves.toEqual({ kind: 'needsReconciliation' })
    await expect(
      setup.engine.readRepository.readPendingMutation(
        setup.owner.key,
        mutation.mutationId,
      ),
    ).resolves.toMatchObject({
      value: { kind: 'present', value: { lifecycle: { status: 'inFlight' } } },
    })
  })

  it('B26-B27 starts no fetch before connect and removes access on disconnect', async () => {
    const setup = await seedLocal()
    const fetchBody = vi.fn(async () => ({
      kind: 'plain' as const,
      text: 'body',
      html: null,
    }))
    const remoteSession = session(
      remoteAccountId(setup.owner.remoteRef.jmapAccountId),
      new FakeRemoteMail({ fetchBody }),
    )
    const open = vi.fn(async () => remoteSession)
    const runtime = createRemoteProductRuntime({
      readRepository: setup.engine.readRepository,
      syncPort: setup.engine.syncPort,
      e2eePort: crypto(),
      connectionFactory: () => ({ open }),
    })

    await expectMaterializationKind(
      runtime.bodyMaterializer.materialize(setup.emails[0].id),
      'notConnected',
    )
    expect(open).not.toHaveBeenCalled()
    await runtime.remoteApplication.connect(request(setup))
    await expect(
      runtime.bodyMaterializer.materialize(setup.emails[0].id),
    ).resolves.toBe('materialized')
    expect(open).toHaveBeenCalledTimes(1)
    await runtime.remoteApplication.disconnect(setup.owner.key)
    await expectMaterializationKind(
      runtime.bodyMaterializer.materialize(setup.emails[1].id),
      'notConnected',
    )
    expect(fetchBody).toHaveBeenCalledTimes(1)
  })

  it('B28 invalidates capability when frozen refresh expires the session', async () => {
    const setup = await seedLocal()
    const failure = new RemoteError('expired', {
      kind: 'auth',
      retry: 'never',
      session: 'expire',
      outcome: 'notApplicable',
    })
    const mail = new FakeRemoteMail({
      syncIdentities: async () => Promise.reject(failure),
    })
    const runtime = createRemoteProductRuntime({
      readRepository: setup.engine.readRepository,
      syncPort: setup.engine.syncPort,
      e2eePort: crypto(),
      connectionFactory: () => ({
        open: async () =>
          session(remoteAccountId(setup.owner.remoteRef.jmapAccountId), mail),
      }),
    })
    await runtime.remoteApplication.connect(request(setup))
    await expect(
      runtime.remoteApplication.refreshAccount(setup.owner.key),
    ).rejects.toMatchObject({ kind: 'auth' })
    await expectMaterializationKind(
      runtime.bodyMaterializer.materialize(setup.emails[0].id),
      'notConnected',
    )
  })

  it.each(['disconnect', 'dispose'] as const)(
    'B29-B30 prevents cache after %s during an already-started fetch',
    async (lifecycle) => {
      const setup = await seedLocal()
      let resolve!: (value: { kind: 'plain'; text: string; html: null }) => void
      const pending = new Promise<{
        kind: 'plain'
        text: string
        html: null
      }>((done) => (resolve = done))
      const fetchBody = vi.fn(async () => pending)
      const mail = new FakeRemoteMail({ fetchBody })
      const runtime = createRemoteProductRuntime({
        readRepository: setup.engine.readRepository,
        syncPort: setup.engine.syncPort,
        e2eePort: crypto(),
        connectionFactory: () => ({
          open: async () =>
            session(remoteAccountId(setup.owner.remoteRef.jmapAccountId), mail),
        }),
      })
      await runtime.remoteApplication.connect(request(setup))
      const operation = runtime.bodyMaterializer.materialize(setup.emails[0].id)
      await vi.waitFor(() => expect(fetchBody).toHaveBeenCalled())
      if (lifecycle === 'disconnect') {
        await runtime.remoteApplication.disconnect(setup.owner.key)
      } else {
        await runtime.remoteApplication.dispose()
      }
      resolve({ kind: 'plain', text: 'stale', html: null })
      await expectMaterializationKind(operation, 'cancelled')
      await expect(
        setup.engine.readRepository.readEmailBody(setup.emails[0].id),
      ).resolves.toMatchObject({ value: { kind: 'notCached' } })
    },
  )

  it('a session-expiring body error fails closed for future body access', async () => {
    const setup = await seedLocal(2)
    const fetchBody = vi.fn(async () => {
      throw new RemoteError('expired', {
        kind: 'auth',
        retry: 'never',
        session: 'expire',
        outcome: 'notApplicable',
      })
    })
    const runtime = createRemoteProductRuntime({
      readRepository: setup.engine.readRepository,
      syncPort: setup.engine.syncPort,
      e2eePort: crypto(),
      connectionFactory: () => ({
        open: async () =>
          session(
            remoteAccountId(setup.owner.remoteRef.jmapAccountId),
            new FakeRemoteMail({ fetchBody }),
          ),
      }),
    })
    await runtime.remoteApplication.connect(request(setup))
    await expectMaterializationKind(
      runtime.bodyMaterializer.materialize(setup.emails[0].id),
      'remote',
    )
    await expectMaterializationKind(
      runtime.bodyMaterializer.materialize(setup.emails[1].id),
      'notConnected',
    )
    expect(fetchBody).toHaveBeenCalledTimes(1)
  })

  it('B24 retains the active capability after a session-keep remote error', async () => {
    const setup = await seedLocal(2)
    const fetchBody = vi
      .fn()
      .mockRejectedValueOnce(
        new RemoteError('temporary', {
          kind: 'network',
          retry: 'safeBackoff',
          session: 'keep',
          outcome: 'knownNotApplied',
        }),
      )
      .mockResolvedValueOnce({ kind: 'plain', text: 'recovered', html: null })
    const runtime = createRemoteProductRuntime({
      readRepository: setup.engine.readRepository,
      syncPort: setup.engine.syncPort,
      e2eePort: crypto(),
      connectionFactory: () => ({
        open: async () =>
          session(
            remoteAccountId(setup.owner.remoteRef.jmapAccountId),
            new FakeRemoteMail({ fetchBody }),
          ),
      }),
    })
    await runtime.remoteApplication.connect(request(setup))
    await expectMaterializationKind(
      runtime.bodyMaterializer.materialize(setup.emails[0].id),
      'remote',
    )
    await expect(
      runtime.bodyMaterializer.materialize(setup.emails[1].id),
    ).resolves.toBe('materialized')
    expect(fetchBody).toHaveBeenCalledTimes(2)
  })

  it('shares session-expiry authority between mutation execution and body access', async () => {
    const setup = await seedLocal(1)
    const failure = new RemoteError('expired submit', {
      kind: 'auth',
      retry: 'never',
      session: 'expire',
      outcome: 'knownNotApplied',
    })
    const submission = new FakeSubmission(async () => Promise.reject(failure))
    const runtime = createRemoteProductRuntime({
      readRepository: setup.engine.readRepository,
      syncPort: setup.engine.syncPort,
      e2eePort: crypto(),
      connectionFactory: () => ({
        open: async () =>
          session(
            remoteAccountId(setup.owner.remoteRef.jmapAccountId),
            new FakeRemoteMail(),
            submission,
          ),
      }),
    })
    const mutation = createTestSendMutation(
      setup.owner,
      createTestIdentity(setup.owner, 'expire'),
      'expire',
    )
    await setup.engine.syncPort.stageSendMutation(mutation)
    await runtime.remoteApplication.connect(request(setup))

    await expect(
      runtime.mutationRunner.runMutation(setup.owner.key, mutation.mutationId),
    ).resolves.toEqual({ kind: 'failedTerminal' })
    await expectMaterializationKind(
      runtime.bodyMaterializer.materialize(setup.emails[0].id),
      'notConnected',
    )
  })

  it('B31 keeps body authority and cancellation scoped to each account', async () => {
    const engine = createMemoryLocalEngine()
    const setupA = await seedLocal(1, engine, 'capability-account-a')
    const setupB = await seedLocal(1, engine, 'capability-account-b')
    const fetchA = vi.fn(async () => ({
      kind: 'plain' as const,
      text: 'A',
      html: null,
    }))
    const fetchB = vi.fn(async () => ({
      kind: 'plain' as const,
      text: 'B',
      html: null,
    }))
    const runtime = createRemoteProductRuntime({
      readRepository: engine.readRepository,
      syncPort: engine.syncPort,
      e2eePort: crypto(),
      connectionFactory: (config) => ({
        open: async () => {
          const selected =
            config.provider === 'imapSmtp' && config.username === 'account-b'
              ? { setup: setupB, fetch: fetchB }
              : { setup: setupA, fetch: fetchA }
          return session(
            remoteAccountId(selected.setup.owner.remoteRef.jmapAccountId),
            new FakeRemoteMail({ fetchBody: selected.fetch }),
          )
        },
      }),
    })
    await runtime.remoteApplication.connect(request(setupA))
    await runtime.remoteApplication.connect({
      ...request(setupB),
      config: { ...request(setupB).config, username: 'account-b' },
    })
    await runtime.remoteApplication.disconnect(setupB.owner.key)
    await expect(
      runtime.bodyMaterializer.materialize(setupA.emails[0].id),
    ).resolves.toBe('materialized')
    await expectMaterializationKind(
      runtime.bodyMaterializer.materialize(setupB.emails[0].id),
      'notConnected',
    )
    expect(fetchA).toHaveBeenCalledTimes(1)
    expect(fetchB).not.toHaveBeenCalled()
  })

  it('keeps reconciliation capability and same-looking mutation evidence account scoped', async () => {
    const engine = createMemoryLocalEngine()
    const setupA = await seedLocal(0, engine, 'reconcile-account-a')
    const setupB = await seedLocal(0, engine, 'reconcile-account-b')
    const reconcileA = vi.fn(async () => ({
      kind: 'applied' as const,
      emailId: remoteEmailIdFromString('same-looking-remote-email'),
    }))
    const reconcileB = vi.fn(async () => ({
      kind: 'applied' as const,
      emailId: remoteEmailIdFromString('same-looking-remote-email'),
    }))
    const runtime = createRemoteProductRuntime({
      readRepository: engine.readRepository,
      syncPort: engine.syncPort,
      e2eePort: crypto(),
      connectionFactory: (config) => ({
        open: async () => {
          const selected =
            config.provider === 'imapSmtp' && config.username === 'account-b'
              ? { setup: setupB, reconcile: reconcileB }
              : { setup: setupA, reconcile: reconcileA }
          return session(
            remoteAccountId(selected.setup.owner.remoteRef.jmapAccountId),
            new FakeRemoteMail(),
            undefined,
            {
              reconcileSend: selected.reconcile,
              reconcileMembership: vi.fn(async () => ({
                kind: 'inconclusive' as const,
              })),
            },
          )
        },
      }),
    })
    const mutationA = createTestSendMutation(
      setupA.owner,
      createTestIdentity(setupA.owner, 'same-looking'),
      'same-looking',
    )
    const mutationB = createTestSendMutation(
      setupB.owner,
      createTestIdentity(setupB.owner, 'same-looking'),
      'same-looking',
    )
    await engine.syncPort.stageSendMutation(mutationA)
    await engine.syncPort.stageSendMutation(mutationB)
    await engine.syncPort.replacePendingMutationIfCurrent(
      mutationA,
      startMutationAttempt(mutationA),
    )
    await engine.syncPort.replacePendingMutationIfCurrent(
      mutationB,
      startMutationAttempt(mutationB),
    )

    await runtime.remoteApplication.connect(request(setupA))
    await runtime.remoteApplication.connect({
      ...request(setupB),
      config: { ...request(setupB).config, username: 'account-b' },
    })
    await runtime.remoteApplication.disconnect(setupB.owner.key)

    await expect(
      runtime.mutationRunner.runMutation(
        setupA.owner.key,
        mutationA.mutationId,
      ),
    ).resolves.toEqual({ kind: 'confirmed' })
    await expect(
      runtime.mutationRunner.runMutation(
        setupB.owner.key,
        mutationB.mutationId,
      ),
    ).resolves.toEqual({ kind: 'needsReconciliation' })
    expect(reconcileA).toHaveBeenCalledWith({
      remoteAccountId: remoteAccountId(setupA.owner.remoteRef.jmapAccountId),
      idempotencyKey: mutationA.mutationId,
    })
    expect(reconcileB).not.toHaveBeenCalled()
  })
})

class NativeBodyIpc implements NativeMailIpcPort {
  readonly open = vi.fn(async () => ({
    sessionId: 'native-body-session',
    authenticatedUser: 'alice@boxplot.test',
  }))
  readonly close = vi.fn(async () => undefined)
  readonly fetchBody = vi.fn(async () => ({
    kind: 'plain' as const,
    text: 'native body',
    html: null,
  }))
  async listMailboxes() {
    return []
  }
  async snapshotMailbox(): Promise<never> {
    throw new Error('unused')
  }
  async fetchAttachments() {
    return []
  }
  async findMessageId(): Promise<{ kind: 'notFound' }> {
    throw new Error('unused')
  }
  async storeFlags() {}
  async move(): Promise<never> {
    throw new Error('unused')
  }
  async smtpSubmit(): Promise<never> {
    throw new Error('unused')
  }
}

describe('productive Tauri remote body composition', () => {
  it('B25 reuses the exact native session opened by RemoteApplication', async () => {
    const engine = createMemoryLocalEngine()
    const ipc = new NativeBodyIpc()
    const accountId = imapAccountId('alice@boxplot.test')
    const baseAccount = createTestAccount('native-body')
    const owner = account(
      baseAccount.key,
      remoteAccountRef(
        baseAccount.remoteRef.serviceKey,
        localAccountId(accountId),
      ),
    )
    const mailbox = createTestMailbox(owner, 'inbox', { role: 'inbox' })
    const remoteId = imapEmailId({ mailbox: 'INBOX', uidValidity: 7, uid: 42 })
    const baseEmail = createTestEmail(owner, 'native-body')
    const message = email({
      ...baseEmail,
      id: localEmailId(owner.key, remoteId),
    })
    await engine.syncPort.registerAccount(owner)
    await engine.syncPort.applyCollectionSync({
      kind: 'mailbox',
      mode: 'replace',
      expectedCursor: { kind: 'absent' },
      nextCursor: createTestCollectionSyncCursor(owner, 'mailbox', 'm1'),
      snapshot: [mailbox],
    })
    await engine.syncPort.applyCollectionSync({
      kind: 'email',
      mode: 'replace',
      expectedCursor: { kind: 'absent' },
      nextCursor: createTestCollectionSyncCursor(owner, 'email', 'e1'),
      snapshot: [
        {
          email: message,
          memberships: [createTestEmailMailbox(message, mailbox)],
        },
      ],
    })
    const runtime = createTauriRemoteRuntime({
      readRepository: engine.readRepository,
      syncPort: engine.syncPort,
      nativeMailIpc: ipc,
      e2eePort: crypto(),
    })

    expect(ipc.open).not.toHaveBeenCalled()
    await runtime.remoteApplication.connect({
      accountKey: owner.key,
      serviceKey: owner.remoteRef.serviceKey,
      config: {
        provider: 'imapSmtp',
        host: 'localhost',
        username: 'alice@boxplot.test',
        password: 'BODY_REMOTE_PASSWORD_CANARY_7419',
        imapPort: 1143,
        smtpPort: 1025,
      },
    })
    expect(ipc.open).toHaveBeenCalledTimes(1)
    await runtime.bodyMaterializer.materialize(message.id)
    expect(ipc.open).toHaveBeenCalledTimes(1)
    expect(ipc.fetchBody).toHaveBeenCalledWith({
      sessionId: 'native-body-session',
      mailbox: 'INBOX',
      uidValidity: 7,
      uid: 42,
    })

    const context = createApplicationContext({
      readRepository: engine.readRepository,
      syncPort: engine.syncPort,
      localChangeSource: engine.localChangeSource,
      remoteApplication: runtime.remoteApplication,
      bodyMaterializer: runtime.bodyMaterializer,
      mutationRunner: runtime.mutationRunner,
    })
    expect(context.bodyMaterializer).toBe(runtime.bodyMaterializer)
    expect(context.mutationRunner).toBe(runtime.mutationRunner)
    expect(context.remoteApplication).toBe(runtime.remoteApplication)
    expect(context.readRepository).toBe(engine.readRepository)
    expect(context.syncPort).toBe(engine.syncPort)
    expect(context.localChangeSource).toBe(engine.localChangeSource)
  })
})
