import { account, remoteAccountRef } from '../../domain/account'
import type { AccountKey, ServiceKey } from '../../domain/ids'
import type { ReadRepository } from '../../ports/read-repository'
import type { SyncPort } from '../../ports/sync-port'
import { localAccountId, remoteAccountId } from '../../remote/compat/domain-ids'
import { RemoteError } from '../../remote/errors'
import type { RemoteAccountId } from '../../remote/types'
import type { RemoteSession } from '../../remote/session'
import { Coordinator } from '../../sync/coordinator'
import { RemoteApplicationError } from './errors'
import {
  RemoteSessionRegistry,
  type ActiveRemoteAccount,
} from './session-registry'
import type {
  RemoteAccountStatus,
  RemoteApplication,
  RemoteApplicationErrorKind,
  RemoteConnectRequest,
  RemoteConnectResult,
  RemoteConnectionFactory,
} from './types'

const disconnectedStatus: RemoteAccountStatus = {
  auth: 'anonymous',
  connectivity: 'offline',
  lastError: null,
}

type StatusListener = (status: RemoteAccountStatus) => void

export type DefaultRemoteApplicationDependencies = Readonly<{
  readRepository: ReadRepository
  syncPort: SyncPort
  connectionFactory: RemoteConnectionFactory
}>

export class DefaultRemoteApplication implements RemoteApplication {
  private readonly sessions = new RemoteSessionRegistry()
  private readonly generations = new Map<AccountKey, number>()
  private readonly pendingConnects = new Map<AccountKey, number>()
  private readonly statuses = new Map<AccountKey, RemoteAccountStatus>()
  private readonly listeners = new Map<AccountKey, Set<StatusListener>>()
  private disposed = false

  constructor(
    private readonly dependencies: DefaultRemoteApplicationDependencies,
  ) {}

  async connect(request: RemoteConnectRequest): Promise<RemoteConnectResult> {
    this.assertUsable()
    if (
      this.sessions.get(request.accountKey) !== undefined ||
      this.pendingConnects.has(request.accountKey)
    ) {
      throw new RemoteApplicationError('busy')
    }

    const generation = this.nextGeneration(request.accountKey)
    this.pendingConnects.set(request.accountKey, generation)

    let session: RemoteSession | null = null
    try {
      this.publishStatus(request.accountKey, {
        auth: 'authenticating',
        connectivity: 'offline',
        lastError: null,
      })
      this.assertConnectAuthority(request.accountKey, generation)

      const connection = this.dependencies.connectionFactory(request.config)
      this.assertConnectAuthority(request.accountKey, generation)

      session = await connection.open()
      this.assertConnectAuthority(request.accountKey, generation)

      const selectedAccountId = await this.resolveBinding(
        request.accountKey,
        request.serviceKey,
        session,
        generation,
      )
      this.assertConnectAuthority(request.accountKey, generation)

      const active: ActiveRemoteAccount = {
        accountKey: request.accountKey,
        remoteAccountId: selectedAccountId,
        session,
        coordinator: new Coordinator(
          session.mail,
          this.dependencies.syncPort,
          this.dependencies.readRepository,
        ),
        generation,
      }
      this.sessions.set(active)
      this.pendingConnects.delete(request.accountKey)
      this.publishStatus(request.accountKey, {
        auth: 'authenticated',
        connectivity: 'online',
        lastError: null,
      })
      return { accountKey: request.accountKey }
    } catch (error: unknown) {
      if (session !== null) await this.closeQuietly(session)

      if (!this.hasConnectAuthority(request.accountKey, generation)) {
        throw new RemoteApplicationError('cancelled')
      }

      this.pendingConnects.delete(request.accountKey)
      const applicationError = this.classifyConnectError(error)
      this.publishConnectFailure(
        request.accountKey,
        applicationError.kind,
        session !== null,
      )
      throw applicationError
    } finally {
      if (this.pendingConnects.get(request.accountKey) === generation) {
        this.pendingConnects.delete(request.accountKey)
      }
    }
  }

