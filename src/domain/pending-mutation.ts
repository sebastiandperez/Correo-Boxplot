import { keywordSet, type KeywordSet } from './email'
import {
  sameScopedMailboxId,
  type AccountKey,
  type MutationId,
  type ScopedEmailId,
  type ScopedMailboxId,
} from './ids'
import type { SendIntent } from './send-intent'

declare const mutationInstantBrand: unique symbol

export type MutationInstant = string & {
  readonly [mutationInstantBrand]: 'MutationInstant'
}

export type PendingMutationLifecycle = Readonly<{
  status: 'pending'
  attemptCount: 0
}>

export type InFlightMutationLifecycle = Readonly<{
  status: 'inFlight'
  attemptCount: number
}>

export type RetryingMutationLifecycle = Readonly<{
  status: 'retrying'
  attemptCount: number
  nextAttemptAt: MutationInstant
}>

export type ConfirmedEmailUpdateLifecycle = Readonly<{
  status: 'confirmed'
  attemptCount: number
}>

export type SendConfirmation = Readonly<{
  emailId: ScopedEmailId
}>

export type ConfirmedSendMutationLifecycle = Readonly<{
  status: 'confirmed'
  attemptCount: number
  confirmation: SendConfirmation
}>

export type FailedTerminalMutationLifecycle = Readonly<{
  status: 'failedTerminal'
  attemptCount: number
}>

export type SendMutationLifecycle =
  | PendingMutationLifecycle
  | InFlightMutationLifecycle
  | RetryingMutationLifecycle
  | ConfirmedSendMutationLifecycle
  | FailedTerminalMutationLifecycle

export type EmailUpdateLifecycle =
  | PendingMutationLifecycle
  | InFlightMutationLifecycle
  | RetryingMutationLifecycle
  | ConfirmedEmailUpdateLifecycle
  | FailedTerminalMutationLifecycle

export type KeywordChange = Readonly<{
  add: KeywordSet
  remove: KeywordSet
}>

export type MailboxMembershipChange = Readonly<{
  add: readonly ScopedMailboxId[]
  remove: readonly ScopedMailboxId[]
}>

export type SendMutation = Readonly<{
  kind: 'send'
  mutationId: MutationId
  accountKey: AccountKey
  createdAt: MutationInstant
  intent: SendIntent
  lifecycle: SendMutationLifecycle
}>

export type KeywordMutation = Readonly<{
  kind: 'keyword'
  mutationId: MutationId
  accountKey: AccountKey
  createdAt: MutationInstant
  emailId: ScopedEmailId
  change: KeywordChange
  lifecycle: EmailUpdateLifecycle
}>

export type MailboxMembershipMutation = Readonly<{
  kind: 'mailboxMembership'
  mutationId: MutationId
  accountKey: AccountKey
  createdAt: MutationInstant
  emailId: ScopedEmailId
  change: MailboxMembershipChange
  lifecycle: EmailUpdateLifecycle
}>

export type PendingMutation =
  SendMutation | KeywordMutation | MailboxMembershipMutation

type SendMutationInput = Readonly<{
  mutationId: MutationId
  accountKey: AccountKey
  createdAt: MutationInstant
  intent: SendIntent
}>

type KeywordMutationInput = Readonly<{
  mutationId: MutationId
  accountKey: AccountKey
  createdAt: MutationInstant
  emailId: ScopedEmailId
  change: KeywordChange
}>

type MailboxMembershipMutationInput = Readonly<{
  mutationId: MutationId
  accountKey: AccountKey
  createdAt: MutationInstant
  emailId: ScopedEmailId
  change: MailboxMembershipChange
}>

type TransitionLifecycle =
  | InFlightMutationLifecycle
  | RetryingMutationLifecycle
  | FailedTerminalMutationLifecycle

export function mutationInstantFromString(value: string): MutationInstant {
  if (value.length === 0) {
    throw new TypeError('MutationInstant must not be empty')
  }

  return value as MutationInstant
}

export function keywordChange(input: KeywordChange): KeywordChange {
  const add = keywordSet(input.add)
  const remove = keywordSet(input.remove)

  if (add.size === 0 && remove.size === 0) {
    throw new TypeError('KeywordChange must add or remove at least one keyword')
  }

  for (const keyword of add) {
    if (remove.has(keyword)) {
      throw new TypeError(
        'KeywordChange cannot add and remove the same keyword',
      )
    }
  }

  return { add, remove }
}

function containsMailboxId(
  values: readonly ScopedMailboxId[],
  candidate: ScopedMailboxId,
): boolean {
  return values.some((value) => sameScopedMailboxId(value, candidate))
}

function hasDuplicateMailboxId(values: readonly ScopedMailboxId[]): boolean {
  return values.some((value, index) =>
    containsMailboxId(values.slice(0, index), value),
  )
}

