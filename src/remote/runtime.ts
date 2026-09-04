import { RemoteError } from './errors'
import type { RemoteConnection } from './connection'

export type RemoteProvider = 'jmap' | 'imapSmtp' | 'gmail'

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
  | Readonly<{
      /** Gmail endpoints and OAuth secrets are native provider policy. */
      provider: 'gmail'
      username: string
      credentialRef: string
    }>

export type RemoteConnectionFactories = Readonly<{
  jmap: (
    config: Extract<RemoteConnectionConfig, { provider: 'jmap' }>,
  ) => RemoteConnection
  imapSmtp?: (
    config: Extract<RemoteConnectionConfig, { provider: 'imapSmtp' }>,
  ) => RemoteConnection
  gmail?: (
    config: Extract<RemoteConnectionConfig, { provider: 'gmail' }>,
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
      if (factories.imapSmtp === undefined) {
        throw new RemoteError(
          'IMAP/SMTP connection factory is not configured',
          {
            kind: 'unsupported',
            retry: 'never',
            session: 'keep',
            outcome: 'notApplicable',
          },
        )
      }
      return factories.imapSmtp(config)
    case 'gmail':
      if (factories.gmail === undefined) {
        throw new RemoteError('Gmail connection factory is not configured', {
          kind: 'unsupported',
          retry: 'never',
          session: 'keep',
          outcome: 'notApplicable',
        })
      }
      return factories.gmail(config)
  }
}