  async disconnect(accountKey: AccountKey): Promise<void> {
    this.assertUsable()
    const active = this.sessions.delete(accountKey)
    const hadPending = this.pendingConnects.delete(accountKey)
    if (active !== undefined || hadPending) this.nextGeneration(accountKey)
    this.publishStatus(accountKey, disconnectedStatus)

    if (active === undefined) return
    try {
      await active.session.close()
    } catch {
      throw new RemoteApplicationError('remote')
    }
  }

  async refreshAccount(accountKey: AccountKey): Promise<void> {
    this.assertUsable()
    const active = this.sessions.get(accountKey)
    if (active === undefined) throw new RemoteApplicationError('notConnected')

    try {
      await active.coordinator.syncAccount(accountKey, active.remoteAccountId)
      if (!this.isCurrent(active)) throw new RemoteApplicationError('cancelled')
      this.publishStatus(accountKey, {
        auth: 'authenticated',
        connectivity: 'online',
        lastError: null,
      })
    } catch (error: unknown) {
      if (!this.isCurrent(active)) throw new RemoteApplicationError('cancelled')
      if (!(error instanceof RemoteError)) {
        this.publishStatus(accountKey, {
          auth: 'authenticated',
          connectivity: 'online',
          lastError: 'local',
        })
        throw new RemoteApplicationError('local')
      }

      const kind = this.remoteErrorKind(error)
      if (error.session === 'expire') {
        this.sessions.delete(accountKey)
        this.nextGeneration(accountKey)
        this.publishStatus(accountKey, this.expiredStatus(error))
        await this.closeQuietly(active.session)
      } else {
        this.publishStatus(accountKey, this.retainedStatus(kind))
      }
      throw new RemoteApplicationError(kind)
    }
  }

  getStatus(accountKey: AccountKey): RemoteAccountStatus {
    return this.copyStatus(this.statuses.get(accountKey) ?? disconnectedStatus)
  }

