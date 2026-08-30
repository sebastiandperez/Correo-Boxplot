import type { AccountKey, ServiceKey } from '../../domain/ids'
import type { RemoteConnection } from '../../remote/connection'
import type { RemoteConnectionConfig } from '../../remote/runtime'

export type RemoteAuthState =
  'anonymous' | 'authenticating' | 'authenticated' | 'expired'

export type RemoteConnectivityState = 'online' | 'offline'

export type RemoteApplicationErrorKind =
  | 'auth'
  | 'network'
  | 'remote'
  | 'local'
  | 'accountMismatch'
  | 'accountSelectionRequired'
  | 'notConnected'
  | 'busy'
  | 'cancelled'
  | 'disposed'
  | 'unexpected'

export type RemoteAccountStatus = Readonly<{
  auth: RemoteAuthState
  connectivity: RemoteConnectivityState
  lastError: RemoteApplicationErrorKind | null
}>

export type RemoteConnectRequest = Readonly<{
  accountKey: AccountKey
  serviceKey: ServiceKey
  config: RemoteConnectionConfig
}>

export type RemoteConnectResult = Readonly<{
  accountKey: AccountKey
}>

export type RemoteConnectionFactory = (
  config: RemoteConnectionConfig,
) => RemoteConnection

export interface RemoteApplication {
  connect(request: RemoteConnectRequest): Promise<RemoteConnectResult>
  disconnect(accountKey: AccountKey): Promise<void>
  refreshAccount(accountKey: AccountKey): Promise<void>
  getStatus(accountKey: AccountKey): RemoteAccountStatus
  subscribe(
    accountKey: AccountKey,
    listener: (status: RemoteAccountStatus) => void,
  ): () => void
  dispose(): Promise<void>
}
