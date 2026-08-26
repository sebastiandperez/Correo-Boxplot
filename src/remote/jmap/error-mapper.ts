import {
  JmapAuthError,
  JmapMethodError,
  JmapNetworkError,
  JmapSubmissionAmbiguousError,
} from '../../jmap/errors'
import { RemoteError, type OperationOutcome } from '../errors'

export function toRemoteError(
  error: unknown,
  outcome: OperationOutcome = 'knownNotApplied',
): RemoteError {
  if (error instanceof RemoteError) return error
  if (error instanceof JmapAuthError) {
    return new RemoteError('Remote authentication failed', {
      kind: 'auth',
      retry: 'never',
      session: 'expire',
      outcome: 'knownNotApplied',
      cause: error,
    })
  }
  if (error instanceof JmapSubmissionAmbiguousError) {
    return new RemoteError('Submission outcome is unknown', {
      kind: 'network',
      retry: 'reconcile',
      session: 'keep',
      outcome: 'unknown',
      cause: error,
    })
  }
  if (error instanceof JmapNetworkError) {
    return new RemoteError('Remote network operation failed', {
      kind: 'network',
      retry: outcome === 'unknown' ? 'reconcile' : 'safeBackoff',
      session: 'keep',
      outcome,
      cause: error,
    })
  }
  if (error instanceof JmapMethodError) {
    const kind =
      error.type === 'rateLimited'
        ? 'rateLimited'
        : error.type === 'tooLarge'
          ? 'tooLarge'
          : error.type === 'cannotCalculateChanges' ||
              error.type === 'stateMismatch'
            ? 'stateInvalid'
            : error.type === 'serverUnavailable'
              ? 'unavailable'
              : error.retryability === 'retryable'
                ? 'protocol'
                : 'rejected'
    return new RemoteError('Remote protocol operation failed', {
      kind,
      retry: error.retryability === 'retryable' ? 'safeBackoff' : 'never',
      session: 'keep',
      outcome,
      cause: error,
    })
  }
  return new RemoteError('Unexpected remote adapter failure', {
    kind: 'unexpected',
    retry: outcome === 'unknown' ? 'reconcile' : 'never',
    session: 'keep',
    outcome,
    cause: error,
  })
}
