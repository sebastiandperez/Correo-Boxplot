import {
  mutationInstantFromString,
  type MutationInstant,
} from '../domain/pending-mutation'

const RETRY_DELAYS_MS = [5_000, 15_000, 60_000, 300_000] as const

export function nextRetryInstant(
  attemptCount: number,
  now: MutationInstant,
): MutationInstant {
  const index = Math.min(
    Math.max(attemptCount, 1) - 1,
    RETRY_DELAYS_MS.length - 1,
  )
  const instant = Date.parse(now)
  if (!Number.isFinite(instant)) {
    throw new TypeError(
      'Mutation retry clock must be an ISO-compatible instant',
    )
  }
  return mutationInstantFromString(
    new Date(instant + RETRY_DELAYS_MS[index]).toISOString(),
  )
}
