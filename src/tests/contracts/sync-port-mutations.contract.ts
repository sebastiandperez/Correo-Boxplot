import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { Account } from '../../domain/account'
import { email, keywordSet, type Email } from '../../domain/email'
import type { MutationId } from '../../domain/ids'
import type { Identity } from '../../domain/identity'
import type { EmailMailbox, Mailbox } from '../../domain/mailbox'
import {
  confirmSendMutation,
  failMutationTerminal,
  keywordChange,
  keywordMutation,
  mailboxMembershipChange,
  mailboxMembershipMutation,
  scheduleMutationRetry,
  sendConfirmation,
  sendMutation,
  startMutationAttempt,
  type KeywordMutation,
  type MailboxMembershipMutation,
  type PendingMutation,
  type SendMutation,
} from '../../domain/pending-mutation'
import type { ReadRepository } from '../../ports/read-repository'
import type {
  EmailSyncRecord,
  SyncPort,
  WriteResult,
} from '../../ports/sync-port'
import { expectErrorKind, unwrapOk } from './assertions'
import {
  createTestCollectionSyncCursor,
  createTestEmailMailbox,
  createTestFixtures,
  createTestIdentity,
  createTestMailbox,
  createTestMutationInstant,
  createTestSendIntent,
} from './fixtures'
import type {
  LocalEngineContractHarness,
  LocalEngineContractRuntime,
} from './harness'

function expectUnorderedExact<T>(
  actual: readonly T[],
  expected: readonly T[],
): void {
  expect(actual).toHaveLength(expected.length)

  for (const expectedValue of expected) {
    expect(actual).toContainEqual(expectedValue)
  }
}

async function expectWriteOk(operation: Promise<WriteResult>): Promise<void> {
  unwrapOk(await operation)
}

async function expectWriteConflict(
  operation: Promise<WriteResult>,
): Promise<void> {
  expectErrorKind(await operation, 'conflict')
}

async function registerAccounts(
  syncPort: SyncPort,
  accounts: readonly Account[],
): Promise<void> {
  for (const value of accounts) {
    await expectWriteOk(syncPort.registerAccount(value))
  }
}

function emailRecord(
  value: Email,
  memberships: readonly EmailMailbox[] = [],
): EmailSyncRecord {
  return { email: value, memberships }
}

async function replaceEmails(
  syncPort: SyncPort,
  owner: Account,
  snapshot: readonly EmailSyncRecord[],
): Promise<void> {
  await expectWriteOk(
    syncPort.applyCollectionSync({
      kind: 'email',
      mode: 'replace',
      expectedCursor: { kind: 'absent' },
      nextCursor: createTestCollectionSyncCursor(
        owner,
        'email',
        'mutation-suite-email-setup',
      ),
      snapshot,
    }),
  )
}

async function replaceMailboxes(
  syncPort: SyncPort,
  owner: Account,
  snapshot: readonly Mailbox[],
): Promise<void> {
  await expectWriteOk(
    syncPort.applyCollectionSync({
      kind: 'mailbox',
      mode: 'replace',
      expectedCursor: { kind: 'absent' },
      nextCursor: createTestCollectionSyncCursor(
        owner,
        'mailbox',
        'mutation-suite-mailbox-setup',
      ),
      snapshot,
    }),
  )
}

async function expectMutationPresent(
  readRepository: ReadRepository,
  expected: PendingMutation,
): Promise<void> {
  expect(
    unwrapOk(
      await readRepository.readPendingMutation(
        expected.accountKey,
        expected.mutationId,
      ),
    ),
  ).toEqual({ kind: 'present', value: expected })
}

async function expectMutationAbsent(
  readRepository: ReadRepository,
  mutation: PendingMutation,
): Promise<void> {
  expect(
    unwrapOk(
      await readRepository.readPendingMutation(
        mutation.accountKey,
        mutation.mutationId,
      ),
    ),
  ).toEqual({ kind: 'absent' })
}

async function expectEmailExact(
  readRepository: ReadRepository,
  expected: Email,
): Promise<void> {
  expect(unwrapOk(await readRepository.readEmail(expected.id))).toEqual({
    kind: 'present',
    value: expected,
  })
}

async function expectMemberships(
  readRepository: ReadRepository,
  owner: Email,
  expected: readonly EmailMailbox[],
): Promise<void> {
  const result = unwrapOk(await readRepository.readEmailMemberships(owner.id))
  expect(result.kind).toBe('present')
  if (result.kind === 'present') {
    expectUnorderedExact(result.value, expected)
  }
}

