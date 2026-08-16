import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { Account } from '../../domain/account'
import type { Email } from '../../domain/email'
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
  EmailSyncRecord,
  SyncPort,
  WriteResult,
} from '../../ports/sync-port'
import { expectErrorKind, expectHintCoverage, unwrapOk } from './assertions'
import {
  createTestCollectionSyncCursor,
  createTestEmailMailbox,
  createTestFixtures,
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
  state = 'local-change-email-setup',
): Promise<void> {
  await expectWriteOk(
    syncPort.applyCollectionSync({
      kind: 'email',
      mode: 'replace',
      expectedCursor: { kind: 'absent' },
      nextCursor: createTestCollectionSyncCursor(owner, 'email', state),
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
        'local-change-mailbox-setup',
      ),
      snapshot,
    }),
  )
}

function expectAllowedHintShape(hint: LocalChangeHint): void {
  const keys = Object.keys(hint).sort()

  switch (hint.kind) {
    case 'accounts':
      expect(keys).toEqual(['kind'])
      return
    case 'mailboxes':
    case 'identities':
    case 'emails':
    case 'emailMemberships':
    case 'pendingMutations':
      expect(keys).toEqual(['accountKey', 'kind'])
      return
    case 'emailBody':
    case 'attachmentRefs':
      expect(keys).toEqual(['emailId', 'kind'])
      return
    case 'mailboxView':
      expect(keys).toEqual(['kind', 'spec'])
      return
    case 'syncCursor':
      expect(keys).toEqual(['accountKey', 'dataType', 'kind'])
  }
}

async function expectCoverage(
  runtime: LocalEngineContractRuntime,
  recorder: NotificationRecorder,
  required: readonly LocalChangeHint[],
): Promise<void> {
  await runtime.settle()
  const observed = recorder.hints()

  for (const hint of observed) {
    expectAllowedHintShape(hint)
  }

  expectHintCoverage(observed, required)
}

