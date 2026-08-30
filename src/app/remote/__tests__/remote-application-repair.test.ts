import { describe, expect, it, vi } from 'vitest'

import { createMemoryLocalEngine } from '../../../adapters/memory'
import { accountKeyFromString, serviceKeyFromString } from '../../../domain/ids'
import type { SyncPort } from '../../../ports/sync-port'
import type { RemoteConnection } from '../../../remote/connection'
import type { RemoteSession } from '../../../remote/session'
import type { RemoteMail } from '../../../remote/mail'
import { FakeRemoteMail, FakeSubmission } from '../../../remote/testing'
import { remoteAccountIdFromString } from '../../../remote/types'
import { DefaultRemoteApplication } from '../remote-application'
import type { RemoteConnectRequest } from '../types'

const accountKeyA = accountKeyFromString('repair-account-a')
const accountKeyB = accountKeyFromString('repair-account-b')
const serviceKeyA = serviceKeyFromString('repair-service-a')
const serviceKeyB = serviceKeyFromString('repair-service-b')
const remoteIdA = remoteAccountIdFromString('repair-remote-a')
const remoteIdB = remoteAccountIdFromString('repair-remote-b')

const requestA: RemoteConnectRequest = {
  accountKey: accountKeyA,
  serviceKey: serviceKeyA,
  config: {
    provider: 'imapSmtp',
    host: 'localhost',
    username: 'alice',
    password: 'secret-a',
    imapPort: 1143,
    smtpPort: 1025,
  },
}

