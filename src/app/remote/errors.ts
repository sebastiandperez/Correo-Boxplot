import type { RemoteApplicationErrorKind } from './types'

const safeMessages: Readonly<Record<RemoteApplicationErrorKind, string>> = {
  auth: 'Remote authentication failed',
  network: 'The remote service is unavailable',
  remote: 'The remote operation failed',
  local: 'The local operation failed',
  accountMismatch: 'The local and remote account bindings do not match',
  accountSelectionRequired: 'Remote account selection is required',
  notConnected: 'The account is not connected',
  busy: 'A remote lifecycle operation is already active for this account',
  cancelled: 'The remote lifecycle operation was cancelled',
  disposed: 'The remote application has been disposed',
  unexpected: 'An unexpected remote application error occurred',
}

export class RemoteApplicationError extends Error {
  constructor(readonly kind: RemoteApplicationErrorKind) {
    super(safeMessages[kind])
    this.name = 'RemoteApplicationError'
  }
}
