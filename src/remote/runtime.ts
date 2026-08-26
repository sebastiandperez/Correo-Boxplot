import { RemoteError } from './errors'
import type { RemoteConnection } from './connection'

export type RemoteProvider = 'jmap' | 'imapSmtp'

export type RemoteConnectionConfig =
  | Readonly<{ provider: 'jmap'; sessionUrl: string }>
  | Readonly<{
      provider: 'imapSmtp'
      host: string
      username: string
      password: string
      imapPort: number
      smtpPort: number
    }>

export type RemoteConnectionFactories = Readonly<{
  jmap: (
    config: Extract<RemoteConnectionConfig, { provider: 'jmap' }>,
  ) => RemoteConnection
}>

export function createRemoteConnection(
  config: RemoteConnectionConfig,
  factories: RemoteConnectionFactories,
): RemoteConnection {
  switch (config.provider) {
    case 'jmap':
      return factories.jmap(config)
    case 'imapSmtp':
      throw new RemoteError('IMAP/SMTP remote adapter is not implemented', {
        kind: 'unsupported',
        retry: 'never',
        session: 'keep',
        outcome: 'notApplicable',
      })
  }
}