function sendWithMutationId(
  owner: Account,
  selectedIdentity: Identity,
  mutationId: MutationId,
  token: string,
): SendMutation {
  return sendMutation({
    mutationId,
    accountKey: owner.key,
    createdAt: createTestMutationInstant(),
    intent: createTestSendIntent(selectedIdentity, token),
  })
}

function keywordWithMutationId(
  owner: Account,
  ownerEmail: Email,
  mutationId: MutationId,
  add: readonly string[],
  remove: readonly string[],
): KeywordMutation {
  return keywordMutation({
    mutationId,
    accountKey: owner.key,
    createdAt: createTestMutationInstant(),
    emailId: ownerEmail.id,
    change: keywordChange({
      add: keywordSet(add),
      remove: keywordSet(remove),
    }),
  })
}

function membershipWithMutationId(
  owner: Account,
  ownerEmail: Email,
  mutationId: MutationId,
  add: readonly Mailbox[],
  remove: readonly Mailbox[],
): MailboxMembershipMutation {
  return mailboxMembershipMutation({
    mutationId,
    accountKey: owner.key,
    createdAt: createTestMutationInstant(),
    emailId: ownerEmail.id,
    change: mailboxMembershipChange({
      add: add.map((value) => value.id),
      remove: remove.map((value) => value.id),
    }),
  })
}

function emailWithKeywords(source: Email, keywords: readonly string[]): Email {
  return email({ ...source, keywords: keywordSet(keywords) })
}

async function persistInFlight(
  syncPort: SyncPort,
  pending: SendMutation,
): Promise<SendMutation> {
  await expectWriteOk(syncPort.stageSendMutation(pending))
  const inFlight = startMutationAttempt(pending)
  await expectWriteOk(
    syncPort.replacePendingMutationIfCurrent(pending, inFlight),
  )
  return inFlight
}

async function persistRetrying(
  syncPort: SyncPort,
  pending: SendMutation,
): Promise<SendMutation> {
  const inFlight = await persistInFlight(syncPort, pending)
  const retrying = scheduleMutationRetry(
    inFlight,
    createTestMutationInstant('2026-01-01T00:05:00.000Z'),
  )
  await expectWriteOk(
    syncPort.replacePendingMutationIfCurrent(inFlight, retrying),
  )
  return retrying
}

async function persistConfirmed(
  syncPort: SyncPort,
  pending: SendMutation,
  confirmationEmail: Email,
): Promise<SendMutation> {
  const inFlight = await persistInFlight(syncPort, pending)
  const confirmed = confirmSendMutation(
    inFlight,
    sendConfirmation(confirmationEmail.id),
  )
  await expectWriteOk(
    syncPort.replacePendingMutationIfCurrent(inFlight, confirmed),
  )
  return confirmed
}

async function persistFailedTerminal(
  syncPort: SyncPort,
  pending: SendMutation,
): Promise<SendMutation> {
  const inFlight = await persistInFlight(syncPort, pending)
  const failed = failMutationTerminal(inFlight)
  await expectWriteOk(
    syncPort.replacePendingMutationIfCurrent(inFlight, failed),
  )
  return failed
}

