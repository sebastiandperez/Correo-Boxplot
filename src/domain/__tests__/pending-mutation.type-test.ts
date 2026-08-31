import { describe, expect, it } from 'vitest'

import { emailAddress } from '../address'
import type { Email } from '../email'
import { identity } from '../identity'
import {
  accountKeyFromString,
  jmapEmailIdFromString,
  jmapIdentityIdFromString,
  jmapMailboxIdFromString,
  mutationIdFromString,
  scopedEmailId,
  scopedIdentityId,
  scopedMailboxId,
} from '../ids'
import {
  keywordChange,
  keywordMutation,
  mailboxMembershipChange,
  mailboxMembershipMutation,
  mutationInstantFromString,
  sendMutation,
  type ConfirmedEmailUpdateLifecycle,
  type ConfirmedSendMutationLifecycle,
  type EmailUpdateLifecycle,
  type FailedTerminalMutationLifecycle,
  type InFlightMutationLifecycle,
  type KeywordChange,
  type KeywordMutation,
  type MailboxMembershipChange,
  type MailboxMembershipMutation,
  type MutationInstant,
  type PendingMutation,
  type PendingMutationLifecycle,
  type RetryingMutationLifecycle,
  type SendMutation,
  type SendMutationLifecycle,
} from '../pending-mutation'
import { sendIntent } from '../send-intent'
import { collectionSyncStateFromString } from '../sync-cursor'

type OptionalKeys<Value> = {
  [Key in keyof Value]-?: Record<never, never> extends Pick<Value, Key>
    ? Key
    : never
}[keyof Value]

function expectNever<Value extends never>(value?: Value): void {
  void value
}

function acceptPendingMutation(value: PendingMutation): PendingMutation {
  return value
}

function acceptSendMutation(value: SendMutation): SendMutation {
  return value
}

function acceptKeywordMutation(value: KeywordMutation): KeywordMutation {
  return value
}

function acceptMembershipMutation(
  value: MailboxMembershipMutation,
): MailboxMembershipMutation {
  return value
}

const accountKey = accountKeyFromString('account')
const otherAccountKey = accountKeyFromString('other-account')
const mutationId = mutationIdFromString('mutation')
const createdAt = mutationInstantFromString('created-at')
const emailId = scopedEmailId(accountKey, jmapEmailIdFromString('email'))
const mailboxId = scopedMailboxId(
  accountKey,
  jmapMailboxIdFromString('mailbox'),
)
const selectedIdentity = identity({
  id: scopedIdentityId(accountKey, jmapIdentityIdFromString('identity')),
  name: 'Sender',
  email: 'sender@example.test',
  replyTo: null,
  bcc: null,
})
const intent = sendIntent({
  securityMode: 'plain',
  identity: selectedIdentity,
  to: [emailAddress(null, 'recipient@example.test')],
  cc: [],
  bcc: [],
  subject: '',
  body: { text: '', html: null },
})
const change = keywordChange({ add: new Set(['$seen']), remove: new Set() })
const membershipChange = mailboxMembershipChange({
  add: [mailboxId],
  remove: [],
})
const validSend = sendMutation({ mutationId, accountKey, createdAt, intent })
const validKeyword = keywordMutation({
  mutationId,
  accountKey,
  createdAt,
  emailId,
  change,
})
const validMembership = mailboxMembershipMutation({
  mutationId,
  accountKey,
  createdAt,
  emailId,
  change: membershipChange,
})

