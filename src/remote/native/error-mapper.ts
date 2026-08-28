import { RemoteError } from '../errors'
import type { NativeMailErrorDto } from './ipc'

const kinds = new Set([
  'auth',
  'network',
  'unavailable',
  'protocol',
  'malformedRemoteData',
  'stateInvalid',
  'conflict',
  'unsupported',
  'rateLimited',
  'tooLarge',
  'rejected',
  'unexpected',
])

export function toNativeRemoteError(error: unknown): RemoteError {
  if (error instanceof RemoteError) return error
  if (isNativeError(error)) {
    return new RemoteError(
      `Native mail operation failed${error.code ? ` (${error.code})` : ''}`,
      {
        kind: error.kind,
        retry: error.retry,
        session: error.session,
        outcome: error.outcome,
      },
    )
  }
  return new RemoteError('Native mail IPC is unavailable', {
    kind: 'unavailable',
    retry: 'safeBackoff',
    session: 'expire',
    outcome: 'knownNotApplied',
    cause: error,
  })
}

function isNativeError(value: unknown): value is NativeMailErrorDto {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.kind === 'string' &&
    kinds.has(record.kind) &&
    ['never', 'safeImmediate', 'safeBackoff', 'reconcile'].includes(
      String(record.retry),
    ) &&
    ['keep', 'expire'].includes(String(record.session)) &&
    ['notApplicable', 'knownNotApplied', 'unknown'].includes(
      String(record.outcome),
    )
  )
}
