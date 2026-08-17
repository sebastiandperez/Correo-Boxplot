import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { Account } from '../../domain/account'
import { email, type Email } from '../../domain/email'
import type { EmailMailbox, Mailbox } from '../../domain/mailbox'
import {
  confirmSendMutation,
  sendConfirmation,
  startMutationAttempt,
} from '../../domain/pending-mutation'
import type {
  LocalChangeHint,
  LocalChangeSubscription,
} from '../../ports/local-change-source'
import type {
  CollectionCursorPrecondition,
  EmailSyncRecord,
  SyncPort,
  WriteResult,
} from '../../ports/sync-port'
import { expectErrorKind, expectHintCoverage, unwrapOk } from './assertions'
import {
  createTestCollectionSyncCursor,
  createTestEmail,
  createTestEmailMailbox,
  createTestFixtures,
  type TestFixtureSet,
} from './fixtures'
import type {
  LocalEngineContractHarness,
  LocalEngineContractRuntime,
} from './harness'
import {
  createNotificationRecorder,
  type NotificationRecorder,
} from './notification-recorder'

async function expectWriteOk(operation: Promise<WriteResult>): Promise<void> {
  unwrapOk(await operation)
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
  state: string,
  expectedCursor: CollectionCursorPrecondition = { kind: 'absent' },
): Promise<void> {
  await expectWriteOk(
    syncPort.applyCollectionSync({
      kind: 'email',
      mode: 'replace',
      expectedCursor,
      nextCursor: createTestCollectionSyncCursor(owner, 'email', state),
      snapshot,
    }),
  )
}

async function replaceMailboxes(
  syncPort: SyncPort,
  owner: Account,
  snapshot: readonly Mailbox[],
  state: string,
  expectedCursor: CollectionCursorPrecondition = { kind: 'absent' },
): Promise<void> {
  await expectWriteOk(
    syncPort.applyCollectionSync({
      kind: 'mailbox',
      mode: 'replace',
      expectedCursor,
      nextCursor: createTestCollectionSyncCursor(owner, 'mailbox', state),
      snapshot,
    }),
  )
}

async function subscribeRecorder(
  runtime: LocalEngineContractRuntime,
  recorder: NotificationRecorder,
  subscriptions: LocalChangeSubscription[],
): Promise<void> {
  subscriptions.push(
    unwrapOk(await runtime.localChangeSource.subscribe(recorder.listener)),
  )
}

async function expectCoverage(
  runtime: LocalEngineContractRuntime,
  recorder: NotificationRecorder,
  required: readonly LocalChangeHint[],
): Promise<void> {
  await runtime.settle()
  expectHintCoverage(recorder.hints(), required)
}