  subscribe(accountKey: AccountKey, listener: StatusListener): () => void {
    this.assertUsable()
    const accountListeners = this.listeners.get(accountKey) ?? new Set()
    accountListeners.add(listener)
    this.listeners.set(accountKey, accountListeners)
    this.notify(listener, this.getStatus(accountKey))

    let subscribed = true
    return () => {
      if (!subscribed) return
      subscribed = false
      const current = this.listeners.get(accountKey)
      current?.delete(listener)
      if (current?.size === 0) this.listeners.delete(accountKey)
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    const affected = new Set<AccountKey>([
      ...this.pendingConnects.keys(),
      ...this.generations.keys(),
    ])
    const active = this.sessions.drain()
    for (const entry of active) affected.add(entry.accountKey)
    for (const accountKey of affected) {
      this.nextGeneration(accountKey)
      this.statuses.set(accountKey, disconnectedStatus)
    }
    this.pendingConnects.clear()
    this.listeners.clear()
    await Promise.allSettled(active.map((entry) => entry.session.close()))
  }

  private async resolveBinding(
    accountKey: AccountKey,
    serviceKey: ServiceKey,
    session: RemoteSession,
    generation: number,
  ): Promise<RemoteAccountId> {
    const result =
      await this.dependencies.readRepository.readAccount(accountKey)
    this.assertConnectAuthority(accountKey, generation)
    if (!result.ok) throw new RemoteApplicationError('local')

    if (result.value.kind === 'present') {
      const local = result.value.value
      if (local.remoteRef.serviceKey !== serviceKey) {
        throw new RemoteApplicationError('accountMismatch')
      }
      const expected = remoteAccountId(local.remoteRef.jmapAccountId)
      if (!session.accounts.some((descriptor) => descriptor.id === expected)) {
        throw new RemoteApplicationError('accountMismatch')
      }
      return expected
    }

    if (session.accounts.length !== 1) {
      throw new RemoteApplicationError('accountSelectionRequired')
    }
    const selected = session.accounts[0].id
    const registration = account(
      accountKey,
      remoteAccountRef(serviceKey, localAccountId(selected)),
    )
    const write = await this.dependencies.syncPort.registerAccount(registration)
    this.assertConnectAuthority(accountKey, generation)
    if (write.ok) return selected
    if (write.error.kind !== 'conflict') {
      throw new RemoteApplicationError('local')
    }

    const reread =
      await this.dependencies.readRepository.readAccount(accountKey)
    this.assertConnectAuthority(accountKey, generation)
    if (!reread.ok) throw new RemoteApplicationError('local')
    if (
      reread.value.kind === 'present' &&
      reread.value.value.remoteRef.serviceKey === serviceKey &&
      remoteAccountId(reread.value.value.remoteRef.jmapAccountId) === selected
    ) {
      return selected
    }
    throw new RemoteApplicationError('accountMismatch')
  }

  private classifyConnectError(error: unknown): RemoteApplicationError {
    if (error instanceof RemoteApplicationError) return error
    if (!(error instanceof RemoteError)) {
      return new RemoteApplicationError('unexpected')
    }
    return new RemoteApplicationError(this.remoteErrorKind(error))
  }

  private remoteErrorKind(error: RemoteError): RemoteApplicationErrorKind {
    if (error.kind === 'auth') return 'auth'
    if (error.kind === 'network' || error.kind === 'unavailable')
      return 'network'
    return 'remote'
  }

  private publishConnectFailure(
    accountKey: AccountKey,
    kind: RemoteApplicationErrorKind,
    sessionOpened: boolean,
  ): void {
    const connectivity =
      sessionOpened ||
      kind === 'auth' ||
      kind === 'accountMismatch' ||
      kind === 'accountSelectionRequired' ||
      kind === 'local'
        ? 'online'
        : 'offline'
    this.publishStatus(accountKey, {
      auth: 'anonymous',
      connectivity,
      lastError: kind,
    })
  }

  private retainedStatus(
    kind: RemoteApplicationErrorKind,
  ): RemoteAccountStatus {
    return {
      auth: 'authenticated',
      connectivity: kind === 'network' ? 'offline' : 'online',
      lastError: kind,
    }
  }

  private expiredStatus(error: RemoteError): RemoteAccountStatus {
    const kind = this.remoteErrorKind(error)
    return {
      auth: 'expired',
      connectivity: kind === 'network' ? 'offline' : 'online',
      lastError: kind,
    }
  }

  private assertUsable(): void {
    if (this.disposed) throw new RemoteApplicationError('disposed')
  }

  private assertConnectAuthority(
    accountKey: AccountKey,
    generation: number,
  ): void {
    if (!this.hasConnectAuthority(accountKey, generation)) {
      throw new RemoteApplicationError('cancelled')
    }
  }

  private hasConnectAuthority(
    accountKey: AccountKey,
    generation: number,
  ): boolean {
    return (
      !this.disposed &&
      this.generations.get(accountKey) === generation &&
      this.pendingConnects.get(accountKey) === generation
    )
  }

  private isCurrent(entry: ActiveRemoteAccount): boolean {
    return (
      !this.disposed &&
      this.generations.get(entry.accountKey) === entry.generation &&
      this.sessions.get(entry.accountKey) === entry
    )
  }

  private nextGeneration(accountKey: AccountKey): number {
    const next = (this.generations.get(accountKey) ?? 0) + 1
    this.generations.set(accountKey, next)
    return next
  }

  private publishStatus(
    accountKey: AccountKey,
    status: RemoteAccountStatus,
  ): void {
    const current = this.statuses.get(accountKey) ?? disconnectedStatus
    if (
      current.auth === status.auth &&
      current.connectivity === status.connectivity &&
      current.lastError === status.lastError
    ) {
      return
    }
    const stored = this.copyStatus(status)
    this.statuses.set(accountKey, stored)
    for (const listener of this.listeners.get(accountKey) ?? []) {
      this.notify(listener, this.copyStatus(stored))
    }
  }

  private notify(listener: StatusListener, status: RemoteAccountStatus): void {
    try {
      listener(status)
    } catch {
      // A status observer cannot disrupt remote lifecycle ownership.
    }
  }

  private copyStatus(status: RemoteAccountStatus): RemoteAccountStatus {
    return { ...status }
  }

  private async closeQuietly(session: RemoteSession): Promise<void> {
    try {
      await session.close()
    } catch {
      // Cleanup errors never replace the primary lifecycle error.
    }
  }
}