export function mailboxMembershipChange(
  input: MailboxMembershipChange,
): MailboxMembershipChange {
  const add = [...input.add]
  const remove = [...input.remove]

  if (add.length === 0 && remove.length === 0) {
    throw new TypeError(
      'MailboxMembershipChange must add or remove at least one Mailbox',
    )
  }

  if (hasDuplicateMailboxId(add) || hasDuplicateMailboxId(remove)) {
    throw new TypeError(
      'MailboxMembershipChange cannot contain duplicate Mailbox IDs',
    )
  }

  if (add.some((mailboxId) => containsMailboxId(remove, mailboxId))) {
    throw new TypeError(
      'MailboxMembershipChange cannot add and remove the same Mailbox',
    )
  }

  return { add, remove }
}

function pendingLifecycle(): PendingMutationLifecycle {
  return { status: 'pending', attemptCount: 0 }
}

export function sendConfirmation(emailId: ScopedEmailId): SendConfirmation {
  return { emailId }
}

export function sendMutation(input: SendMutationInput): SendMutation {
  if (input.intent.identityId.accountKey !== input.accountKey) {
    throw new TypeError(
      'SendMutation AccountKey must match its SendIntent Identity AccountKey',
    )
  }

  return {
    kind: 'send',
    mutationId: input.mutationId,
    accountKey: input.accountKey,
    createdAt: input.createdAt,
    intent: input.intent,
    lifecycle: pendingLifecycle(),
  }
}

export function keywordMutation(input: KeywordMutationInput): KeywordMutation {
  if (input.emailId.accountKey !== input.accountKey) {
    throw new TypeError(
      'KeywordMutation AccountKey must match its Email AccountKey',
    )
  }

  return {
    kind: 'keyword',
    mutationId: input.mutationId,
    accountKey: input.accountKey,
    createdAt: input.createdAt,
    emailId: input.emailId,
    change: keywordChange(input.change),
    lifecycle: pendingLifecycle(),
  }
}

export function mailboxMembershipMutation(
  input: MailboxMembershipMutationInput,
): MailboxMembershipMutation {
  if (input.emailId.accountKey !== input.accountKey) {
    throw new TypeError(
      'MailboxMembershipMutation AccountKey must match its Email AccountKey',
    )
  }

  const change = mailboxMembershipChange(input.change)

  for (const mailboxId of [...change.add, ...change.remove]) {
    if (mailboxId.accountKey !== input.accountKey) {
      throw new TypeError(
        'MailboxMembershipMutation Mailboxes must match its AccountKey',
      )
    }
  }

  return {
    kind: 'mailboxMembership',
    mutationId: input.mutationId,
    accountKey: input.accountKey,
    createdAt: input.createdAt,
    emailId: input.emailId,
    change,
    lifecycle: pendingLifecycle(),
  }
}

export function samePendingMutationIdentity(
  left: PendingMutation,
  right: PendingMutation,
): boolean {
  return (
    left.accountKey === right.accountKey && left.mutationId === right.mutationId
  )
}

function assertStartedAttemptCount(attemptCount: number): void {
  if (!Number.isSafeInteger(attemptCount) || attemptCount < 1) {
    throw new TypeError(
      'Started mutation attemptCount must be a positive safe integer',
    )
  }
}

function replaceLifecycle(
  mutation: PendingMutation,
  lifecycle: TransitionLifecycle,
): PendingMutation {
  switch (mutation.kind) {
    case 'send':
      return {
        kind: mutation.kind,
        mutationId: mutation.mutationId,
        accountKey: mutation.accountKey,
        createdAt: mutation.createdAt,
        intent: mutation.intent,
        lifecycle,
      }
    case 'keyword':
      return {
        kind: mutation.kind,
        mutationId: mutation.mutationId,
        accountKey: mutation.accountKey,
        createdAt: mutation.createdAt,
        emailId: mutation.emailId,
        change: mutation.change,
        lifecycle,
      }
    case 'mailboxMembership':
      return {
        kind: mutation.kind,
        mutationId: mutation.mutationId,
        accountKey: mutation.accountKey,
        createdAt: mutation.createdAt,
        emailId: mutation.emailId,
        change: mutation.change,
        lifecycle,
      }
  }
}

export function startMutationAttempt(mutation: SendMutation): SendMutation
export function startMutationAttempt(mutation: KeywordMutation): KeywordMutation
export function startMutationAttempt(
  mutation: MailboxMembershipMutation,
): MailboxMembershipMutation
export function startMutationAttempt(mutation: PendingMutation): PendingMutation
export function startMutationAttempt(
  mutation: PendingMutation,
): PendingMutation {
  switch (mutation.lifecycle.status) {
    case 'pending': {
      if (mutation.lifecycle.attemptCount !== 0) {
        throw new TypeError('Pending mutation attemptCount must be zero')
      }

      return replaceLifecycle(mutation, {
        status: 'inFlight',
        attemptCount: 1,
      })
    }
    case 'retrying': {
      assertStartedAttemptCount(mutation.lifecycle.attemptCount)
      const nextAttemptCount = mutation.lifecycle.attemptCount + 1
      assertStartedAttemptCount(nextAttemptCount)

      return replaceLifecycle(mutation, {
        status: 'inFlight',
        attemptCount: nextAttemptCount,
      })
    }
    default:
      throw new TypeError(
        'Mutation attempt can start only from pending or retrying',
      )
  }
}

