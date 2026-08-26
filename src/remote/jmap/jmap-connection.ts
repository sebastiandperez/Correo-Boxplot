import type { JmapClient } from '../../jmap/client'
import type { RemoteConnection } from '../connection'
import type { RemoteSession } from '../session'
import { remoteAccountIdFromString } from '../types'
import { toRemoteError } from './error-mapper'
import { JmapRemoteMail } from './jmap-remote-mail'
import { JmapSubmission } from './jmap-submission'

export class JmapRemoteConnection implements RemoteConnection {
  constructor(private readonly client: JmapClient) {}

  async open(): Promise<RemoteSession> {
    try {
      const session = await this.client.openSession()
      const capabilitiesByAccount = new Map<string, string[]>()
      for (const [capability, accountId] of Object.entries(
        session.primaryAccounts,
      )) {
        const capabilities = capabilitiesByAccount.get(accountId) ?? []
        capabilities.push(capability)
        capabilitiesByAccount.set(accountId, capabilities)
      }
      const accountIds = [...capabilitiesByAccount.keys()].map(
        remoteAccountIdFromString,
      )
      const primaryAccount = accountIds[0]
      if (primaryAccount === undefined) {
        throw new TypeError('JMAP Session has no primary mail Account')
      }
      return {
        accounts: accountIds.map((id) => ({
          id,
          capabilities: capabilitiesByAccount.get(id) ?? [],
        })),
        mail: new JmapRemoteMail(this.client),
        submission: new JmapSubmission(this.client),
        close: async () => {},
      }
    } catch (error: unknown) {
      throw toRemoteError(error)
    }
  }
}
