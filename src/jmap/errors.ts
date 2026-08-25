export type JmapErrorRetryability = 'retryable' | 'terminal'

export class JmapError extends Error {
  readonly retryability: JmapErrorRetryability

  constructor(
    message: string,
    retryability: JmapErrorRetryability = 'terminal',
  ) {
    super(message)
    this.name = 'JmapError'
    this.retryability = retryability
  }
}

export class JmapAuthError extends JmapError {
  constructor(message = 'Authentication failed or token expired') {
    // Retrying the identical call won't succeed without a fresh token —
    // that requires an external re-auth flow, not an Outbox-style retry.
    super(message, 'terminal')
    this.name = 'JmapAuthError'
  }
}

export class JmapNetworkError extends JmapError {
  constructor(
    message: string,
    public readonly originalError?: unknown,
  ) {
    super(message, 'retryable')
    this.name = 'JmapNetworkError'
  }
}

// RFC 8620 §3.6.2 defines these as the server-side method errors that are
// transient by nature (the server itself signals "try again"). Anything
// else (notFound, invalidArguments, tooLarge, stateMismatch, forbidden,
// unknown, ...) is structural: retrying the identical call would fail
// identically, so it defaults to terminal. 'networkOrServerFail' is this
// codebase's own convention (see session.ts, mail/*.ts) for wrapping a
// caught transport-layer failure as a method error.
const RETRYABLE_METHOD_ERROR_TYPES: ReadonlySet<string> = new Set([
  'serverFail',
  'serverPartialFail',
  'serverUnavailable',
  'rateLimited',
  'networkOrServerFail',
])

export class JmapMethodError extends JmapError {
  constructor(
    public readonly method: string,
    public readonly type: string, // e.g. 'serverFail', 'unknownMethod', 'invalidArguments'
    message: string = `JMAP Method ${method} failed: ${type}`,
  ) {
    super(
      message,
      RETRYABLE_METHOD_ERROR_TYPES.has(type) ? 'retryable' : 'terminal',
    )
    this.name = 'JmapMethodError'
  }
}

/**
 * True when retrying the identical call later has a reasonable chance of
 * succeeding (network blip, transient server failure). False for anything
 * structural (not found, malformed request, expired auth, quota) where a
 * blind retry would just fail the same way again — those need either a
 * different action (re-auth, refetch state) or to be given up on.
 */
export function isRetryable(error: unknown): boolean {
  return error instanceof JmapError && error.retryability === 'retryable'
}