export function scheduleMutationRetry(
  mutation: SendMutation,
  nextAttemptAt: MutationInstant,
): SendMutation
export function scheduleMutationRetry(
  mutation: KeywordMutation,
  nextAttemptAt: MutationInstant,
): KeywordMutation
export function scheduleMutationRetry(
  mutation: MailboxMembershipMutation,
  nextAttemptAt: MutationInstant,
): MailboxMembershipMutation
export function scheduleMutationRetry(
  mutation: PendingMutation,
  nextAttemptAt: MutationInstant,
): PendingMutation
export function scheduleMutationRetry(
  mutation: PendingMutation,
  nextAttemptAt: MutationInstant,
): PendingMutation {
  if (mutation.lifecycle.status !== 'inFlight') {
    throw new TypeError('Mutation retry can be scheduled only from inFlight')
  }

  assertStartedAttemptCount(mutation.lifecycle.attemptCount)

  return replaceLifecycle(mutation, {
    status: 'retrying',
    attemptCount: mutation.lifecycle.attemptCount,
    nextAttemptAt,
  })
}

export function confirmEmailUpdateMutation(
  mutation: KeywordMutation,
): KeywordMutation
export function confirmEmailUpdateMutation(
  mutation: MailboxMembershipMutation,
): MailboxMembershipMutation
export function confirmEmailUpdateMutation(
  mutation: KeywordMutation | MailboxMembershipMutation,
): KeywordMutation | MailboxMembershipMutation
export function confirmEmailUpdateMutation(
  mutation: KeywordMutation | MailboxMembershipMutation,
): KeywordMutation | MailboxMembershipMutation {
  if (mutation.lifecycle.status !== 'inFlight') {
    throw new TypeError(
      'Email update mutation can be confirmed only from inFlight',
    )
  }

  assertStartedAttemptCount(mutation.lifecycle.attemptCount)
  const lifecycle: ConfirmedEmailUpdateLifecycle = {
    status: 'confirmed',
    attemptCount: mutation.lifecycle.attemptCount,
  }

  switch (mutation.kind) {
    case 'keyword':
      return {
        kind: mutation.kind,
        mutationId: mutation.mutationId,
        accountKey: mutation.accountKey,
        createdAt: mutation.createdAt,
        emailId: mutation.emailId,
        change: mutation.change,
        lifecycle,
      }
    case 'mailboxMembership':
      return {
        kind: mutation.kind,
        mutationId: mutation.mutationId,
        accountKey: mutation.accountKey,
        createdAt: mutation.createdAt,
        emailId: mutation.emailId,
        change: mutation.change,
        lifecycle,
      }
  }
}

export function confirmSendMutation(
  mutation: SendMutation,
  confirmation: SendConfirmation,
): SendMutation {
  if (mutation.lifecycle.status !== 'inFlight') {
    throw new TypeError('SendMutation can be confirmed only from inFlight')
  }

  assertStartedAttemptCount(mutation.lifecycle.attemptCount)

  if (confirmation.emailId.accountKey !== mutation.accountKey) {
    throw new TypeError(
      'Send confirmation Email must match the SendMutation AccountKey',
    )
  }

  return {
    kind: mutation.kind,
    mutationId: mutation.mutationId,
    accountKey: mutation.accountKey,
    createdAt: mutation.createdAt,
    intent: mutation.intent,
    lifecycle: {
      status: 'confirmed',
      attemptCount: mutation.lifecycle.attemptCount,
      confirmation: sendConfirmation(confirmation.emailId),
    },
  }
}

export function failMutationTerminal(mutation: SendMutation): SendMutation
export function failMutationTerminal(mutation: KeywordMutation): KeywordMutation
export function failMutationTerminal(
  mutation: MailboxMembershipMutation,
): MailboxMembershipMutation
export function failMutationTerminal(mutation: PendingMutation): PendingMutation
export function failMutationTerminal(
  mutation: PendingMutation,
): PendingMutation {
  if (mutation.lifecycle.status !== 'inFlight') {
    throw new TypeError('Mutation can fail terminally only from inFlight')
  }

  assertStartedAttemptCount(mutation.lifecycle.attemptCount)

  return replaceLifecycle(mutation, {
    status: 'failedTerminal',
    attemptCount: mutation.lifecycle.attemptCount,
  })
}