export function defineLocalEngineSystemContract(
  harness: LocalEngineContractHarness,
): void {
  describe(`Local Engine system contract — ${harness.name}`, () => {
    let runtime: LocalEngineContractRuntime | undefined
    let subscriptions: LocalChangeSubscription[] = []

    beforeEach(async () => {
      runtime = await harness.create()
      subscriptions = []
    })

    afterEach(async () => {
      for (const subscription of subscriptions) subscription.unsubscribe()
      subscriptions = []
      const current = runtime
      runtime = undefined
      if (current !== undefined) await current.dispose()
    })

    function currentRuntime(): LocalEngineContractRuntime {
      if (runtime === undefined)
        throw new Error('System contract runtime unavailable')
      return runtime
    }

    describe('Bootstrap', () => {
      it('LE-B01 supports safe subscribe, read, update, and reread', async () => {
        const active = currentRuntime()
        const { accountA } = createTestFixtures()
        const recorder = createNotificationRecorder()
        await subscribeRecorder(active, recorder, subscriptions)

        expect(await active.readRepository.listAccounts()).toEqual({
          ok: true,
          value: [],
        })
        await expectWriteOk(active.syncPort.registerAccount(accountA))
        await expectCoverage(active, recorder, [{ kind: 'accounts' }])
        expect(await active.readRepository.listAccounts()).toEqual({
          ok: true,
          value: [accountA],
        })
      })

      it('LE-B02 does not lose an update between subscribe and initial read', async () => {
        const active = currentRuntime()
        const { accountA } = createTestFixtures()
        const recorder = createNotificationRecorder()
        await subscribeRecorder(active, recorder, subscriptions)

        await expectWriteOk(active.syncPort.registerAccount(accountA))

        expect(await active.readRepository.listAccounts()).toEqual({
          ok: true,
          value: [accountA],
        })
        await expectCoverage(active, recorder, [{ kind: 'accounts' }])
      })

      it('LE-B03 lets two consumers reread the same committed state', async () => {
        const active = currentRuntime()
        const { accountA } = createTestFixtures()
        const first = createNotificationRecorder()
        const second = createNotificationRecorder()
        await subscribeRecorder(active, first, subscriptions)
        await subscribeRecorder(active, second, subscriptions)

        await expectWriteOk(active.syncPort.registerAccount(accountA))
        await expectCoverage(active, first, [{ kind: 'accounts' }])
        await expectCoverage(active, second, [{ kind: 'accounts' }])

        const firstRead = await active.readRepository.listAccounts()
        const secondRead = await active.readRepository.listAccounts()
        expect(firstRead).toEqual(secondRead)
        expect(firstRead).toEqual({ ok: true, value: [accountA] })
      })
    })

    describe('Commit consistency', () => {
      it('LE-C01 exposes committed state when notification is observed', async () => {
        const active = currentRuntime()
        const { accountA } = createTestFixtures()
        const observations: Promise<void>[] = []
        subscriptions.push(
          unwrapOk(
            await active.localChangeSource.subscribe((batch) => {
              if (batch.hints.some((hint) => hint.kind === 'accounts')) {
                observations.push(
                  active.readRepository
                    .readAccount(accountA.key)
                    .then((result) => {
                      expect(result).toEqual({
                        ok: true,
                        value: { kind: 'present', value: accountA },
                      })
                    }),
                )
              }
            }),
          ),
        )

        await expectWriteOk(active.syncPort.registerAccount(accountA))
        await active.settle()

        expect(observations.length).toBeGreaterThan(0)
        await Promise.all(observations)
      })

      it('LE-C02 exposes Email, memberships, and cursor from one commit', async () => {
        const active = currentRuntime()
        const { accountA, emailA1, inboxA } = createTestFixtures()
        const membership = createTestEmailMailbox(emailA1, inboxA)
        const cursor = createTestCollectionSyncCursor(
          accountA,
          'email',
          'system-c02',
        )
        const recorder = createNotificationRecorder()
        await registerAccounts(active.syncPort, [accountA])
        await subscribeRecorder(active, recorder, subscriptions)

        await expectWriteOk(
          active.syncPort.applyCollectionSync({
            kind: 'email',
            mode: 'replace',
            expectedCursor: { kind: 'absent' },
            nextCursor: cursor,
            snapshot: [emailRecord(emailA1, [membership])],
          }),
        )
        await expectCoverage(active, recorder, [
          { kind: 'emails', accountKey: accountA.key },
          { kind: 'emailMemberships', accountKey: accountA.key },
          { kind: 'syncCursor', accountKey: accountA.key, dataType: 'email' },
        ])

        expect(await active.readRepository.readEmail(emailA1.id)).toEqual({
          ok: true,
          value: { kind: 'present', value: emailA1 },
        })
        expect(
          await active.readRepository.readEmailMemberships(emailA1.id),
        ).toEqual({ ok: true, value: { kind: 'present', value: [membership] } })
        expect(
          await active.readRepository.readCollectionSyncCursor(
            accountA.key,
            'email',
          ),
        ).toEqual({ ok: true, value: { kind: 'present', value: cursor } })
      })

      it('LE-C03 leaves no systemic partial effect after conflict', async () => {
        const active = currentRuntime()
        const { accountA, emailA1, emailA2, inboxA } = createTestFixtures()
        const firstCursor = createTestCollectionSyncCursor(
          accountA,
          'email',
          'system-c03-1',
        )
        const staleCursor = createTestCollectionSyncCursor(
          accountA,
          'email',
          'system-c03-stale',
        )
        const nextCursor = createTestCollectionSyncCursor(
          accountA,
          'email',
          'system-c03-2',
        )
        const membershipA1 = createTestEmailMailbox(emailA1, inboxA)
        const membershipA2 = createTestEmailMailbox(emailA2, inboxA)
        await registerAccounts(active.syncPort, [accountA])
        await replaceEmails(
          active.syncPort,
          accountA,
          [
            emailRecord(emailA1, [membershipA1]),
            emailRecord(emailA2, [membershipA2]),
          ],
          firstCursor.state,
        )
        const recorder = createNotificationRecorder()
        await subscribeRecorder(active, recorder, subscriptions)
        await active.settle()
        recorder.clear()
        const updated = email({ ...emailA1, subject: 'must-not-commit' })
        const created = createTestEmail(accountA, 'system-c03-created')

        expectErrorKind(
          await active.syncPort.applyCollectionSync({
            kind: 'email',
            mode: 'delta',
            expectedCursor: { kind: 'matches', cursor: staleCursor },
            nextCursor,
            changed: [emailRecord(updated), emailRecord(created)],
            destroyed: [emailA2.id],
          }),
          'conflict',
        )
        await active.settle()

        expect(recorder.hints()).toEqual([])
        expect(await active.readRepository.readEmail(emailA1.id)).toEqual({
          ok: true,
          value: { kind: 'present', value: emailA1 },
        })
        expect(await active.readRepository.readEmail(emailA2.id)).toEqual({
          ok: true,
          value: { kind: 'present', value: emailA2 },
        })
        expect(await active.readRepository.readEmail(created.id)).toEqual({
          ok: true,
          value: { kind: 'absent' },
        })
        expect(
          await active.readRepository.readCollectionSyncCursor(
            accountA.key,
            'email',
          ),
        ).toEqual({ ok: true, value: { kind: 'present', value: firstCursor } })
      })

      it('LE-C04 converges to latest state after multiple commits before settle', async () => {
        const active = currentRuntime()
        const { accountA, accountB } = createTestFixtures()
        const recorder = createNotificationRecorder()
        await subscribeRecorder(active, recorder, subscriptions)

        await expectWriteOk(active.syncPort.registerAccount(accountA))
        await expectWriteOk(active.syncPort.registerAccount(accountB))
        await active.settle()

        expectHintCoverage(recorder.hints(), [{ kind: 'accounts' }])
        expect(await active.readRepository.listAccounts()).toEqual({
          ok: true,
          value: [accountA, accountB],
        })
      })
    })

    describe('Owner and cache composition', () => {
      it('LE-O01 makes dependent Email reads ownerAbsent after destroy', async () => {
        const active = currentRuntime()
        const fixtures = createTestFixtures()
        await registerAccounts(active.syncPort, [fixtures.accountA])
        const cursor1 = createTestCollectionSyncCursor(
          fixtures.accountA,
          'email',
          'system-o01-1',
        )
        await replaceEmails(
          active.syncPort,
          fixtures.accountA,
          [
            emailRecord(fixtures.emailA1, [
              createTestEmailMailbox(fixtures.emailA1, fixtures.inboxA),
            ]),
          ],
          cursor1.state,
        )
        await expectWriteOk(
          active.syncPort.cacheEmailBody(fixtures.standardBodyA1),
        )
        await expectWriteOk(
          active.syncPort.replaceAttachmentRefs(
            fixtures.emailA1.id,
            fixtures.attachmentsA1,
          ),
        )

        await expectWriteOk(
          active.syncPort.applyCollectionSync({
            kind: 'email',
            mode: 'delta',
            expectedCursor: { kind: 'matches', cursor: cursor1 },
            nextCursor: createTestCollectionSyncCursor(
              fixtures.accountA,
              'email',
              'system-o01-2',
            ),
            changed: [],
            destroyed: [fixtures.emailA1.id],
          }),
        )

        expect(
          await active.readRepository.readEmail(fixtures.emailA1.id),
        ).toEqual({ ok: true, value: { kind: 'absent' } })
        expect(
          await active.readRepository.readEmailMemberships(fixtures.emailA1.id),
        ).toEqual({ ok: true, value: { kind: 'ownerAbsent' } })
        expect(
          await active.readRepository.readEmailBody(fixtures.emailA1.id),
        ).toEqual({ ok: true, value: { kind: 'ownerAbsent' } })
        expect(
          await active.readRepository.readAttachmentRefs(fixtures.emailA1.id),
        ).toEqual({ ok: true, value: { kind: 'ownerAbsent' } })
      })

      it('LE-O02 makes a View ownerAbsent after Mailbox destroy', async () => {
        const active = currentRuntime()
        const { accountA, inboxA, emptyInboxViewA } = createTestFixtures()
        await registerAccounts(active.syncPort, [accountA])
        const cursor1 = createTestCollectionSyncCursor(
          accountA,
          'mailbox',
          'system-o02-1',
        )
        await replaceMailboxes(
          active.syncPort,
          accountA,
          [inboxA],
          cursor1.state,
        )
        await expectWriteOk(active.syncPort.replaceMailboxView(emptyInboxViewA))

        await expectWriteOk(
          active.syncPort.applyCollectionSync({
            kind: 'mailbox',
            mode: 'delta',
            expectedCursor: { kind: 'matches', cursor: cursor1 },
            nextCursor: createTestCollectionSyncCursor(
              accountA,
              'mailbox',
              'system-o02-2',
            ),
            changed: [],
            destroyed: [inboxA.id],
          }),
        )

        expect(await active.readRepository.readMailbox(inboxA.id)).toEqual({
          ok: true,
          value: { kind: 'absent' },
        })
        expect(
          await active.readRepository.readMailboxView(emptyInboxViewA.spec),
        ).toEqual({ ok: true, value: { kind: 'ownerAbsent' } })
      })

      it('LE-O03 preserves lazy caches for a surviving Email delta', async () => {
        const active = currentRuntime()
        const fixtures = createTestFixtures()
        await registerAccounts(active.syncPort, [fixtures.accountA])
        const cursor1 = createTestCollectionSyncCursor(
          fixtures.accountA,
          'email',
          'system-o03-1',
        )
        await replaceEmails(
          active.syncPort,
          fixtures.accountA,
          [emailRecord(fixtures.emailA1)],
          cursor1.state,
        )
        await expectWriteOk(
          active.syncPort.cacheEmailBody(fixtures.standardBodyA1),
        )
        await expectWriteOk(
          active.syncPort.replaceAttachmentRefs(
            fixtures.emailA1.id,
            fixtures.attachmentsA1,
          ),
        )
        const updated = email({ ...fixtures.emailA1, subject: 'delta-updated' })

        await expectWriteOk(
          active.syncPort.applyCollectionSync({
            kind: 'email',
            mode: 'delta',
            expectedCursor: { kind: 'matches', cursor: cursor1 },
            nextCursor: createTestCollectionSyncCursor(
              fixtures.accountA,
              'email',
              'system-o03-2',
            ),
            changed: [emailRecord(updated)],
            destroyed: [],
          }),
        )

        expect(await active.readRepository.readEmail(updated.id)).toEqual({
          ok: true,
          value: { kind: 'present', value: updated },
        })
        expect(await active.readRepository.readEmailBody(updated.id)).toEqual({
          ok: true,
          value: { kind: 'cached', value: fixtures.standardBodyA1 },
        })
        expect(
          await active.readRepository.readAttachmentRefs(updated.id),
        ).toEqual({
          ok: true,
          value: { kind: 'cached', value: fixtures.attachmentsA1 },
        })
      })

      it('LE-O04 preserves lazy caches for a surviving Email replace', async () => {
        const active = currentRuntime()
        const fixtures = createTestFixtures()
        await registerAccounts(active.syncPort, [fixtures.accountA])
        const cursor1 = createTestCollectionSyncCursor(
          fixtures.accountA,
          'email',
          'system-o04-1',
        )
        await replaceEmails(
          active.syncPort,
          fixtures.accountA,
          [emailRecord(fixtures.emailA1)],
          cursor1.state,
        )
        await expectWriteOk(
          active.syncPort.cacheEmailBody(fixtures.standardBodyA1),
        )
        await expectWriteOk(
          active.syncPort.replaceAttachmentRefs(
            fixtures.emailA1.id,
            fixtures.attachmentsA1,
          ),
        )
        const updated = email({
          ...fixtures.emailA1,
          subject: 'replace-updated',
        })
        const cursor2 = createTestCollectionSyncCursor(
          fixtures.accountA,
          'email',
          'system-o04-2',
        )

        await replaceEmails(
          active.syncPort,
          fixtures.accountA,
          [emailRecord(updated)],
          cursor2.state,
          { kind: 'matches', cursor: cursor1 },
        )

        expect(await active.readRepository.readEmailBody(updated.id)).toEqual({
          ok: true,
          value: { kind: 'cached', value: fixtures.standardBodyA1 },
        })
        expect(
          await active.readRepository.readAttachmentRefs(updated.id),
        ).toEqual({
          ok: true,
          value: { kind: 'cached', value: fixtures.attachmentsA1 },
        })
      })

      it('LE-O05 keeps MailboxView unchanged during Email sync', async () => {
        const active = currentRuntime()
        const fixtures = createTestFixtures()
        await registerAccounts(active.syncPort, [fixtures.accountA])
        await replaceMailboxes(
          active.syncPort,
          fixtures.accountA,
          [fixtures.inboxA],
          'system-o05-mailbox',
        )
        await expectWriteOk(
          active.syncPort.replaceMailboxView(fixtures.emptyInboxViewA),
        )

        await replaceEmails(
          active.syncPort,
          fixtures.accountA,
          [emailRecord(fixtures.emailA1)],
          'system-o05-email',
        )

        expect(
          await active.readRepository.readMailboxView(
            fixtures.emptyInboxViewA.spec,
          ),
        ).toEqual({
          ok: true,
          value: { kind: 'cached', value: fixtures.emptyInboxViewA },
        })
      })
    })

    describe('Lazy cache flow', () => {
      it('LE-L01 moves body from notCached to cached through hint and reread', async () => {
        const active = currentRuntime()
        const fixtures = createTestFixtures()
        await registerAccounts(active.syncPort, [fixtures.accountA])
        await replaceEmails(
          active.syncPort,
          fixtures.accountA,
          [emailRecord(fixtures.emailA1)],
          'system-l01',
        )
        expect(
          await active.readRepository.readEmailBody(fixtures.emailA1.id),
        ).toEqual({ ok: true, value: { kind: 'notCached' } })
        const recorder = createNotificationRecorder()
        await subscribeRecorder(active, recorder, subscriptions)

        await expectWriteOk(
          active.syncPort.cacheEmailBody(fixtures.standardBodyA1),
        )
        await expectCoverage(active, recorder, [
          { kind: 'emailBody', emailId: fixtures.emailA1.id },
        ])
        expect(
          await active.readRepository.readEmailBody(fixtures.emailA1.id),
        ).toEqual({
          ok: true,
          value: { kind: 'cached', value: fixtures.standardBodyA1 },
        })
      })

      it('LE-L02 moves attachments from notCached to cached empty', async () => {
        const active = currentRuntime()
        const fixtures = createTestFixtures()
        await registerAccounts(active.syncPort, [fixtures.accountA])
        await replaceEmails(
          active.syncPort,
          fixtures.accountA,
          [emailRecord(fixtures.emailA1)],
          'system-l02',
        )
        expect(
          await active.readRepository.readAttachmentRefs(fixtures.emailA1.id),
        ).toEqual({ ok: true, value: { kind: 'notCached' } })
        const recorder = createNotificationRecorder()
        await subscribeRecorder(active, recorder, subscriptions)

        await expectWriteOk(
          active.syncPort.replaceAttachmentRefs(fixtures.emailA1.id, []),
        )
        await expectCoverage(active, recorder, [
          { kind: 'attachmentRefs', emailId: fixtures.emailA1.id },
        ])
        expect(
          await active.readRepository.readAttachmentRefs(fixtures.emailA1.id),
        ).toEqual({ ok: true, value: { kind: 'cached', value: [] } })
      })
    })

    describe('Optimistic and Outbox flow', () => {
      async function setupMutationTarget(
        active: LocalEngineContractRuntime,
        fixtures: TestFixtureSet,
      ): Promise<void> {
        await registerAccounts(active.syncPort, [fixtures.accountA])
        await replaceMailboxes(
          active.syncPort,
          fixtures.accountA,
          [fixtures.inboxA, fixtures.archiveA],
          'system-m-mailbox',
        )
        await replaceEmails(
          active.syncPort,
          fixtures.accountA,
          [
            emailRecord(fixtures.emailA1, [
              createTestEmailMailbox(fixtures.emailA1, fixtures.inboxA),
            ]),
          ],
          'system-m-email',
        )
      }

      it('LE-M01 commits optimistic keywords and mutation before reread', async () => {
        const active = currentRuntime()
        const fixtures = createTestFixtures()
        await setupMutationTarget(active, fixtures)
        const recorder = createNotificationRecorder()
        await subscribeRecorder(active, recorder, subscriptions)

        await expectWriteOk(
          active.syncPort.applyOptimisticKeywordMutation(
            fixtures.keywordMutationA,
          ),
        )
        await expectCoverage(active, recorder, [
          { kind: 'emails', accountKey: fixtures.accountA.key },
          { kind: 'pendingMutations', accountKey: fixtures.accountA.key },
        ])
        const emailRead = unwrapOk(
          await active.readRepository.readEmail(fixtures.emailA1.id),
        )
        expect(emailRead.kind).toBe('present')
        if (emailRead.kind === 'present')
          expect([...emailRead.value.keywords]).toEqual([
            'custom-E1',
            '$flagged',
          ])
        expect(
          await active.readRepository.readPendingMutation(
            fixtures.accountA.key,
            fixtures.keywordMutationA.mutationId,
          ),
        ).toEqual({
          ok: true,
          value: { kind: 'present', value: fixtures.keywordMutationA },
        })
      })

      it('LE-M02 commits optimistic memberships and mutation before reread', async () => {
        const active = currentRuntime()
        const fixtures = createTestFixtures()
        await setupMutationTarget(active, fixtures)
        const recorder = createNotificationRecorder()
        await subscribeRecorder(active, recorder, subscriptions)

        await expectWriteOk(
          active.syncPort.applyOptimisticMailboxMembershipMutation(
            fixtures.membershipMutationA,
          ),
        )
        await expectCoverage(active, recorder, [
          { kind: 'emailMemberships', accountKey: fixtures.accountA.key },
          { kind: 'pendingMutations', accountKey: fixtures.accountA.key },
        ])
        expect(
          await active.readRepository.readEmailMemberships(fixtures.emailA1.id),
        ).toEqual({
          ok: true,
          value: {
            kind: 'present',
            value: [
              createTestEmailMailbox(fixtures.emailA1, fixtures.archiveA),
            ],
          },
        })
        expect(
          await active.readRepository.readPendingMutation(
            fixtures.accountA.key,
            fixtures.membershipMutationA.mutationId,
          ),
        ).toEqual({
          ok: true,
          value: { kind: 'present', value: fixtures.membershipMutationA },
        })
      })

      it('LE-M03 exposes a CAS lifecycle transition after invalidation', async () => {
        const active = currentRuntime()
        const fixtures = createTestFixtures()
        await registerAccounts(active.syncPort, [fixtures.accountA])
        await expectWriteOk(
          active.syncPort.stageSendMutation(fixtures.sendMutationA),
        )
        const next = startMutationAttempt(fixtures.sendMutationA)
        const recorder = createNotificationRecorder()
        await subscribeRecorder(active, recorder, subscriptions)

        await expectWriteOk(
          active.syncPort.replacePendingMutationIfCurrent(
            fixtures.sendMutationA,
            next,
          ),
        )
        await expectCoverage(active, recorder, [
          { kind: 'pendingMutations', accountKey: fixtures.accountA.key },
        ])
        expect(
          await active.readRepository.readPendingMutation(
            fixtures.accountA.key,
            fixtures.sendMutationA.mutationId,
          ),
        ).toEqual({ ok: true, value: { kind: 'present', value: next } })
      })

      it('LE-M04 exposes confirmed cleanup after invalidation', async () => {
        const active = currentRuntime()
        const fixtures = createTestFixtures()
        await registerAccounts(active.syncPort, [fixtures.accountA])
        await expectWriteOk(
          active.syncPort.stageSendMutation(fixtures.sendMutationA),
        )
        const inFlight = startMutationAttempt(fixtures.sendMutationA)
        await expectWriteOk(
          active.syncPort.replacePendingMutationIfCurrent(
            fixtures.sendMutationA,
            inFlight,
          ),
        )
        const confirmed = confirmSendMutation(
          inFlight,
          sendConfirmation(fixtures.emailA1.id),
        )
        await expectWriteOk(
          active.syncPort.replacePendingMutationIfCurrent(inFlight, confirmed),
        )
        const recorder = createNotificationRecorder()
        await subscribeRecorder(active, recorder, subscriptions)

        await expectWriteOk(
          active.syncPort.removeConfirmedMutation(
            fixtures.accountA.key,
            fixtures.sendMutationA.mutationId,
          ),
        )
        await expectCoverage(active, recorder, [
          { kind: 'pendingMutations', accountKey: fixtures.accountA.key },
        ])
        expect(
          await active.readRepository.readPendingMutation(
            fixtures.accountA.key,
            fixtures.sendMutationA.mutationId,
          ),
        ).toEqual({ ok: true, value: { kind: 'absent' } })
      })
    })

    describe('Isolation', () => {
      it('LE-A01 isolates equal remote Email tokens across Accounts', async () => {
        const active = currentRuntime()
        const { accountA, accountB, emailA1, emailB1 } = createTestFixtures()
        await registerAccounts(active.syncPort, [accountA, accountB])
        await replaceEmails(
          active.syncPort,
          accountA,
          [emailRecord(emailA1)],
          'system-a01-A',
        )
        await replaceEmails(
          active.syncPort,
          accountB,
          [emailRecord(emailB1)],
          'system-a01-B',
        )

        expect(emailA1.id.jmapId).toBe(emailB1.id.jmapId)
        expect(await active.readRepository.readEmail(emailA1.id)).toEqual({
          ok: true,
          value: { kind: 'present', value: emailA1 },
        })
        expect(await active.readRepository.readEmail(emailB1.id)).toEqual({
          ok: true,
          value: { kind: 'present', value: emailB1 },
        })
      })

      it('LE-A02 isolates cursors by Account and data type', async () => {
        const active = currentRuntime()
        const { accountA, accountB, emailA1, emailB1, inboxA } =
          createTestFixtures()
        await registerAccounts(active.syncPort, [accountA, accountB])
        const emailA = createTestCollectionSyncCursor(
          accountA,
          'email',
          'system-a02-email-A',
        )
        const mailboxA = createTestCollectionSyncCursor(
          accountA,
          'mailbox',
          'system-a02-mailbox-A',
        )
        const emailB = createTestCollectionSyncCursor(
          accountB,
          'email',
          'system-a02-email-B',
        )
        await replaceEmails(
          active.syncPort,
          accountA,
          [emailRecord(emailA1)],
          emailA.state,
        )
        await replaceMailboxes(
          active.syncPort,
          accountA,
          [inboxA],
          mailboxA.state,
        )
        await replaceEmails(
          active.syncPort,
          accountB,
          [emailRecord(emailB1)],
          emailB.state,
        )

        expect(
          await active.readRepository.readCollectionSyncCursor(
            accountA.key,
            'email',
          ),
        ).toEqual({ ok: true, value: { kind: 'present', value: emailA } })
        expect(
          await active.readRepository.readCollectionSyncCursor(
            accountA.key,
            'mailbox',
          ),
        ).toEqual({ ok: true, value: { kind: 'present', value: mailboxA } })
        expect(
          await active.readRepository.readCollectionSyncCursor(
            accountB.key,
            'email',
          ),
        ).toEqual({ ok: true, value: { kind: 'present', value: emailB } })
      })
    })
  })
}
