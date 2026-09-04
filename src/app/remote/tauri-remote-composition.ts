import type { ReadRepository } from '../../ports/read-repository'
import type { SyncPort } from '../../ports/sync-port'
import { TauriE2eeAdapter } from '../../e2ee/tauri-e2ee-adapter'
import type { E2eePort } from '../../e2ee/port'
import { RemoteError } from '../../remote/errors'
import { ImapSmtpRemoteConnection } from '../../remote/native/imap-smtp-connection'
import { GmailRemoteConnection } from '../../remote/native/gmail-remote-connection'
import type { NativeMailIpcPort } from '../../remote/native/ipc'
import { TauriNativeMailIpc } from '../../remote/native/tauri-native-mail-ipc'
import { createRemoteConnection } from '../../remote/runtime'
import { DefaultRemoteApplication } from './remote-application'
import {
  createRemoteProductRuntime,
  type RemoteProductRuntime,
} from './remote-runtime-composition'
import type { RemoteApplication } from './types'

export type TauriRemoteApplicationDependencies = Readonly<{
  readRepository: ReadRepository
  syncPort: SyncPort
  nativeMailIpc?: NativeMailIpcPort
}>

export type TauriRemoteRuntimeDependencies =
  TauriRemoteApplicationDependencies &
    Readonly<{
      e2eePort?: E2eePort
    }>

function createTauriConnectionFactory(nativeMailIpc: NativeMailIpcPort) {
  return (config: Parameters<typeof createRemoteConnection>[0]) =>
    createRemoteConnection(config, {
      jmap: () => {
        throw new RemoteError(
          'JMAP remains on the explicit Worker lifecycle until migration',
          {
            kind: 'unsupported',
            retry: 'never',
            session: 'keep',
            outcome: 'notApplicable',
          },
        )
      },
      imapSmtp: (nativeConfig) =>
        new ImapSmtpRemoteConnection(nativeConfig, nativeMailIpc),
      gmail: (nativeConfig) =>
        new GmailRemoteConnection(nativeConfig, nativeMailIpc),
    })
}

export function createTauriRemoteApplication(
  dependencies: TauriRemoteApplicationDependencies,
): RemoteApplication {
  const nativeMailIpc = dependencies.nativeMailIpc ?? new TauriNativeMailIpc()
  return new DefaultRemoteApplication({
    readRepository: dependencies.readRepository,
    syncPort: dependencies.syncPort,
    connectionFactory: createTauriConnectionFactory(nativeMailIpc),
  })
}

export function createTauriRemoteRuntime(
  dependencies: TauriRemoteRuntimeDependencies,
): RemoteProductRuntime {
  const nativeMailIpc = dependencies.nativeMailIpc ?? new TauriNativeMailIpc()
  return createRemoteProductRuntime({
    readRepository: dependencies.readRepository,
    syncPort: dependencies.syncPort,
    e2eePort: dependencies.e2eePort ?? new TauriE2eeAdapter(),
    connectionFactory: createTauriConnectionFactory(nativeMailIpc),
  })
}
