import type { RemoteConnection } from '../connection'
import { ImapMutationReconciler, ImapRemoteMail } from '../imap'
import { imapAccountId } from '../imap/ids'
import type { RemoteConnectionConfig } from '../runtime'
import type { RemoteSession } from '../session'
import { SmtpSubmission } from '../smtp'
import { toNativeRemoteError } from './error-mapper'
import type { NativeMailIpcPort } from './ipc'

type GmailConfig = Extract<RemoteConnectionConfig, { provider: 'gmail' }>

export class GmailRemoteConnection implements RemoteConnection {
  private config: GmailConfig | null

  constructor(
    config: GmailConfig,
    private readonly ipc: NativeMailIpcPort,
  ) {
    this.config = config
  }

  async open(): Promise<RemoteSession> {
    try {
      const config = this.config
      if (config === null) throw new TypeError('Gmail connection is single-use')
      this.config = null
      const openGoogle = this.ipc.openGoogle
      if (openGoogle === undefined) {
        throw new TypeError('Google native mail IPC unavailable')
      }
      const opened = await openGoogle.call(this.ipc, {
        username: config.username,
        credentialRef: config.credentialRef,
      })
      const accountId = imapAccountId(opened.authenticatedUser)
      let closed = false
      return {
        accounts: [{ id: accountId, capabilities: ['mail', 'submission'] }],
        mail: new ImapRemoteMail(
          this.ipc,
          opened.sessionId,
          opened.authenticatedUser,
          'gmailDogfood',
        ),
        submission: new SmtpSubmission(this.ipc, opened.sessionId, accountId),
        reconciler: new ImapMutationReconciler(
          this.ipc,
          opened.sessionId,
          accountId,
        ),
        close: async () => {
          if (closed) return
          closed = true
          await this.ipc.close(opened.sessionId)
        },
      }
    } catch (error: unknown) {
      throw toNativeRemoteError(error)
    }
  }
}
