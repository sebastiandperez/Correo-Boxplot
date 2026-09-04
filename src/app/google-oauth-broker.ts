import type { AccountKey } from '../domain/ids'

/** Application boundary for native OAuth; it intentionally exposes no token. */
export interface GoogleOAuthBroker {
  authorize(
    accountKey: AccountKey,
    username: string,
  ): Promise<Readonly<{ credentialRef: string }>>
  forget(credentialRef: string): Promise<void>
}
