import type { E2eeErrorKind } from '../e2ee/types'

export type BodyMaterializationErrorKind =
  | 'emailAbsent'
  | 'notConnected'
  | 'remote'
  | 'local'
  | 'invalidEnvelope'
  | 'metadataUnavailable'
  | 'e2ee'
  | 'cancelled'
  | 'unexpected'

export class BodyMaterializationError extends Error {
  constructor(
    readonly kind: BodyMaterializationErrorKind,
    readonly e2eeKind?: E2eeErrorKind,
  ) {
    super(`Body materialization failed: ${kind}`)
    this.name = 'BodyMaterializationError'
  }
}
