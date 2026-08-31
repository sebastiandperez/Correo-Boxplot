import type { AccountKey } from '../../domain/ids'
import type { E2eePort } from '../../e2ee/port'
import type { ReadRepository } from '../../ports/read-repository'
import type { SyncPort } from '../../ports/sync-port'
import { remoteAccountId } from '../../remote/compat/domain-ids'
import type { RemoteConnection } from '../../remote/connection'
import type { RemoteSession } from '../../remote/session'
import { DefaultMutationRunner, type MutationRunner } from '../../outbox'
import {
  DefaultBodyMaterializer,
  type BodyMaterializer,
} from '../../sync/body-materializer'
import { DefaultRemoteApplication } from './remote-application'
import { RemoteBodyCapabilityStore } from './remote-body-source'
import type {
  RemoteApplication,
  RemoteConnectRequest,
  RemoteConnectResult,
  RemoteConnectionFactory,
} from './types'

export type RemoteProductRuntime = Readonly<{
  remoteApplication: RemoteApplication
  bodyMaterializer: BodyMaterializer
  mutationRunner: MutationRunner
}>

export type RemoteProductRuntimeDependencies = Readonly<{
  readRepository: ReadRepository
  syncPort: SyncPort
  e2eePort: E2eePort
  connectionFactory: RemoteConnectionFactory
}>

type ConnectAttempt = {
  readonly accountKey: AccountKey
  readonly generation: number
  session: RemoteSession | null
}

class BodyCapableRemoteApplication implements RemoteApplication {
  private currentAttempt: ConnectAttempt | null = null
  private disposed = false

  constructor(
    private readonly delegate: RemoteApplication,
    private readonly capabilities: RemoteBodyCapabilityStore,
    private readonly readRepository: ReadRepository,
  ) {}

  async connect(request: RemoteConnectRequest): Promise<RemoteConnectResult> {
    const attempt: ConnectAttempt = {
      accountKey: request.accountKey,
      generation: this.capabilities.generation(request.accountKey),
      session: null,
    }
    this.currentAttempt = attempt
    let pending: Promise<RemoteConnectResult>
    try {
      pending = this.delegate.connect(request)
    } finally {
      this.currentAttempt = null
    }

    const result = await pending
    await this.activateAfterBinding(attempt)
    return result
  }

  trackConnection(connection: RemoteConnection): RemoteConnection {
    const attempt = this.currentAttempt
    if (attempt === null) return connection
    return {
      open: async () => {
        const session = await connection.open()
        attempt.session = session
        return session
      },
    }
  }

  async disconnect(accountKey: AccountKey): Promise<void> {
    this.capabilities.invalidate(accountKey)
    await this.delegate.disconnect(accountKey)
  }

  async refreshAccount(accountKey: AccountKey): Promise<void> {
    try {
      await this.delegate.refreshAccount(accountKey)
    } catch (error: unknown) {
      if (this.delegate.getStatus(accountKey).auth !== 'authenticated') {
        this.capabilities.invalidate(accountKey)
      }
      throw error
    }
  }

  getStatus(accountKey: AccountKey) {
    return this.delegate.getStatus(accountKey)
  }

  subscribe(
    accountKey: AccountKey,
    listener: Parameters<RemoteApplication['subscribe']>[1],
  ): () => void {
    return this.delegate.subscribe(accountKey, listener)
  }

  async dispose(): Promise<void> {
    if (!this.disposed) {
      this.disposed = true
      this.capabilities.dispose()
    }
    await this.delegate.dispose()
  }

  private async activateAfterBinding(attempt: ConnectAttempt): Promise<void> {
    if (
      this.disposed ||
      attempt.session === null ||
      this.delegate.getStatus(attempt.accountKey).auth !== 'authenticated'
    ) {
      return
    }
    const local = await this.readRepository.readAccount(attempt.accountKey)
    if (
      !local.ok ||
      local.value.kind !== 'present' ||
      this.delegate.getStatus(attempt.accountKey).auth !== 'authenticated'
    ) {
      return
    }
    const selected = remoteAccountId(local.value.value.remoteRef.jmapAccountId)
    if (!attempt.session.accounts.some((value) => value.id === selected)) return
    this.capabilities.activate(
      {
        accountKey: attempt.accountKey,
        remoteAccountId: selected,
        mail: attempt.session.mail,
        submission: attempt.session.submission,
      },
      attempt.generation,
    )
  }
}

export function createRemoteProductRuntime(
  dependencies: RemoteProductRuntimeDependencies,
): RemoteProductRuntime {
  const capabilities = new RemoteBodyCapabilityStore()
  let trackConnection = (connection: RemoteConnection): RemoteConnection =>
    connection
  const core = new DefaultRemoteApplication({
    readRepository: dependencies.readRepository,
    syncPort: dependencies.syncPort,
    connectionFactory: (config) =>
      trackConnection(dependencies.connectionFactory(config)),
  })
  const application = new BodyCapableRemoteApplication(
    core,
    capabilities,
    dependencies.readRepository,
  )
  trackConnection = (connection) => application.trackConnection(connection)
  capabilities.setStatusAuthority(
    (accountKey) => application.getStatus(accountKey).auth === 'authenticated',
  )
  return {
    remoteApplication: application,
    bodyMaterializer: new DefaultBodyMaterializer({
      readRepository: dependencies.readRepository,
      syncPort: dependencies.syncPort,
      remoteBodySource: capabilities,
      e2eePort: dependencies.e2eePort,
    }),
    mutationRunner: new DefaultMutationRunner({
      readRepository: dependencies.readRepository,
      syncPort: dependencies.syncPort,
      remoteMutationSource: capabilities,
      e2eePort: dependencies.e2eePort,
      refreshAccount: (accountKey) => application.refreshAccount(accountKey),
    }),
  }
}