describe('D-08 PendingMutation compile-time invariants', () => {
  it('narrows the closed mutation family by kind without casts', () => {
    function inspect(mutation: PendingMutation): string {
      switch (mutation.kind) {
        case 'send':
          return mutation.intent.subject
        case 'keyword':
          return [...mutation.change.add].join(',')
        case 'mailboxMembership':
          return mutation.emailId.jmapId
        default: {
          const exhaustive: never = mutation
          return exhaustive
        }
      }
    }

    function rejectUnnarrowedAccess(mutation: PendingMutation): void {
      // @ts-expect-error Only SendMutation exposes intent.
      void mutation.intent
      // @ts-expect-error Not every PendingMutation exposes change.
      void mutation.change
    }

    expect([
      inspect(validSend),
      inspect(validKeyword),
      inspect(validMembership),
      rejectUnnarrowedAccess,
    ]).toHaveLength(4)
  })

  it('requires every variant-specific and common field', () => {
    expectNever<OptionalKeys<SendMutation>>()
    expectNever<OptionalKeys<KeywordMutation>>()
    expectNever<OptionalKeys<MailboxMembershipMutation>>()
    expectNever<OptionalKeys<KeywordChange>>()
    expectNever<OptionalKeys<MailboxMembershipChange>>()

    const { mutationId: omittedMutationId, ...sendWithoutMutationId } =
      validSend
    const { intent: omittedIntent, ...sendWithoutIntent } = validSend
    const { emailId: omittedEmailId, ...keywordWithoutEmailId } = validKeyword
    const { change: omittedChange, ...membershipWithoutChange } =
      validMembership

    // @ts-expect-error SendMutation requires MutationId.
    const missingMutationId: SendMutation = sendWithoutMutationId
    // @ts-expect-error SendMutation requires SendIntent.
    const missingIntent: SendMutation = sendWithoutIntent
    // @ts-expect-error KeywordMutation requires ScopedEmailId.
    const missingEmailId: KeywordMutation = keywordWithoutEmailId
    // @ts-expect-error MembershipMutation requires its semantic change.
    const missingChange: MailboxMembershipMutation = membershipWithoutChange

    expect([
      omittedMutationId,
      omittedIntent,
      omittedEmailId,
      omittedChange,
      missingMutationId,
      missingIntent,
      missingEmailId,
      missingChange,
    ]).toHaveLength(8)
  })

  it('rejects wrong identity categories and raw MutationInstant strings', () => {
    const accountAsMutationId: SendMutation = {
      ...validSend,
      // @ts-expect-error AccountKey is not MutationId.
      mutationId: accountKey,
    }
    const mailboxAsEmail: KeywordMutation = {
      ...validKeyword,
      // @ts-expect-error ScopedMailboxId is not ScopedEmailId.
      emailId: mailboxId,
    }
    const wrongMembershipChange: MailboxMembershipChange = {
      // @ts-expect-error ScopedEmailId is not ScopedMailboxId.
      add: [emailId],
      remove: [],
    }
    // @ts-expect-error Raw strings require mutationInstantFromString.
    const rawInstant: MutationInstant = 'created-at'

    expect([
      accountAsMutationId,
      mailboxAsEmail,
      wrongMembershipChange,
      rawInstant,
    ]).toHaveLength(4)
  })

  it('keeps mutations, changes and collections readonly', () => {
    if (false) {
      // @ts-expect-error Mutation kind is readonly.
      validSend.kind = 'send'
      // @ts-expect-error MutationId is readonly.
      validSend.mutationId = mutationId
      // @ts-expect-error AccountKey is readonly.
      validSend.accountKey = otherAccountKey
      // @ts-expect-error createdAt is readonly.
      validSend.createdAt = createdAt
      // @ts-expect-error Send intent is readonly on SendMutation.
      validSend.intent = intent
      // @ts-expect-error Email target is readonly.
      validKeyword.emailId = emailId
      // @ts-expect-error Semantic change is readonly.
      validKeyword.change = change
      // @ts-expect-error Lifecycle is readonly.
      validKeyword.lifecycle = { status: 'pending', attemptCount: 0 }
      // @ts-expect-error Keyword add set exposes no mutable add operation.
      validKeyword.change.add.add('$flagged')
      // @ts-expect-error Keyword remove set exposes no mutable add operation.
      validKeyword.change.remove.add('$seen')
      // @ts-expect-error Membership add is a readonly array.
      validMembership.change.add.push(mailboxId)
      // @ts-expect-error Membership remove is a readonly array.
      validMembership.change.remove.push(mailboxId)
    }

    expect([validSend, validKeyword, validMembership]).toHaveLength(3)
  })

  it('models lifecycle-specific fields without optional leakage', () => {
    const pending: PendingMutationLifecycle = {
      status: 'pending',
      attemptCount: 0,
    }
    const inFlight: InFlightMutationLifecycle = {
      status: 'inFlight',
      attemptCount: 1,
    }
    const retrying: RetryingMutationLifecycle = {
      status: 'retrying',
      attemptCount: 1,
      nextAttemptAt: mutationInstantFromString('next-attempt'),
    }
    const confirmedUpdate: ConfirmedEmailUpdateLifecycle = {
      status: 'confirmed',
      attemptCount: 1,
    }
    const confirmedSend: ConfirmedSendMutationLifecycle = {
      status: 'confirmed',
      attemptCount: 1,
      confirmation: { emailId },
    }
    const failed: FailedTerminalMutationLifecycle = {
      status: 'failedTerminal',
      attemptCount: 1,
    }

    const invalidPending: PendingMutationLifecycle = {
      status: 'pending',
      // @ts-expect-error Pending attemptCount is exactly zero.
      attemptCount: 1,
    }
    // @ts-expect-error Retrying requires nextAttemptAt.
    const retryWithoutInstant: RetryingMutationLifecycle = {
      status: 'retrying',
      attemptCount: 1,
    }

    if (false) {
      // @ts-expect-error Pending lifecycle has no nextAttemptAt.
      void pending.nextAttemptAt
      // @ts-expect-error InFlight lifecycle has no nextAttemptAt.
      void inFlight.nextAttemptAt
      // @ts-expect-error Confirmed lifecycle has no nextAttemptAt.
      void confirmedUpdate.nextAttemptAt
      // @ts-expect-error Failed lifecycle has no nextAttemptAt.
      void failed.nextAttemptAt
      // @ts-expect-error Update confirmation has no Send confirmation evidence.
      void confirmedUpdate.confirmation
      // @ts-expect-error Send confirmation evidence is readonly.
      confirmedSend.confirmation.emailId = emailId
    }

    expect([
      pending,
      inFlight,
      retrying.nextAttemptAt,
      confirmedUpdate,
      confirmedSend.confirmation.emailId,
      failed,
      invalidPending,
      retryWithoutInstant,
    ]).toHaveLength(8)
  })

  it('preserves Send-only confirmation after lifecycle narrowing', () => {
    function inspectSend(mutation: SendMutation): void {
      if (mutation.lifecycle.status === 'confirmed') {
        void mutation.lifecycle.confirmation.emailId
      }
    }

    function inspectKeyword(mutation: KeywordMutation): void {
      if (mutation.lifecycle.status === 'confirmed') {
        // @ts-expect-error Confirmed KeywordMutation has no Send confirmation.
        void mutation.lifecycle.confirmation
      }
    }

    function inspectMembership(mutation: MailboxMembershipMutation): void {
      if (mutation.lifecycle.status === 'confirmed') {
        // @ts-expect-error Confirmed MembershipMutation has no Send confirmation.
        void mutation.lifecycle.confirmation
      }
    }

    expect([inspectSend, inspectKeyword, inspectMembership]).toHaveLength(3)
  })

  it('closes lifecycle statuses to the five approved values', () => {
    const sendLifecycle: SendMutationLifecycle = {
      status: 'pending',
      attemptCount: 0,
    }
    const updateLifecycle: EmailUpdateLifecycle = {
      status: 'inFlight',
      attemptCount: 1,
    }

    const reconciled: SendMutationLifecycle = {
      // @ts-expect-error Reconciled is not a D-08 lifecycle status.
      status: 'reconciled',
      attemptCount: 1,
    }

    expect([sendLifecycle, updateLifecycle, reconciled]).toHaveLength(3)
  })

  it('rejects forbidden common mutation concepts', () => {
    const collectionState = collectionSyncStateFromString('state')

    // @ts-expect-error updatedAt is outside the D-08 core.
    acceptPendingMutation({ ...validSend, updatedAt: createdAt })
    // @ts-expect-error Raw errors are outside the D-08 core.
    acceptPendingMutation({ ...validSend, lastError: null })
    // @ts-expect-error Retry count is represented by lifecycle.attemptCount.
    acceptPendingMutation({ ...validSend, retryCount: 0 })
    // @ts-expect-error SQLite row IDs are persistence-only.
    acceptPendingMutation({ ...validSend, rowId: 1 })
    // @ts-expect-error payloadVersion belongs to a future persistence codec.
    acceptPendingMutation({ ...validSend, payloadVersion: 1 })
    // @ts-expect-error PendingMutation has no generic payload.
    acceptPendingMutation({ ...validSend, payload: {} })
    // @ts-expect-error PendingMutation has no generic target type.
    acceptPendingMutation({ ...validSend, targetType: 'email' })
    // @ts-expect-error PendingMutation has no generic target ID.
    acceptPendingMutation({ ...validSend, targetId: emailId })
    // @ts-expect-error Collection state is not a mutation precondition.
    acceptPendingMutation({ ...validSend, collectionState })
    // @ts-expect-error Query state belongs to MailboxView.
    acceptPendingMutation({ ...validSend, queryState: 'query' })
    // @ts-expect-error ifInState is JMAP transport vocabulary.
    acceptPendingMutation({ ...validSend, ifInState: 'state' })
    // @ts-expect-error Base state is not retained in Domain mutations.
    acceptPendingMutation({ ...validSend, baseState: 'state' })

    expect(true).toBe(true)
  })

  it('rejects forbidden Send, Keyword and Membership fields', () => {
    // @ts-expect-error SendMutation has no prior target Email ID.
    acceptSendMutation({ ...validSend, emailId })
    // @ts-expect-error EmailSubmissionId is a JMAP execution concern.
    acceptSendMutation({ ...validSend, emailSubmissionId: 'submission' })
    // @ts-expect-error Creation IDs are JMAP transport concerns.
    acceptSendMutation({ ...validSend, creationId: 'creation' })
    // @ts-expect-error SMTP envelope is outside Domain.
    acceptSendMutation({ ...validSend, envelope: {} })
    // @ts-expect-error Outbound attachments are outside the MVP.
    acceptSendMutation({ ...validSend, attachments: [] })

    // @ts-expect-error KeywordMutation stores no rollback-before snapshot.
    acceptKeywordMutation({ ...validKeyword, beforeKeywords: new Set() })
    // @ts-expect-error KeywordMutation stores no final-after snapshot.
    acceptKeywordMutation({ ...validKeyword, afterKeywords: new Set() })

    // @ts-expect-error MembershipMutation stores no replacement final set.
    acceptMembershipMutation({ ...validMembership, finalMailboxIds: [] })
    // @ts-expect-error MembershipMutation stores no rollback-before snapshot.
    acceptMembershipMutation({ ...validMembership, beforeMailboxIds: [] })

    expect(true).toBe(true)
  })

  it('does not permit fake Email state inside SendMutation', () => {
    function rejectFakeEmail(domainEmail: Email): void {
      // @ts-expect-error SendMutation does not contain a confirmed Email.
      acceptSendMutation({ ...validSend, email: domainEmail })
      // @ts-expect-error SendMutation has no temporary Email.
      acceptSendMutation({ ...validSend, temporaryEmail: domainEmail })
      // @ts-expect-error SendMutation has no provisional Email.
      acceptSendMutation({ ...validSend, provisionalEmail: domainEmail })
    }

    expect(rejectFakeEmail).toBeDefined()
  })

  it('does not let creation factories accept arbitrary lifecycle state', () => {
    sendMutation({
      mutationId,
      accountKey,
      createdAt,
      intent,
      // @ts-expect-error New SendMutation lifecycle is controlled by its factory.
      lifecycle: { status: 'confirmed', attemptCount: 1 },
    })
    keywordMutation({
      mutationId,
      accountKey,
      createdAt,
      emailId,
      change,
      // @ts-expect-error New KeywordMutation lifecycle is controlled by its factory.
      lifecycle: { status: 'failedTerminal', attemptCount: 1 },
    })

    expect(true).toBe(true)
  })
})
