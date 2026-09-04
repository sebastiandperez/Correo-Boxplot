import type { AccountKey } from '../../domain/ids'
import type { GoogleOAuthBroker } from '../../app/google-oauth-broker'
import type { NativeMailIpcPort } from './ipc'

/** Native-only adapter: secrets never leave the Google OAuth IPC commands. */
export class NativeGoogleOAuthBroker implements GoogleOAuthBroker {
  constructor(private readonly ipc: NativeMailIpcPort) {}

  authorize(accountKey: AccountKey, username: string) {
    const authorize = this.ipc.authorizeGoogle
    if (authorize === undefined)
      throw new TypeError('Google OAuth IPC unavailable')
    return authorize.call(this.ipc, {
      accountKey: String(accountKey),
      username,
    })
  }

  async forget(credentialRef: string): Promise<void> {
    const forget = this.ipc.forgetGoogle
    if (forget === undefined)
      throw new TypeError('Google OAuth IPC unavailable')
    await forget.call(this.ipc, { credentialRef })
  }
}