export function defineLocalChangeSourceContract(
  harness: LocalEngineContractHarness,
): void {
  describe(`LocalChangeSource contract — ${harness.name}`, () => {
    let runtime: LocalEngineContractRuntime | undefined
    let subscriptions: LocalChangeSubscription[] = []

    beforeEach(async () => {
      runtime = await harness.create()
      subscriptions = []
    })

    afterEach(async () => {
      for (const subscription of subscriptions) {
        subscription.unsubscribe()
      }
      subscriptions = []

      const runtimeToDispose = runtime
      runtime = undefined
      if (runtimeToDispose !== undefined) {
        await runtimeToDispose.dispose()
      }
    })

    function currentRuntime(): LocalEngineContractRuntime {
      if (runtime === undefined) {
        throw new Error('LocalChangeSource contract runtime is not available')
      }

      return runtime
    }

    async function subscribeRecorder(
      recorder: NotificationRecorder,
    ): Promise<LocalChangeSubscription> {
      const subscription = unwrapOk(
        await currentRuntime().localChangeSource.subscribe(recorder.listener),
      )
      subscriptions.push(subscription)
      return subscription
    }

    describe('Subscription lifecycle', () => {
      it('LC-S01 is active when subscribe resolves', async () => {
        const { accountA } = createTestFixtures()
        const recorder = createNotificationRecorder()
        const activeRuntime = currentRuntime()
        await subscribeRecorder(recorder)

        await expectWriteOk(activeRuntime.syncPort.registerAccount(accountA))

        await expectCoverage(activeRuntime, recorder, [{ kind: 'accounts' }])
      })

      it('LC-S02 delivers covering invalidation to two independent subscriptions', async () => {
        const { accountA } = createTestFixtures()
        const first = createNotificationRecorder()
        const second = createNotificationRecorder()
        const activeRuntime = currentRuntime()
        await subscribeRecorder(first)
        await subscribeRecorder(second)

        await expectWriteOk(activeRuntime.syncPort.registerAccount(accountA))

        await expectCoverage(activeRuntime, first, [{ kind: 'accounts' }])
        await expectCoverage(activeRuntime, second, [{ kind: 'accounts' }])
      })

      it('LC-S03 makes unsubscribe idempotent and non-throwing', async () => {
        const recorder = createNotificationRecorder()
        const subscription = await subscribeRecorder(recorder)

        expect(() => subscription.unsubscribe()).not.toThrow()
        expect(() => subscription.unsubscribe()).not.toThrow()
      })

      it('LC-S04 starts no new listener invocation after unsubscribe returns', async () => {
        const { accountA, accountB } = createTestFixtures()
        const recorder = createNotificationRecorder()
        const activeRuntime = currentRuntime()
        const subscription = await subscribeRecorder(recorder)
        await expectWriteOk(activeRuntime.syncPort.registerAccount(accountA))
        await activeRuntime.settle()
        recorder.clear()
        subscription.unsubscribe()

        await expectWriteOk(activeRuntime.syncPort.registerAccount(accountB))
        await activeRuntime.settle()

        expect(recorder.hints()).toEqual([])
      })

      it('LC-S05 keeps another subscription active when one unsubscribes', async () => {
        const { accountA } = createTestFixtures()
        const first = createNotificationRecorder()
        const second = createNotificationRecorder()
        const activeRuntime = currentRuntime()
        const firstSubscription = await subscribeRecorder(first)
        await subscribeRecorder(second)
        firstSubscription.unsubscribe()

        await expectWriteOk(activeRuntime.syncPort.registerAccount(accountA))
        await activeRuntime.settle()

        expect(first.hints()).toEqual([])
        await expectCoverage(activeRuntime, second, [{ kind: 'accounts' }])
      })

      it('LC-S06 isolates a throwing listener from another subscription', async () => {
        const { accountA } = createTestFixtures()
        const recorder = createNotificationRecorder()
        const activeRuntime = currentRuntime()
        const throwingSubscription = unwrapOk(
          await activeRuntime.localChangeSource.subscribe(() => {
            throw new Error('listener failure')
          }),
        )
        subscriptions.push(throwingSubscription)
        await subscribeRecorder(recorder)

        await expectWriteOk(activeRuntime.syncPort.registerAccount(accountA))

        await expectCoverage(activeRuntime, recorder, [{ kind: 'accounts' }])
      })

      it('LC-S07 does not turn a committed write into failure when a listener throws', async () => {
        const { accountA } = createTestFixtures()
        const activeRuntime = currentRuntime()
        const subscription = unwrapOk(
          await activeRuntime.localChangeSource.subscribe(() => {
            throw new Error('listener failure')
          }),
        )
        subscriptions.push(subscription)

        await expectWriteOk(activeRuntime.syncPort.registerAccount(accountA))
        await activeRuntime.settle()

        expect(
          unwrapOk(
            await activeRuntime.readRepository.readAccount(accountA.key),
          ),
        ).toEqual({ kind: 'present', value: accountA })
      })

      it('LC-S08 does not replay writes committed before subscription', async () => {
        const { accountA } = createTestFixtures()
        const recorder = createNotificationRecorder()
        const activeRuntime = currentRuntime()
        await expectWriteOk(activeRuntime.syncPort.registerAccount(accountA))
        await activeRuntime.settle()

        await subscribeRecorder(recorder)
        await activeRuntime.settle()

        expect(recorder.hints()).toEqual([])
      })

      it('LC-S09 delivers only non-empty LocalChangeBatch values', async () => {
        const { accountA } = createTestFixtures()
        const recorder = createNotificationRecorder()
        const activeRuntime = currentRuntime()
        await subscribeRecorder(recorder)

        await expectWriteOk(activeRuntime.syncPort.registerAccount(accountA))
        await expectCoverage(activeRuntime, recorder, [{ kind: 'accounts' }])

        expect(recorder.batches().length).toBeGreaterThan(0)
        for (const batch of recorder.batches()) {
          expect(batch.hints.length).toBeGreaterThan(0)
        }
      })
    })

    describe('P-02 to P-03 mapping', () => {
      it('LC-M01 maps Account registration to accounts', async () => {
        const { accountA } = createTestFixtures()
        const recorder = createNotificationRecorder()
        const activeRuntime = currentRuntime()
        await subscribeRecorder(recorder)

        await expectWriteOk(activeRuntime.syncPort.registerAccount(accountA))

        await expectCoverage(activeRuntime, recorder, [{ kind: 'accounts' }])
      })

      it('LC-M02 maps Email sync to Email, membership, and cursor invalidation', async () => {
        const { accountA, emailA1, inboxA } = createTestFixtures()
        const recorder = createNotificationRecorder()
        const activeRuntime = currentRuntime()
        await registerAccounts(activeRuntime.syncPort, [accountA])
        await subscribeRecorder(recorder)

        await replaceEmails(activeRuntime.syncPort, accountA, [
          emailRecord(emailA1, [createTestEmailMailbox(emailA1, inboxA)]),
        ])

        await expectCoverage(activeRuntime, recorder, [
          { kind: 'emails', accountKey: accountA.key },
          { kind: 'emailMemberships', accountKey: accountA.key },
          { kind: 'syncCursor', accountKey: accountA.key, dataType: 'email' },
        ])
      })

      it('LC-M03 maps Mailbox sync to Mailbox and cursor invalidation', async () => {
        const { accountA, inboxA } = createTestFixtures()
        const recorder = createNotificationRecorder()
        const activeRuntime = currentRuntime()
        await registerAccounts(activeRuntime.syncPort, [accountA])
        await subscribeRecorder(recorder)

        await replaceMailboxes(activeRuntime.syncPort, accountA, [inboxA])

        await expectCoverage(activeRuntime, recorder, [
          { kind: 'mailboxes', accountKey: accountA.key },
          { kind: 'syncCursor', accountKey: accountA.key, dataType: 'mailbox' },
        ])
      })

      it('LC-M04 maps Identity sync to Identity and cursor invalidation', async () => {
        const { accountA, identityA } = createTestFixtures()
        const recorder = createNotificationRecorder()
        const activeRuntime = currentRuntime()
        await registerAccounts(activeRuntime.syncPort, [accountA])
        await subscribeRecorder(recorder)

        await expectWriteOk(
          activeRuntime.syncPort.applyCollectionSync({
            kind: 'identity',
            mode: 'replace',
            expectedCursor: { kind: 'absent' },
            nextCursor: createTestCollectionSyncCursor(
              accountA,
              'identity',
              'local-change-identity',
            ),
            snapshot: [identityA],
          }),
        )

        await expectCoverage(activeRuntime, recorder, [
          { kind: 'identities', accountKey: accountA.key },
          {
            kind: 'syncCursor',
            accountKey: accountA.key,
            dataType: 'identity',
          },
        ])
      })

      it('LC-M05 maps EmailBody caching to emailBody', async () => {
        const { accountA, emailA1, standardBodyA1 } = createTestFixtures()
        const recorder = createNotificationRecorder()
        const activeRuntime = currentRuntime()
        await registerAccounts(activeRuntime.syncPort, [accountA])
        await replaceEmails(activeRuntime.syncPort, accountA, [
          emailRecord(emailA1),
        ])
        await subscribeRecorder(recorder)

        await expectWriteOk(
          activeRuntime.syncPort.cacheEmailBody(standardBodyA1),
        )

        await expectCoverage(activeRuntime, recorder, [
          { kind: 'emailBody', emailId: emailA1.id },
        ])
      })

      it('LC-M06 maps AttachmentRef caching to attachmentRefs', async () => {
        const { accountA, emailA1, attachmentsA1 } = createTestFixtures()
        const recorder = createNotificationRecorder()
        const activeRuntime = currentRuntime()
        await registerAccounts(activeRuntime.syncPort, [accountA])
        await replaceEmails(activeRuntime.syncPort, accountA, [
          emailRecord(emailA1),
        ])
        await subscribeRecorder(recorder)

        await expectWriteOk(
          activeRuntime.syncPort.replaceAttachmentRefs(
            emailA1.id,
            attachmentsA1,
          ),
        )

        await expectCoverage(activeRuntime, recorder, [
          { kind: 'attachmentRefs', emailId: emailA1.id },
        ])
      })

      it('LC-M07 maps MailboxView caching to its exact semantic spec', async () => {
        const { accountA, inboxA, emptyInboxViewA } = createTestFixtures()
        const recorder = createNotificationRecorder()
        const activeRuntime = currentRuntime()
        await registerAccounts(activeRuntime.syncPort, [accountA])
        await replaceMailboxes(activeRuntime.syncPort, accountA, [inboxA])
        await subscribeRecorder(recorder)

        await expectWriteOk(
          activeRuntime.syncPort.replaceMailboxView(emptyInboxViewA),
        )

        await expectCoverage(activeRuntime, recorder, [
          { kind: 'mailboxView', spec: emptyInboxViewA.spec },
        ])
      })

      it('LC-M08 maps Send staging to pendingMutations', async () => {
        const { accountA, sendMutationA } = createTestFixtures()
        const recorder = createNotificationRecorder()
        const activeRuntime = currentRuntime()
        await registerAccounts(activeRuntime.syncPort, [accountA])
        await subscribeRecorder(recorder)

        await expectWriteOk(
          activeRuntime.syncPort.stageSendMutation(sendMutationA),
        )

        await expectCoverage(activeRuntime, recorder, [
          { kind: 'pendingMutations', accountKey: accountA.key },
        ])
      })

      it('LC-M09 maps optimistic Keyword writes to Email and mutation invalidation', async () => {
        const { accountA, emailA1, keywordMutationA } = createTestFixtures()
        const recorder = createNotificationRecorder()
        const activeRuntime = currentRuntime()
        await registerAccounts(activeRuntime.syncPort, [accountA])
        await replaceEmails(activeRuntime.syncPort, accountA, [
          emailRecord(emailA1),
        ])
        await subscribeRecorder(recorder)

        await expectWriteOk(
          activeRuntime.syncPort.applyOptimisticKeywordMutation(
            keywordMutationA,
          ),
        )

        await expectCoverage(activeRuntime, recorder, [
          { kind: 'emails', accountKey: accountA.key },
          { kind: 'pendingMutations', accountKey: accountA.key },
        ])
      })

      it('LC-M10 maps optimistic membership writes to relationship and mutation invalidation', async () => {
        const { accountA, emailA1, inboxA, archiveA, membershipMutationA } =
          createTestFixtures()
        const recorder = createNotificationRecorder()
        const activeRuntime = currentRuntime()
        await registerAccounts(activeRuntime.syncPort, [accountA])
        await replaceMailboxes(activeRuntime.syncPort, accountA, [
          inboxA,
          archiveA,
        ])
        await replaceEmails(activeRuntime.syncPort, accountA, [
          emailRecord(emailA1, [createTestEmailMailbox(emailA1, inboxA)]),
        ])
        await subscribeRecorder(recorder)

        await expectWriteOk(
          activeRuntime.syncPort.applyOptimisticMailboxMembershipMutation(
            membershipMutationA,
          ),
        )

        await expectCoverage(activeRuntime, recorder, [
          { kind: 'emailMemberships', accountKey: accountA.key },
          { kind: 'pendingMutations', accountKey: accountA.key },
        ])
      })

      it('LC-M11 maps mutation CAS to pendingMutations', async () => {
        const { accountA, sendMutationA } = createTestFixtures()
        const recorder = createNotificationRecorder()
        const activeRuntime = currentRuntime()
        await registerAccounts(activeRuntime.syncPort, [accountA])
        await expectWriteOk(
          activeRuntime.syncPort.stageSendMutation(sendMutationA),
        )
        await subscribeRecorder(recorder)
        const inFlight = startMutationAttempt(sendMutationA)

        await expectWriteOk(
          activeRuntime.syncPort.replacePendingMutationIfCurrent(
            sendMutationA,
            inFlight,
          ),
        )

        await expectCoverage(activeRuntime, recorder, [
          { kind: 'pendingMutations', accountKey: accountA.key },
        ])
      })

      it('LC-M12 maps confirmed mutation removal to pendingMutations', async () => {
        const { accountA, emailA1, sendMutationA } = createTestFixtures()
        const recorder = createNotificationRecorder()
        const activeRuntime = currentRuntime()
        await registerAccounts(activeRuntime.syncPort, [accountA])
        await expectWriteOk(
          activeRuntime.syncPort.stageSendMutation(sendMutationA),
        )
        const inFlight = startMutationAttempt(sendMutationA)
        await expectWriteOk(
          activeRuntime.syncPort.replacePendingMutationIfCurrent(
            sendMutationA,
            inFlight,
          ),
        )
        const confirmed = confirmSendMutation(
          inFlight,
          sendConfirmation(emailA1.id),
        )
        await expectWriteOk(
          activeRuntime.syncPort.replacePendingMutationIfCurrent(
            inFlight,
            confirmed,
          ),
        )
        await subscribeRecorder(recorder)

        await expectWriteOk(
          activeRuntime.syncPort.removeConfirmedMutation(
            confirmed.accountKey,
            confirmed.mutationId,
          ),
        )

        await expectCoverage(activeRuntime, recorder, [
          { kind: 'pendingMutations', accountKey: accountA.key },
        ])
      })
    })

    describe('Failure and no-op delivery', () => {
      it('LC-F01 emits no false invalidation for a conflicted write', async () => {
        const { accountA, emailA1, emailA2 } = createTestFixtures()
        const recorder = createNotificationRecorder()
        const activeRuntime = currentRuntime()
        await registerAccounts(activeRuntime.syncPort, [accountA])
        await replaceEmails(
          activeRuntime.syncPort,
          accountA,
          [emailRecord(emailA1)],
          'current-state',
        )
        await subscribeRecorder(recorder)
        await activeRuntime.settle()
        recorder.clear()

        await expectWriteConflict(
          activeRuntime.syncPort.applyCollectionSync({
            kind: 'email',
            mode: 'replace',
            expectedCursor: { kind: 'absent' },
            nextCursor: createTestCollectionSyncCursor(
              accountA,
              'email',
              'rejected-state',
            ),
            snapshot: [emailRecord(emailA2)],
          }),
        )
        await activeRuntime.settle()

        expect(recorder.hints()).toEqual([])
      })

      it('LC-F02 permits no notification or relevant conservative notification for a pure no-op', async () => {
        const { accountA } = createTestFixtures()
        const recorder = createNotificationRecorder()
        const activeRuntime = currentRuntime()
        await subscribeRecorder(recorder)
        await expectWriteOk(activeRuntime.syncPort.registerAccount(accountA))
        await activeRuntime.settle()
        recorder.clear()

        await expectWriteOk(activeRuntime.syncPort.registerAccount(accountA))
        await activeRuntime.settle()

        for (const hint of recorder.hints()) {
          expectAllowedHintShape(hint)
          expect(hint.kind).toBe('accounts')
        }
      })
    })
  })
}
