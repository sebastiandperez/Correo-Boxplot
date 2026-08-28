import type { RemoteConnection } from '../connection'
import { ImapRemoteMail } from '../imap'
import type { RemoteConnectionConfig } from '../runtime'
import type { RemoteSession } from '../session'
import { SmtpSubmission } from '../smtp'
import { imapAccountId } from '../imap/ids'
import { toNativeRemoteError } from './error-mapper'
import type { NativeMailIpcPort } from './ipc'

type ImapSmtpConfig = Extract<RemoteConnectionConfig, { provider: 'imapSmtp' }>

export class ImapSmtpRemoteConnection implements RemoteConnection {
  private config: ImapSmtpConfig | null

  constructor(
    config: ImapSmtpConfig,
    private readonly ipc: NativeMailIpcPort,
  ) {
    this.config = config
  }

  async open(): Promise<RemoteSession> {
    try {
      const config = this.config
      if (config === null) {
        throw new TypeError('Native mail connection is single-use')
      }
      this.config = null
      const opened = await this.ipc.open({
        host: config.host,
        username: config.username,
        password: config.password,
        imapPort: config.imapPort,
        smtpPort: config.smtpPort,
      })
      const accountId = imapAccountId(opened.authenticatedUser)
      const mail = new ImapRemoteMail(
        this.ipc,
        opened.sessionId,
        opened.authenticatedUser,
      )
      const submission = new SmtpSubmission(
        this.ipc,
        opened.sessionId,
        accountId,
      )
      let closed = false
      return {
        accounts: [{ id: accountId, capabilities: ['mail', 'submission'] }],
        mail,
        submission,
        close: async () => {
          if (closed) return
          closed = true
          try {
            await this.ipc.close(opened.sessionId)
          } catch (error: unknown) {
            throw toNativeRemoteError(error)
          }
        },
      }
    } catch (error: unknown) {
      throw toNativeRemoteError(error)
    }
  }
}
