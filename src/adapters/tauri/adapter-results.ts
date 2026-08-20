import type { IpcTransportFailure } from '../../ipc/local-engine-ipc-client'
export const ok = <T>(value: T) => ({ ok: true as const, value })
export const error = <E>(value: E) => ({ ok: false as const, error: value })

function isTransportFailure(value: unknown): value is IpcTransportFailure {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === 'transportFailure' &&
    'cause' in value
  )
}

export function mapTransportFailure(
  value: unknown,
): Readonly<{ kind: 'unavailable' | 'unexpected' }> {
  return {
    kind:
      isTransportFailure(value) && value.cause instanceof TypeError
        ? 'unexpected'
        : 'unavailable',
  }
}