const requestB: RemoteConnectRequest = {
  accountKey: accountKeyB,
  serviceKey: serviceKeyB,
  config: {
    provider: 'imapSmtp',
    host: 'localhost',
    username: 'bob',
    password: 'secret-b',
    imapPort: 1143,
    smtpPort: 1025,
  },
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function session(
  remoteId = remoteIdA,
  options: { mail?: RemoteMail; close?: () => Promise<void> } = {},
): RemoteSession {
  return {
    accounts: [{ id: remoteId, capabilities: [] }],
    mail: options.mail ?? new FakeRemoteMail(),
    submission: new FakeSubmission(async () => ({
      kind: 'accepted',
      remoteEmailId: null,
      receiptId: null,
    })),
    close: options.close ?? vi.fn(async () => undefined),
  }
}

async function expectCancelled(operation: Promise<unknown>): Promise<void> {
  await expect(operation).rejects.toMatchObject({ kind: 'cancelled' })
}

describe('RemoteApplication reentrant lifecycle repair', () => {
  it('RR01 prevents factory/open/register after authenticating listener disconnects', async () => {
    const local = createMemoryLocalEngine()
    const opened = vi.fn(async () => session())
    const factory = vi.fn((): RemoteConnection => ({ open: opened }))
    const register = vi.spyOn(local.syncPort, 'registerAccount')
    const application = new DefaultRemoteApplication({
      readRepository: local.readRepository,
      syncPort: local.syncPort,
      connectionFactory: factory,
    })
    const statuses: string[] = []
    application.subscribe(accountKeyA, (status) => {
      statuses.push(status.auth)
      if (status.auth === 'authenticating')
        void application.disconnect(accountKeyA)
    })

    await expectCancelled(application.connect(requestA))

    expect(statuses).toEqual(['anonymous', 'authenticating', 'anonymous'])
    expect(factory).not.toHaveBeenCalled()
    expect(opened).not.toHaveBeenCalled()
    expect(register).not.toHaveBeenCalled()
    expect(application.getStatus(accountKeyA)).toEqual({
      auth: 'anonymous',
      connectivity: 'offline',
      lastError: null,
    })
  })

  it('RR02 prevents factory/open/register after authenticating listener disposes', async () => {
    const local = createMemoryLocalEngine()
    const opened = vi.fn(async () => session())
    const factory = vi.fn((): RemoteConnection => ({ open: opened }))
    const register = vi.spyOn(local.syncPort, 'registerAccount')
    const application = new DefaultRemoteApplication({
      readRepository: local.readRepository,
      syncPort: local.syncPort,
      connectionFactory: factory,
    })
    application.subscribe(accountKeyA, (status) => {
      if (status.auth === 'authenticating') void application.dispose()
    })

    await expectCancelled(application.connect(requestA))

    expect(factory).not.toHaveBeenCalled()
    expect(opened).not.toHaveBeenCalled()
    expect(register).not.toHaveBeenCalled()
    await expect(application.connect(requestA)).rejects.toMatchObject({
      kind: 'disposed',
    })
  })

  it('RR03 prevents open when the factory synchronously disconnects', async () => {
    const local = createMemoryLocalEngine()
    const opened = vi.fn(async () => session())
    const reference: { current: DefaultRemoteApplication | null } = {
      current: null,
    }
    const factory = vi.fn((): RemoteConnection => {
      if (reference.current === null) throw new Error('missing application')
      void reference.current.disconnect(accountKeyA)
      return { open: opened }
    })
    const application = new DefaultRemoteApplication({
      readRepository: local.readRepository,
      syncPort: local.syncPort,
      connectionFactory: factory,
    })
    reference.current = application

    await expectCancelled(application.connect(requestA))

    expect(factory).toHaveBeenCalledOnce()
    expect(opened).not.toHaveBeenCalled()
  })

  it('RR04 prevents open when the factory synchronously disposes', async () => {
    const local = createMemoryLocalEngine()
    const opened = vi.fn(async () => session())
    const reference: { current: DefaultRemoteApplication | null } = {
      current: null,
    }
    const factory = vi.fn((): RemoteConnection => {
      if (reference.current === null) throw new Error('missing application')
      void reference.current.dispose()
      return { open: opened }
    })
    const application = new DefaultRemoteApplication({
      readRepository: local.readRepository,
      syncPort: local.syncPort,
      connectionFactory: factory,
    })
    reference.current = application

    await expectCancelled(application.connect(requestA))

    expect(factory).toHaveBeenCalledOnce()
    expect(opened).not.toHaveBeenCalled()
  })

  it('RR05 preserves a normal one-open connection and performs no implicit sync', async () => {
    const local = createMemoryLocalEngine()
    const mail = new FakeRemoteMail()
    const sync = vi.spyOn(mail, 'syncIdentities')
    const opened = vi.fn(async () => session(remoteIdA, { mail }))
    const application = new DefaultRemoteApplication({
      readRepository: local.readRepository,
      syncPort: local.syncPort,
      connectionFactory: () => ({ open: opened }),
    })
    const statuses: string[] = []
    application.subscribe(accountKeyA, (status) => statuses.push(status.auth))

    await expect(application.connect(requestA)).resolves.toEqual({
      accountKey: accountKeyA,
    })

    expect(opened).toHaveBeenCalledOnce()
    expect(sync).not.toHaveBeenCalled()
    expect(statuses).toEqual(['anonymous', 'authenticating', 'authenticated'])
  })

  it('RR06 closes exactly once when disconnect occurs after open started', async () => {
    const local = createMemoryLocalEngine()
    const gate = deferred<RemoteSession>()
    const late = session()
    const close = vi.spyOn(late, 'close')
    const application = new DefaultRemoteApplication({
      readRepository: local.readRepository,
      syncPort: local.syncPort,
      connectionFactory: () => ({ open: () => gate.promise }),
    })
    const connecting = application.connect(requestA)

    await application.disconnect(accountKeyA)
    gate.resolve(late)

    await expectCancelled(connecting)
    expect(close).toHaveBeenCalledOnce()
  })

  it('RR07 closes exactly once when dispose occurs after open started', async () => {
    const local = createMemoryLocalEngine()
    const gate = deferred<RemoteSession>()
    const late = session()
    const close = vi.spyOn(late, 'close')
    const application = new DefaultRemoteApplication({
      readRepository: local.readRepository,
      syncPort: local.syncPort,
      connectionFactory: () => ({ open: () => gate.promise }),
    })
    const connecting = application.connect(requestA)

    await application.dispose()
    gate.resolve(late)

    await expectCancelled(connecting)
    expect(close).toHaveBeenCalledOnce()
  })

  it('RR08 allows an in-flight registration commit but prevents activation', async () => {
    const local = createMemoryLocalEngine()
    const gate = deferred<Awaited<ReturnType<SyncPort['registerAccount']>>>()
    const registerAccount = vi.fn(async (value) => {
      await local.syncPort.registerAccount(value)
      return gate.promise
    })
    const late = session()
    const close = vi.spyOn(late, 'close')
    const application = new DefaultRemoteApplication({
      readRepository: local.readRepository,
      syncPort: { ...local.syncPort, registerAccount },
      connectionFactory: () => ({ open: async () => late }),
    })
    const connecting = application.connect(requestA)
    await vi.waitFor(() => expect(registerAccount).toHaveBeenCalledOnce())

    await application.disconnect(accountKeyA)
    gate.resolve({ ok: true, value: undefined })

    await expectCancelled(connecting)
    expect(close).toHaveBeenCalledOnce()
    expect(application.getStatus(accountKeyA).auth).toBe('anonymous')
  })

  it('RR09 isolates observer exceptions from normal connect lifecycle', async () => {
    const local = createMemoryLocalEngine()
    const application = new DefaultRemoteApplication({
      readRepository: local.readRepository,
      syncPort: local.syncPort,
      connectionFactory: () => ({ open: async () => session() }),
    })
    application.subscribe(accountKeyA, (status) => {
      if (status.auth === 'authenticating') throw new Error('observer')
    })

    await expect(application.connect(requestA)).resolves.toEqual({
      accountKey: accountKeyA,
    })
    expect(application.getStatus(accountKeyA).auth).toBe('authenticated')
  })

  it('RR10 keeps account B active when account A cancels reentrantly', async () => {
    const local = createMemoryLocalEngine()
    const factory = vi.fn((config: RemoteConnectRequest['config']) => ({
      open: async () =>
        session(
          config.provider === 'imapSmtp' && config.username === 'bob'
            ? remoteIdB
            : remoteIdA,
        ),
    }))
    const application = new DefaultRemoteApplication({
      readRepository: local.readRepository,
      syncPort: local.syncPort,
      connectionFactory: factory,
    })
    await application.connect(requestB)
    application.subscribe(accountKeyA, (status) => {
      if (status.auth === 'authenticating')
        void application.disconnect(accountKeyA)
    })

    await expectCancelled(application.connect(requestA))

    expect(factory).toHaveBeenCalledTimes(1)
    expect(application.getStatus(accountKeyA).auth).toBe('anonymous')
    expect(application.getStatus(accountKeyB).auth).toBe('authenticated')
  })
})
