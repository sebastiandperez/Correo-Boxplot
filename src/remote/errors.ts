export type RemoteErrorKind =
  | 'auth'
  | 'network'
  | 'unavailable'
  | 'protocol'
  | 'malformedRemoteData'
  | 'stateInvalid'
  | 'conflict'
  | 'unsupported'
  | 'rateLimited'
  | 'tooLarge'
  | 'rejected'
  | 'unexpected'

export type RetryDisposition =
  'never' | 'safeImmediate' | 'safeBackoff' | 'reconcile'

export type SessionDisposition = 'keep' | 'expire'
export type OperationOutcome = 'notApplicable' | 'knownNotApplied' | 'unknown'

export type RemoteErrorOptions = Readonly<{
  kind: RemoteErrorKind
  retry: RetryDisposition
  session: SessionDisposition
  outcome: OperationOutcome
  cause?: unknown
}>

export class RemoteError extends Error {
  readonly kind: RemoteErrorKind
  readonly retry: RetryDisposition
  readonly session: SessionDisposition
  readonly outcome: OperationOutcome
  override readonly cause?: unknown

  constructor(message: string, options: RemoteErrorOptions) {
    super(message)
    this.name = 'RemoteError'
    this.kind = options.kind
    this.retry = options.retry
    this.session = options.session
    this.outcome = options.outcome
    this.cause = options.cause
  }
}
