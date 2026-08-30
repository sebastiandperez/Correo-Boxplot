import type { AccountKey } from '../domain/ids'
import type { RemoteBody } from './body'
import type { RemoteEmailId } from './types'

export type RemoteBodySourceErrorKind =
  'notConnected' | 'remote' | 'cancelled' | 'unexpected'

export class RemoteBodySourceError extends Error {
  constructor(readonly kind: RemoteBodySourceErrorKind) {
    super(`Remote body source failed: ${kind}`)
    this.name = 'RemoteBodySourceError'
  }
}

export type RemoteBodyFetch = Readonly<{
  body: RemoteBody
  assertCurrent(): void
}>

export interface RemoteBodySource {
  fetchBody(
    accountKey: AccountKey,
    emailId: RemoteEmailId,
  ): Promise<RemoteBodyFetch>
}
