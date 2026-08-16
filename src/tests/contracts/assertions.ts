import { sameScopedEmailId } from '../../domain/ids'
import { sameMailboxViewSpec } from '../../domain/mailbox-view'
import type { LocalChangeHint } from '../../ports/local-change-source'
import type { PortResult } from '../../ports/port-result'

type ErrorWithKind = Readonly<{
  kind: string
}>

export function unwrapOk<T, E extends ErrorWithKind>(
  result: PortResult<T, E>,
): T {
  if (result.ok) {
    return result.value
  }

  throw new Error(
    `Expected successful PortResult, received error kind: ${result.error.kind}`,
  )
}

export function expectErrorKind<T, E extends ErrorWithKind>(
  result: PortResult<T, E>,
  expectedKind: E['kind'],
): void {
  if (result.ok) {
    throw new Error(`Expected error kind ${expectedKind}, received success`)
  }

  if (result.error.kind !== expectedKind) {
    throw new Error(
      `Expected error kind ${expectedKind}, received ${result.error.kind}`,
    )
  }
}

export function sameLocalChangeHint(
  actual: LocalChangeHint,
  expected: LocalChangeHint,
): boolean {
  switch (actual.kind) {
    case 'accounts':
      return expected.kind === 'accounts'
    case 'mailboxes':
    case 'identities':
    case 'emails':
    case 'emailMemberships':
    case 'pendingMutations':
      return (
        expected.kind === actual.kind &&
        actual.accountKey === expected.accountKey
      )
    case 'emailBody':
    case 'attachmentRefs':
      return (
        expected.kind === actual.kind &&
        sameScopedEmailId(actual.emailId, expected.emailId)
      )
    case 'mailboxView':
      return (
        expected.kind === 'mailboxView' &&
        sameMailboxViewSpec(actual.spec, expected.spec)
      )
    case 'syncCursor':
      return (
        expected.kind === 'syncCursor' &&
        actual.accountKey === expected.accountKey &&
        actual.dataType === expected.dataType
      )
  }
}

export function expectHintCoverage(
  observed: readonly LocalChangeHint[],
  required: readonly LocalChangeHint[],
): void {
  for (const requiredHint of required) {
    if (
      !observed.some((observedHint) =>
        sameLocalChangeHint(observedHint, requiredHint),
      )
    ) {
      throw new Error(
        `Missing required LocalChangeHint coverage: ${requiredHint.kind}`,
      )
    }
  }
}