export function defineSyncPortMutationContract(
  harness: LocalEngineContractHarness,
): void {
  describe(`SyncPort mutation contract — ${harness.name}`, () => {
    let runtime: LocalEngineContractRuntime | undefined

    beforeEach(async () => {
      runtime = await harness.create()
    })

    afterEach(async () => {
      const runtimeToDispose = runtime
      runtime = undefined

      if (runtimeToDispose !== undefined) {
        await runtimeToDispose.dispose()
      }
    })

    function currentRuntime(): LocalEngineContractRuntime {
      if (runtime === undefined) {
        throw new Error('SyncPort mutation contract runtime is not available')
      }

      return runtime
    }

    describe('Send staging', () => {
      it('SP-S01 requires the Account owner before staging Send', async () => {
        const { sendMutationA } = createTestFixtures()
        const { readRepository, syncPort } = currentRuntime()

        await expectWriteConflict(syncPort.stageSendMutation(sendMutationA))

        expect(
          unwrapOk(
            await readRepository.readPendingMutation(
              sendMutationA.accountKey,
              sendMutationA.mutationId,
            ),
          ),
        ).toEqual({ kind: 'ownerAbsent' })
      })

      it('SP-S02 stages a valid SendMutation durably', async () => {
        const { accountA, sendMutationA } = createTestFixtures()
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])

        await expectWriteOk(syncPort.stageSendMutation(sendMutationA))

        await expectMutationPresent(readRepository, sendMutationA)
        expect(
          unwrapOk(await readRepository.listPendingMutations(accountA.key)),
        ).toEqual({ kind: 'present', value: [sendMutationA] })
      })

      it('SP-S03 rejects a duplicate MutationId without overwriting Send', async () => {
        const { accountA, identityA, sendMutationA } = createTestFixtures()
        const replacement = sendWithMutationId(
          accountA,
          identityA,
          sendMutationA.mutationId,
          'different-payload',
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await expectWriteOk(syncPort.stageSendMutation(sendMutationA))

        await expectWriteConflict(syncPort.stageSendMutation(replacement))

        await expectMutationPresent(readRepository, sendMutationA)
      })

      it('SP-S04 does not require a cached Identity row for Send staging', async () => {
        const { accountA, identityA, sendMutationA } = createTestFixtures()
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])

        await expectWriteOk(syncPort.stageSendMutation(sendMutationA))

        expect(
          unwrapOk(await readRepository.readIdentity(identityA.id)),
        ).toEqual({ kind: 'absent' })
        await expectMutationPresent(readRepository, sendMutationA)
      })

      it('SP-S05 stages Send without changing observable Email projections', async () => {
        const {
          accountA,
          emailA1,
          emailA2,
          inboxA,
          emptyInboxViewA,
          sendMutationA,
        } = createTestFixtures()
        const membership = createTestEmailMailbox(emailA1, inboxA)
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceMailboxes(syncPort, accountA, [inboxA])
        await replaceEmails(syncPort, accountA, [
          emailRecord(emailA1, [membership]),
        ])
        await expectWriteOk(syncPort.replaceMailboxView(emptyInboxViewA))
        const baselineEmail = unwrapOk(
          await readRepository.readEmail(emailA1.id),
        )
        const baselineMissingEmail = unwrapOk(
          await readRepository.readEmail(emailA2.id),
        )
        const baselineMemberships = unwrapOk(
          await readRepository.readEmailMemberships(emailA1.id),
        )
        const baselineView = unwrapOk(
          await readRepository.readMailboxView(emptyInboxViewA.spec),
        )

        await expectWriteOk(syncPort.stageSendMutation(sendMutationA))

        await expectMutationPresent(readRepository, sendMutationA)
        expect(unwrapOk(await readRepository.readEmail(emailA1.id))).toEqual(
          baselineEmail,
        )
        expect(unwrapOk(await readRepository.readEmail(emailA2.id))).toEqual(
          baselineMissingEmail,
        )
        expect(
          unwrapOk(await readRepository.readEmailMemberships(emailA1.id)),
        ).toEqual(baselineMemberships)
        expect(
          unwrapOk(await readRepository.readMailboxView(emptyInboxViewA.spec)),
        ).toEqual(baselineView)
      })
    })

    describe('Mutation identity namespace', () => {
      it('SP-ID01 keeps MutationId unique across kinds within one Account', async () => {
        const { accountA, emailA2, sendMutationA } = createTestFixtures()
        const keywordMutationWithSameId = keywordWithMutationId(
          accountA,
          emailA2,
          sendMutationA.mutationId,
          ['$flagged'],
          [],
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceEmails(syncPort, accountA, [emailRecord(emailA2)])
        await expectWriteOk(syncPort.stageSendMutation(sendMutationA))

        await expectWriteConflict(
          syncPort.applyOptimisticKeywordMutation(keywordMutationWithSameId),
        )

        await expectMutationPresent(readRepository, sendMutationA)
        await expectEmailExact(readRepository, emailA2)
      })

      it('SP-ID02 scopes the same MutationId independently across Accounts', async () => {
        const { accountA, accountB, sendMutationA } = createTestFixtures()
        const identityB = createTestIdentity(accountB, 'B')
        const sendB = sendWithMutationId(
          accountB,
          identityB,
          sendMutationA.mutationId,
          'B-same-id',
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA, accountB])

        await expectWriteOk(syncPort.stageSendMutation(sendMutationA))
        await expectWriteOk(syncPort.stageSendMutation(sendB))

        await expectMutationPresent(readRepository, sendMutationA)
        await expectMutationPresent(readRepository, sendB)
      })
    })

    describe('Optimistic keyword mutations', () => {
      it('SP-K01 adds a keyword and persists its mutation together', async () => {
        const { accountA, emailA2, keywordMutationA } = createTestFixtures()
        const mutation = keywordWithMutationId(
          accountA,
          emailA2,
          keywordMutationA.mutationId,
          ['$flagged'],
          [],
        )
        const expectedEmail = emailWithKeywords(emailA2, ['$flagged'])
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceEmails(syncPort, accountA, [emailRecord(emailA2)])

        await expectWriteOk(syncPort.applyOptimisticKeywordMutation(mutation))

        await expectEmailExact(readRepository, expectedEmail)
        await expectMutationPresent(readRepository, mutation)
      })

      it('SP-K02 removes a keyword and persists its mutation together', async () => {
        const { accountA, emailA1, keywordMutationA } = createTestFixtures()
        const mutation = keywordWithMutationId(
          accountA,
          emailA1,
          keywordMutationA.mutationId,
          [],
          ['$seen'],
        )
        const expectedEmail = emailWithKeywords(emailA1, ['custom-E1'])
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceEmails(syncPort, accountA, [emailRecord(emailA1)])

        await expectWriteOk(syncPort.applyOptimisticKeywordMutation(mutation))

        await expectEmailExact(readRepository, expectedEmail)
        await expectMutationPresent(readRepository, mutation)
      })

      it('SP-K03 persists an add mutation when the keyword already exists', async () => {
        const { accountA, emailA1, keywordMutationA } = createTestFixtures()
        const mutation = keywordWithMutationId(
          accountA,
          emailA1,
          keywordMutationA.mutationId,
          ['$seen'],
          [],
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceEmails(syncPort, accountA, [emailRecord(emailA1)])

        await expectWriteOk(syncPort.applyOptimisticKeywordMutation(mutation))

        await expectEmailExact(readRepository, emailA1)
        await expectMutationPresent(readRepository, mutation)
      })

      it('SP-K04 persists a remove mutation when the keyword is absent', async () => {
        const { accountA, emailA1, keywordMutationA } = createTestFixtures()
        const mutation = keywordWithMutationId(
          accountA,
          emailA1,
          keywordMutationA.mutationId,
          [],
          ['$not-present'],
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceEmails(syncPort, accountA, [emailRecord(emailA1)])

        await expectWriteOk(syncPort.applyOptimisticKeywordMutation(mutation))

        await expectEmailExact(readRepository, emailA1)
        await expectMutationPresent(readRepository, mutation)
      })

      it('SP-K05 rejects a missing Email target without persisting a mutation', async () => {
        const { accountA, emailA2, keywordMutationA } = createTestFixtures()
        const mutation = keywordWithMutationId(
          accountA,
          emailA2,
          keywordMutationA.mutationId,
          ['$flagged'],
          [],
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])

        await expectWriteConflict(
          syncPort.applyOptimisticKeywordMutation(mutation),
        )

        expect(unwrapOk(await readRepository.readEmail(emailA2.id))).toEqual({
          kind: 'absent',
        })
        await expectMutationAbsent(readRepository, mutation)
      })

      it('SP-K06 rejects a duplicate MutationId without changing Email', async () => {
        const { accountA, emailA2, sendMutationA } = createTestFixtures()
        const mutation = keywordWithMutationId(
          accountA,
          emailA2,
          sendMutationA.mutationId,
          ['$flagged'],
          [],
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceEmails(syncPort, accountA, [emailRecord(emailA2)])
        await expectWriteOk(syncPort.stageSendMutation(sendMutationA))

        await expectWriteConflict(
          syncPort.applyOptimisticKeywordMutation(mutation),
        )

        await expectEmailExact(readRepository, emailA2)
        await expectMutationPresent(readRepository, sendMutationA)
      })

      it('SP-K07 isolates an optimistic keyword write by Account', async () => {
        const { accountA, accountB, emailA1, emailB1, keywordMutationA } =
          createTestFixtures()
        const mutation = keywordWithMutationId(
          accountA,
          emailA1,
          keywordMutationA.mutationId,
          ['account-A-only'],
          [],
        )
        const expectedEmailA = emailWithKeywords(emailA1, [
          '$seen',
          'custom-E1',
          'account-A-only',
        ])
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA, accountB])
        await replaceEmails(syncPort, accountA, [emailRecord(emailA1)])
        await replaceEmails(syncPort, accountB, [emailRecord(emailB1)])

        await expectWriteOk(syncPort.applyOptimisticKeywordMutation(mutation))

        await expectEmailExact(readRepository, expectedEmailA)
        await expectEmailExact(readRepository, emailB1)
        await expectMutationPresent(readRepository, mutation)
        expect(
          unwrapOk(
            await readRepository.readPendingMutation(
              accountB.key,
              mutation.mutationId,
            ),
          ),
        ).toEqual({ kind: 'absent' })
      })
    })

    describe('Optimistic Mailbox membership mutations', () => {
      it('SP-MM01 adds a membership and persists its mutation together', async () => {
        const { accountA, emailA1, inboxA, archiveA, membershipMutationA } =
          createTestFixtures()
        const initial = createTestEmailMailbox(emailA1, inboxA)
        const added = createTestEmailMailbox(emailA1, archiveA)
        const mutation = membershipWithMutationId(
          accountA,
          emailA1,
          membershipMutationA.mutationId,
          [archiveA],
          [],
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceMailboxes(syncPort, accountA, [inboxA, archiveA])
        await replaceEmails(syncPort, accountA, [
          emailRecord(emailA1, [initial]),
        ])

        await expectWriteOk(
          syncPort.applyOptimisticMailboxMembershipMutation(mutation),
        )

        await expectMemberships(readRepository, emailA1, [initial, added])
        await expectMutationPresent(readRepository, mutation)
      })

      it('SP-MM02 removes a membership while another remains', async () => {
        const { accountA, emailA1, inboxA, archiveA, membershipMutationA } =
          createTestFixtures()
        const inboxMembership = createTestEmailMailbox(emailA1, inboxA)
        const archiveMembership = createTestEmailMailbox(emailA1, archiveA)
        const mutation = membershipWithMutationId(
          accountA,
          emailA1,
          membershipMutationA.mutationId,
          [],
          [inboxA],
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceMailboxes(syncPort, accountA, [inboxA, archiveA])
        await replaceEmails(syncPort, accountA, [
          emailRecord(emailA1, [inboxMembership, archiveMembership]),
        ])

        await expectWriteOk(
          syncPort.applyOptimisticMailboxMembershipMutation(mutation),
        )

        await expectMemberships(readRepository, emailA1, [archiveMembership])
        await expectMutationPresent(readRepository, mutation)
      })

      it('SP-MM03 persists an add mutation for an existing membership', async () => {
        const { accountA, emailA1, inboxA, archiveA, membershipMutationA } =
          createTestFixtures()
        const inboxMembership = createTestEmailMailbox(emailA1, inboxA)
        const archiveMembership = createTestEmailMailbox(emailA1, archiveA)
        const mutation = membershipWithMutationId(
          accountA,
          emailA1,
          membershipMutationA.mutationId,
          [archiveA],
          [],
        )
        const initial = [inboxMembership, archiveMembership]
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceMailboxes(syncPort, accountA, [inboxA, archiveA])
        await replaceEmails(syncPort, accountA, [emailRecord(emailA1, initial)])

        await expectWriteOk(
          syncPort.applyOptimisticMailboxMembershipMutation(mutation),
        )

        await expectMemberships(readRepository, emailA1, initial)
        await expectMutationPresent(readRepository, mutation)
      })

      it('SP-MM04 persists a remove mutation for an absent membership', async () => {
        const { accountA, emailA1, inboxA, archiveA, membershipMutationA } =
          createTestFixtures()
        const thirdMailbox = createTestMailbox(accountA, 'third')
        const initial = [
          createTestEmailMailbox(emailA1, inboxA),
          createTestEmailMailbox(emailA1, archiveA),
        ]
        const mutation = membershipWithMutationId(
          accountA,
          emailA1,
          membershipMutationA.mutationId,
          [],
          [thirdMailbox],
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceMailboxes(syncPort, accountA, [
          inboxA,
          archiveA,
          thirdMailbox,
        ])
        await replaceEmails(syncPort, accountA, [emailRecord(emailA1, initial)])

        await expectWriteOk(
          syncPort.applyOptimisticMailboxMembershipMutation(mutation),
        )

        await expectMemberships(readRepository, emailA1, initial)
        await expectMutationPresent(readRepository, mutation)
      })

      it('SP-MM05 applies an add and remove as one atomic move', async () => {
        const { accountA, emailA1, inboxA, archiveA, membershipMutationA } =
          createTestFixtures()
        const initial = createTestEmailMailbox(emailA1, inboxA)
        const finalMembership = createTestEmailMailbox(emailA1, archiveA)
        const mutation = membershipWithMutationId(
          accountA,
          emailA1,
          membershipMutationA.mutationId,
          [archiveA],
          [inboxA],
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceMailboxes(syncPort, accountA, [inboxA, archiveA])
        await replaceEmails(syncPort, accountA, [
          emailRecord(emailA1, [initial]),
        ])

        await expectWriteOk(
          syncPort.applyOptimisticMailboxMembershipMutation(mutation),
        )

        await expectMemberships(readRepository, emailA1, [finalMembership])
        await expectMutationPresent(readRepository, mutation)
      })

      it('SP-MM06 rejects a mutation that would leave no membership', async () => {
        const { accountA, emailA1, inboxA, membershipMutationA } =
          createTestFixtures()
        const initial = createTestEmailMailbox(emailA1, inboxA)
        const mutation = membershipWithMutationId(
          accountA,
          emailA1,
          membershipMutationA.mutationId,
          [],
          [inboxA],
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceMailboxes(syncPort, accountA, [inboxA])
        await replaceEmails(syncPort, accountA, [
          emailRecord(emailA1, [initial]),
        ])

        await expectWriteConflict(
          syncPort.applyOptimisticMailboxMembershipMutation(mutation),
        )

        await expectMemberships(readRepository, emailA1, [initial])
        await expectMutationAbsent(readRepository, mutation)
      })

      it('SP-MM07 requires every referenced Mailbox to exist locally', async () => {
        const { accountA, emailA1, inboxA, archiveA, membershipMutationA } =
          createTestFixtures()
        const initial = createTestEmailMailbox(emailA1, inboxA)
        const mutation = membershipWithMutationId(
          accountA,
          emailA1,
          membershipMutationA.mutationId,
          [archiveA],
          [],
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceMailboxes(syncPort, accountA, [inboxA])
        await replaceEmails(syncPort, accountA, [
          emailRecord(emailA1, [initial]),
        ])

        await expectWriteConflict(
          syncPort.applyOptimisticMailboxMembershipMutation(mutation),
        )

        await expectMemberships(readRepository, emailA1, [initial])
        await expectMutationAbsent(readRepository, mutation)
      })

      it('SP-MM08 requires the target Email to exist locally', async () => {
        const { accountA, emailA1, inboxA, membershipMutationA } =
          createTestFixtures()
        const mutation = membershipWithMutationId(
          accountA,
          emailA1,
          membershipMutationA.mutationId,
          [inboxA],
          [],
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceMailboxes(syncPort, accountA, [inboxA])

        await expectWriteConflict(
          syncPort.applyOptimisticMailboxMembershipMutation(mutation),
        )

        expect(unwrapOk(await readRepository.readEmail(emailA1.id))).toEqual({
          kind: 'absent',
        })
        await expectMutationAbsent(readRepository, mutation)
      })

      it('SP-MM09 rejects a duplicate MutationId without changing memberships', async () => {
        const { accountA, emailA1, inboxA, archiveA, sendMutationA } =
          createTestFixtures()
        const initial = createTestEmailMailbox(emailA1, inboxA)
        const mutation = membershipWithMutationId(
          accountA,
          emailA1,
          sendMutationA.mutationId,
          [archiveA],
          [],
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceMailboxes(syncPort, accountA, [inboxA, archiveA])
        await replaceEmails(syncPort, accountA, [
          emailRecord(emailA1, [initial]),
        ])
        await expectWriteOk(syncPort.stageSendMutation(sendMutationA))

        await expectWriteConflict(
          syncPort.applyOptimisticMailboxMembershipMutation(mutation),
        )

        await expectMemberships(readRepository, emailA1, [initial])
        await expectMutationPresent(readRepository, sendMutationA)
      })
    })

    describe('PendingMutation full-snapshot CAS', () => {
      it('SP-CAS01 replaces an exact pending snapshot with inFlight', async () => {
        const { accountA, sendMutationA } = createTestFixtures()
        const inFlight = startMutationAttempt(sendMutationA)
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await expectWriteOk(syncPort.stageSendMutation(sendMutationA))

        await expectWriteOk(
          syncPort.replacePendingMutationIfCurrent(sendMutationA, inFlight),
        )

        await expectMutationPresent(readRepository, inFlight)
      })

      it('SP-CAS02 rejects a stale expected snapshot after a transition', async () => {
        const { accountA, sendMutationA } = createTestFixtures()
        const inFlight = startMutationAttempt(sendMutationA)
        const competingNext = startMutationAttempt(sendMutationA)
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await expectWriteOk(syncPort.stageSendMutation(sendMutationA))
        await expectWriteOk(
          syncPort.replacePendingMutationIfCurrent(sendMutationA, inFlight),
        )

        await expectWriteConflict(
          syncPort.replacePendingMutationIfCurrent(
            sendMutationA,
            competingNext,
          ),
        )

        await expectMutationPresent(readRepository, inFlight)
      })

      it('SP-CAS03 compares the complete expected snapshot, including payload', async () => {
        const { accountA, emailA2, keywordMutationA } = createTestFixtures()
        const persisted = keywordWithMutationId(
          accountA,
          emailA2,
          keywordMutationA.mutationId,
          ['$flagged'],
          [],
        )
        const differentExpected = keywordWithMutationId(
          accountA,
          emailA2,
          keywordMutationA.mutationId,
          ['different-payload'],
          [],
        )
        const nextFromDifferentExpected =
          startMutationAttempt(differentExpected)
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceEmails(syncPort, accountA, [emailRecord(emailA2)])
        await expectWriteOk(syncPort.applyOptimisticKeywordMutation(persisted))

        await expectWriteConflict(
          syncPort.replacePendingMutationIfCurrent(
            differentExpected,
            nextFromDifferentExpected,
          ),
        )

        await expectMutationPresent(readRepository, persisted)
      })

      it('SP-CAS04 rejects a next snapshot that changes immutable payload', async () => {
        const { accountA, emailA2, keywordMutationA } = createTestFixtures()
        const persisted = keywordWithMutationId(
          accountA,
          emailA2,
          keywordMutationA.mutationId,
          ['$flagged'],
          [],
        )
        const changedPayload = keywordWithMutationId(
          accountA,
          emailA2,
          keywordMutationA.mutationId,
          ['different-payload'],
          [],
        )
        const invalidNext = startMutationAttempt(changedPayload)
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceEmails(syncPort, accountA, [emailRecord(emailA2)])
        await expectWriteOk(syncPort.applyOptimisticKeywordMutation(persisted))

        await expectWriteConflict(
          syncPort.replacePendingMutationIfCurrent(persisted, invalidNext),
        )

        await expectMutationPresent(readRepository, persisted)
      })

      it('SP-CAS05 rejects a next snapshot with another mutation identity', async () => {
        const { accountA, identityA, sendMutationA, keywordMutationA } =
          createTestFixtures()
        const otherPending = sendWithMutationId(
          accountA,
          identityA,
          keywordMutationA.mutationId,
          'A1',
        )
        const invalidNext = startMutationAttempt(otherPending)
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await expectWriteOk(syncPort.stageSendMutation(sendMutationA))

        await expectWriteConflict(
          syncPort.replacePendingMutationIfCurrent(sendMutationA, invalidNext),
        )

        await expectMutationPresent(readRepository, sendMutationA)
        await expectMutationAbsent(readRepository, otherPending)
      })

      it('SP-CAS06 rejects replacement without a lifecycle transition', async () => {
        const { accountA, sendMutationA } = createTestFixtures()
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await expectWriteOk(syncPort.stageSendMutation(sendMutationA))

        await expectWriteConflict(
          syncPort.replacePendingMutationIfCurrent(
            sendMutationA,
            sendMutationA,
          ),
        )

        await expectMutationPresent(readRepository, sendMutationA)
      })

      it('SP-CAS07 rejects pending that skips directly to confirmed', async () => {
        const { accountA, emailA1, sendMutationA } = createTestFixtures()
        const inFlight = startMutationAttempt(sendMutationA)
        const confirmed = confirmSendMutation(
          inFlight,
          sendConfirmation(emailA1.id),
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await expectWriteOk(syncPort.stageSendMutation(sendMutationA))

        await expectWriteConflict(
          syncPort.replacePendingMutationIfCurrent(sendMutationA, confirmed),
        )

        await expectMutationPresent(readRepository, sendMutationA)
      })

      it('SP-CAS08 persists the valid inFlight to retrying transition', async () => {
        const { accountA, sendMutationA } = createTestFixtures()
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        const inFlight = await persistInFlight(syncPort, sendMutationA)
        const retrying = scheduleMutationRetry(
          inFlight,
          createTestMutationInstant('2026-01-01T00:05:00.000Z'),
        )

        await expectWriteOk(
          syncPort.replacePendingMutationIfCurrent(inFlight, retrying),
        )

        await expectMutationPresent(readRepository, retrying)
      })

      it('SP-CAS09 persists the valid retrying to inFlight transition', async () => {
        const { accountA, sendMutationA } = createTestFixtures()
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        const retrying = await persistRetrying(syncPort, sendMutationA)
        const secondAttempt = startMutationAttempt(retrying)

        await expectWriteOk(
          syncPort.replacePendingMutationIfCurrent(retrying, secondAttempt),
        )

        await expectMutationPresent(readRepository, secondAttempt)
      })

      it('SP-CAS10 persists inFlight to confirmed without automatic cleanup', async () => {
        const { accountA, emailA1, sendMutationA } = createTestFixtures()
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        const inFlight = await persistInFlight(syncPort, sendMutationA)
        const confirmed = confirmSendMutation(
          inFlight,
          sendConfirmation(emailA1.id),
        )

        await expectWriteOk(
          syncPort.replacePendingMutationIfCurrent(inFlight, confirmed),
        )

        await expectMutationPresent(readRepository, confirmed)
      })

      it('SP-CAS11 persists the valid inFlight to failedTerminal transition', async () => {
        const { accountA, sendMutationA } = createTestFixtures()
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        const inFlight = await persistInFlight(syncPort, sendMutationA)
        const failed = failMutationTerminal(inFlight)

        await expectWriteOk(
          syncPort.replacePendingMutationIfCurrent(inFlight, failed),
        )

        await expectMutationPresent(readRepository, failed)
      })

      it('SP-CAS12 rejects reactivation of a confirmed mutation', async () => {
        const { accountA, emailA1, sendMutationA } = createTestFixtures()
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        const confirmed = await persistConfirmed(
          syncPort,
          sendMutationA,
          emailA1,
        )

        await expectWriteConflict(
          syncPort.replacePendingMutationIfCurrent(confirmed, sendMutationA),
        )

        await expectMutationPresent(readRepository, confirmed)
      })

      it('SP-CAS13 rejects reactivation of a failedTerminal mutation', async () => {
        const { accountA, sendMutationA } = createTestFixtures()
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        const failed = await persistFailedTerminal(syncPort, sendMutationA)

        await expectWriteConflict(
          syncPort.replacePendingMutationIfCurrent(failed, sendMutationA),
        )

        await expectMutationPresent(readRepository, failed)
      })

      it('SP-CAS14 permits exactly one winner from two claims of the same snapshot', async () => {
        const { accountA, sendMutationA } = createTestFixtures()
        const nextClaim1 = startMutationAttempt(sendMutationA)
        const nextClaim2 = startMutationAttempt(sendMutationA)
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await expectWriteOk(syncPort.stageSendMutation(sendMutationA))

        const results = await Promise.all([
          syncPort.replacePendingMutationIfCurrent(sendMutationA, nextClaim1),
          syncPort.replacePendingMutationIfCurrent(sendMutationA, nextClaim2),
        ])

        expect(results.filter((result) => result.ok)).toHaveLength(1)
        expect(
          results.filter(
            (result) => !result.ok && result.error.kind === 'conflict',
          ),
        ).toHaveLength(1)
        await expectMutationPresent(readRepository, nextClaim1)
      })
    })

    describe('Confirmed mutation removal', () => {
      it('SP-RM01 removes an explicitly confirmed mutation', async () => {
        const { accountA, emailA1, sendMutationA } = createTestFixtures()
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        const confirmed = await persistConfirmed(
          syncPort,
          sendMutationA,
          emailA1,
        )

        await expectWriteOk(
          syncPort.removeConfirmedMutation(
            confirmed.accountKey,
            confirmed.mutationId,
          ),
        )

        await expectMutationAbsent(readRepository, confirmed)
        expect(
          unwrapOk(await readRepository.readAccount(accountA.key)),
        ).toEqual({ kind: 'present', value: accountA })
      })

      it('SP-RM02 rejects removal of a missing mutation', async () => {
        const { accountA, sendMutationA } = createTestFixtures()
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])

        await expectWriteConflict(
          syncPort.removeConfirmedMutation(
            accountA.key,
            sendMutationA.mutationId,
          ),
        )

        await expectMutationAbsent(readRepository, sendMutationA)
      })

      it('SP-RM03 rejects removal of a pending mutation', async () => {
        const { accountA, sendMutationA } = createTestFixtures()
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await expectWriteOk(syncPort.stageSendMutation(sendMutationA))

        await expectWriteConflict(
          syncPort.removeConfirmedMutation(
            sendMutationA.accountKey,
            sendMutationA.mutationId,
          ),
        )

        await expectMutationPresent(readRepository, sendMutationA)
      })

      it('SP-RM04 rejects removal of an inFlight mutation', async () => {
        const { accountA, sendMutationA } = createTestFixtures()
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        const inFlight = await persistInFlight(syncPort, sendMutationA)

        await expectWriteConflict(
          syncPort.removeConfirmedMutation(
            inFlight.accountKey,
            inFlight.mutationId,
          ),
        )

        await expectMutationPresent(readRepository, inFlight)
      })

      it('SP-RM05 rejects removal of a retrying mutation', async () => {
        const { accountA, sendMutationA } = createTestFixtures()
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        const retrying = await persistRetrying(syncPort, sendMutationA)

        await expectWriteConflict(
          syncPort.removeConfirmedMutation(
            retrying.accountKey,
            retrying.mutationId,
          ),
        )

        await expectMutationPresent(readRepository, retrying)
      })

      it('SP-RM06 rejects removal of a failedTerminal mutation', async () => {
        const { accountA, sendMutationA } = createTestFixtures()
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        const failed = await persistFailedTerminal(syncPort, sendMutationA)

        await expectWriteConflict(
          syncPort.removeConfirmedMutation(
            failed.accountKey,
            failed.mutationId,
          ),
        )

        await expectMutationPresent(readRepository, failed)
      })
    })
  })
}
