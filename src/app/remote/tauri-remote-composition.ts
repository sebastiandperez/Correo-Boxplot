import type { ReadRepository } from '../../ports/read-repository'
import type { SyncPort } from '../../ports/sync-port'
import { RemoteError } from '../../remote/errors'
import { ImapSmtpRemoteConnection } from '../../remote/native/imap-smtp-connection'
import type { NativeMailIpcPort } from '../../remote/native/ipc'
import { TauriNativeMailIpc } from '../../remote/native/tauri-native-mail-ipc'
import { createRemoteConnection } from '../../remote/runtime'
import { DefaultRemoteApplication } from './remote-application'
import type { RemoteApplication } from './types'

export type TauriRemoteApplicationDependencies = Readonly<{
  readRepository: ReadRepository
  syncPort: SyncPort
  nativeMailIpc?: NativeMailIpcPort
}>

export function createTauriRemoteApplication(
  dependencies: TauriRemoteApplicationDependencies,
): RemoteApplication {
  const nativeMailIpc = dependencies.nativeMailIpc ?? new TauriNativeMailIpc()
  return new DefaultRemoteApplication({
    readRepository: dependencies.readRepository,
    syncPort: dependencies.syncPort,
    connectionFactory: (config) =>
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
      }),
  })
}
