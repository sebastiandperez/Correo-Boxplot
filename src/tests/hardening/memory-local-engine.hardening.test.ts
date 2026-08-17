import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { email } from '../../domain/email'
import {
  failMutationTerminal,
  scheduleMutationRetry,
  startMutationAttempt,
} from '../../domain/pending-mutation'
import type { LocalChangeSubscription } from '../../ports/local-change-source'
import type {
  CollectionCursorPrecondition,
  EmailSyncRecord,
  WriteResult,
} from '../../ports/sync-port'
import {
  expectErrorKind,
  expectHintCoverage,
  unwrapOk,
} from '../contracts/assertions'
import {
  createTestAttachmentRef,
  createTestCollectionSyncCursor,
  createTestEmail,
  createTestEmailBody,
  createTestEmailMailbox,
  createTestFixtures,
  createTestIdentity,
  createTestKeywordMutation,
  createTestMailbox,
  createTestMailboxMembershipMutation,
  createTestMailboxView,
  createTestMailboxViewSpec,
  createTestMutationInstant,
  createTestSendMutation,
} from '../contracts/fixtures'
import type { LocalEngineContractRuntime } from '../contracts/harness'
import { createNotificationRecorder } from '../contracts/notification-recorder'
import { memoryLocalEngineHarness } from '../support/memory/memory-local-engine.harness'

async function expectWriteOk(operation: Promise<WriteResult>): Promise<void> {
  unwrapOk(await operation)
}

function emailRecord(value: EmailSyncRecord['email']): EmailSyncRecord {
  return { email: value, memberships: [] }
}

async function register(
  runtime: LocalEngineContractRuntime,
  ...accounts: Parameters<
    LocalEngineContractRuntime['syncPort']['registerAccount']
  >[0][]
): Promise<void> {
  for (const account of accounts) {
    await expectWriteOk(runtime.syncPort.registerAccount(account))
  }
}

async function replaceEmails(
  runtime: LocalEngineContractRuntime,
  owner: ReturnType<typeof createTestFixtures>['accountA'],
  records: readonly EmailSyncRecord[],
  state: string,
  expectedCursor: CollectionCursorPrecondition = { kind: 'absent' },
): Promise<void> {
  await expectWriteOk(
    runtime.syncPort.applyCollectionSync({
      kind: 'email',
      mode: 'replace',
      expectedCursor,
      nextCursor: createTestCollectionSyncCursor(owner, 'email', state),
      snapshot: records,
    }),
  )
}

describe('Memory Local Engine hardening', () => {
  let runtime: LocalEngineContractRuntime | undefined

  beforeEach(async () => {
    runtime = await memoryLocalEngineHarness.create()
  })

  afterEach(async () => {
    const current = runtime
    runtime = undefined
    if (current !== undefined) await current.dispose()
  })

  function currentRuntime(): LocalEngineContractRuntime {
    if (runtime === undefined)
      throw new Error('Memory hardening runtime unavailable')
    return runtime
  }

  describe('Engine and Account isolation', () => {
    it('MH-I01 keeps two Memory engines completely isolated', async () => {
      const first = currentRuntime()
      const second = await memoryLocalEngineHarness.create()
      const { accountA, accountB } = createTestFixtures()
      try {
        await register(first, accountA)
        await register(second, accountB)

        expect(await first.readRepository.listAccounts()).toEqual({
          ok: true,
          value: [accountA],
        })
        expect(await second.readRepository.listAccounts()).toEqual({
          ok: true,
          value: [accountB],
        })
        expect(await first.readRepository.readAccount(accountB.key)).toEqual({
          ok: true,
          value: { kind: 'absent' },
        })
        expect(await second.readRepository.readAccount(accountA.key)).toEqual({
          ok: true,
          value: { kind: 'absent' },
        })
      } finally {
        await second.dispose()
      }
    })

    it('MH-I02 starts a fresh harness runtime after prior disposal', async () => {
      const first = currentRuntime()
      const { accountA } = createTestFixtures()
      await register(first, accountA)
      await first.dispose()
      runtime = undefined

      const second = await memoryLocalEngineHarness.create()
      runtime = second
      expect(await second.readRepository.listAccounts()).toEqual({
        ok: true,
        value: [],
      })
    })

    it('MH-I03 preserves equal remote IDs across interleaved Account writes', async () => {
      const active = currentRuntime()
      const { accountA, accountB, emailA1, emailB1 } = createTestFixtures()
      await register(active, accountA, accountB)
      await replaceEmails(
        active,
        accountA,
        [emailRecord(emailA1)],
        'hardening-i03-A1',
      )
      await replaceEmails(
        active,
        accountB,
        [emailRecord(emailB1)],
        'hardening-i03-B1',
      )
      const cursorA = createTestCollectionSyncCursor(
        accountA,
        'email',
        'hardening-i03-A1',
      )
      const cursorB = createTestCollectionSyncCursor(
        accountB,
        'email',
        'hardening-i03-B1',
      )
      const updatedA = email({ ...emailA1, subject: 'updated-A' })
      const updatedB = email({ ...emailB1, subject: 'updated-B' })

      await replaceEmails(
        active,
        accountB,
        [emailRecord(updatedB)],
        'hardening-i03-B2',
        { kind: 'matches', cursor: cursorB },
      )
      await replaceEmails(
        active,
        accountA,
        [emailRecord(updatedA)],
        'hardening-i03-A2',
        { kind: 'matches', cursor: cursorA },
      )

      expect(emailA1.id.jmapId).toBe(emailB1.id.jmapId)
      expect(await active.readRepository.readEmail(emailA1.id)).toEqual({
        ok: true,
        value: { kind: 'present', value: updatedA },
      })
      expect(await active.readRepository.readEmail(emailB1.id)).toEqual({
        ok: true,
        value: { kind: 'present', value: updatedB },
      })
    })

    it('MH-I04 isolates equal MutationId tokens across Accounts and lifecycles', async () => {
      const active = currentRuntime()
      const { accountA, accountB, identityA } = createTestFixtures()
      const identityB = createTestIdentity(accountB, 'B')
      const mutationA = createTestSendMutation(
        accountA,
        identityA,
        'shared-token',
      )
      const mutationB = createTestSendMutation(
        accountB,
        identityB,
        'shared-token',
      )
      await register(active, accountA, accountB)
      await expectWriteOk(active.syncPort.stageSendMutation(mutationA))
      await expectWriteOk(active.syncPort.stageSendMutation(mutationB))
      const inFlightA = startMutationAttempt(mutationA)
      await expectWriteOk(
        active.syncPort.replacePendingMutationIfCurrent(mutationA, inFlightA),
      )

      expect(mutationA.mutationId).toBe(mutationB.mutationId)
      expect(
        await active.readRepository.readPendingMutation(
          accountA.key,
          mutationA.mutationId,
        ),
      ).toEqual({ ok: true, value: { kind: 'present', value: inFlightA } })
      expect(
        await active.readRepository.readPendingMutation(
          accountB.key,
          mutationB.mutationId,
        ),
      ).toEqual({ ok: true, value: { kind: 'present', value: mutationB } })
    })
  })

  describe('View keying', () => {
    it('MH-V01 keeps different sort specs for one Mailbox distinct', async () => {
      const active = currentRuntime()
      const { accountA, inboxA } = createTestFixtures()
      await register(active, accountA)
      await expectWriteOk(
        active.syncPort.applyCollectionSync({
          kind: 'mailbox',
          mode: 'replace',
          expectedCursor: { kind: 'absent' },
          nextCursor: createTestCollectionSyncCursor(
            accountA,
            'mailbox',
            'hardening-v01',
          ),
          snapshot: [inboxA],
        }),
      )
      const descendingSpec = createTestMailboxViewSpec(inboxA, 'descending')
      const ascendingSpec = createTestMailboxViewSpec(inboxA, 'ascending')
      const descending = createTestMailboxView({
        spec: descendingSpec,
        queryState: 'descending-1',
        total: 0,
        coverage: [],
        items: [],
      })
      const ascending = createTestMailboxView({
        spec: ascendingSpec,
        queryState: 'ascending',
        total: 0,
        coverage: [],
        items: [],
      })
      await expectWriteOk(active.syncPort.replaceMailboxView(descending))
      await expectWriteOk(active.syncPort.replaceMailboxView(ascending))
      let latest = descending
      for (let index = 2; index <= 5; index += 1) {
        latest = createTestMailboxView({
          spec: descendingSpec,
          queryState: `descending-${index}`,
          total: 0,
          coverage: [],
          items: [],
        })
        await expectWriteOk(active.syncPort.replaceMailboxView(latest))
      }

      expect(
        await active.readRepository.readMailboxView(descendingSpec),
      ).toEqual({ ok: true, value: { kind: 'cached', value: latest } })
      expect(
        await active.readRepository.readMailboxView(ascendingSpec),
      ).toEqual({ ok: true, value: { kind: 'cached', value: ascending } })
    })

    it('MH-V02 keeps different Mailbox View caches independent', async () => {
      const active = currentRuntime()
      const { accountA, inboxA, archiveA } = createTestFixtures()
      await register(active, accountA)
      await expectWriteOk(
        active.syncPort.applyCollectionSync({
          kind: 'mailbox',
          mode: 'replace',
          expectedCursor: { kind: 'absent' },
          nextCursor: createTestCollectionSyncCursor(
            accountA,
            'mailbox',
            'hardening-v02',
          ),
          snapshot: [inboxA, archiveA],
        }),
      )
      const inboxSpec = createTestMailboxViewSpec(inboxA)
      const archiveSpec = createTestMailboxViewSpec(archiveA)
      const archiveView = createTestMailboxView({
        spec: archiveSpec,
        queryState: 'archive-fixed',
        total: 0,
        coverage: [],
        items: [],
      })
      await expectWriteOk(active.syncPort.replaceMailboxView(archiveView))
      let latestInbox = createTestMailboxView({
        spec: inboxSpec,
        queryState: 'inbox-0',
        total: 0,
        coverage: [],
        items: [],
      })
      for (let index = 0; index < 5; index += 1) {
        latestInbox = createTestMailboxView({
          spec: inboxSpec,
          queryState: `inbox-${index}`,
          total: 0,
          coverage: [],
          items: [],
        })
        await expectWriteOk(active.syncPort.replaceMailboxView(latestInbox))
      }

      expect(await active.readRepository.readMailboxView(inboxSpec)).toEqual({
        ok: true,
        value: { kind: 'cached', value: latestInbox },
      })
      expect(await active.readRepository.readMailboxView(archiveSpec)).toEqual({
        ok: true,
        value: { kind: 'cached', value: archiveView },
      })
    })
  })

  describe('Cursor hardening', () => {
    it('MH-C01 preserves data-type cursors across alternating commits', async () => {
      const active = currentRuntime()
      const { accountA, emailA1, inboxA, identityA } = createTestFixtures()
      await register(active, accountA)
      const emailCursor = createTestCollectionSyncCursor(
        accountA,
        'email',
        'hardening-c01-email',
      )
      const mailboxCursor = createTestCollectionSyncCursor(
        accountA,
        'mailbox',
        'hardening-c01-mailbox',
      )
      const identityCursor = createTestCollectionSyncCursor(
        accountA,
        'identity',
        'hardening-c01-identity',
      )
      await replaceEmails(
        active,
        accountA,
        [emailRecord(emailA1)],
        emailCursor.state,
      )
      await expectWriteOk(
        active.syncPort.applyCollectionSync({
          kind: 'mailbox',
          mode: 'replace',
          expectedCursor: { kind: 'absent' },
          nextCursor: mailboxCursor,
          snapshot: [inboxA],
        }),
      )
      await expectWriteOk(
        active.syncPort.applyCollectionSync({
          kind: 'identity',
          mode: 'replace',
          expectedCursor: { kind: 'absent' },
          nextCursor: identityCursor,
          snapshot: [identityA],
        }),
      )

      expect(
        await active.readRepository.readCollectionSyncCursor(
          accountA.key,
          'email',
        ),
      ).toEqual({ ok: true, value: { kind: 'present', value: emailCursor } })
      expect(
        await active.readRepository.readCollectionSyncCursor(
          accountA.key,
          'mailbox',
        ),
      ).toEqual({ ok: true, value: { kind: 'present', value: mailboxCursor } })
      expect(
        await active.readRepository.readCollectionSyncCursor(
          accountA.key,
          'identity',
        ),
      ).toEqual({ ok: true, value: { kind: 'present', value: identityCursor } })
    })

    it('MH-C02 preserves opaque and empty cursor states through sequences', async () => {
      const active = currentRuntime()
      const { accountA } = createTestFixtures()
      await register(active, accountA)
      let current = createTestCollectionSyncCursor(accountA, 'email', '')
      await replaceEmails(active, accountA, [], current.state)
      for (const state of ['', 'opaque:10/2', 'opaque:10/2', '0']) {
        const next = createTestCollectionSyncCursor(accountA, 'email', state)
        await expectWriteOk(
          active.syncPort.applyCollectionSync({
            kind: 'email',
            mode: 'delta',
            expectedCursor: { kind: 'matches', cursor: current },
            nextCursor: next,
            changed: [],
            destroyed: [],
          }),
        )
        current = next
      }

      expect(
        await active.readRepository.readCollectionSyncCursor(
          accountA.key,
          'email',
        ),
      ).toEqual({ ok: true, value: { kind: 'present', value: current } })
    })
  })

  describe('Deterministic state stress', () => {
    it('MH-S01 survives a long deterministic Email delta sequence', async () => {
      const active = currentRuntime()
      const { accountA, emailA1 } = createTestFixtures()
      await register(active, accountA)
      let currentEmail = emailA1
      let currentCursor = createTestCollectionSyncCursor(
        accountA,
        'email',
        'hardening-s01-0',
      )
      await replaceEmails(
        active,
        accountA,
        [emailRecord(currentEmail)],
        currentCursor.state,
      )
      for (let index = 1; index <= 25; index += 1) {
        currentEmail = email({ ...currentEmail, subject: `subject-${index}` })
        const nextCursor = createTestCollectionSyncCursor(
          accountA,
          'email',
          `hardening-s01-${index}`,
        )
        await expectWriteOk(
          active.syncPort.applyCollectionSync({
            kind: 'email',
            mode: 'delta',
            expectedCursor: { kind: 'matches', cursor: currentCursor },
            nextCursor,
            changed: [emailRecord(currentEmail)],
            destroyed: [],
          }),
        )
        currentCursor = nextCursor
      }

      expect(await active.readRepository.readEmail(currentEmail.id)).toEqual({
        ok: true,
        value: { kind: 'present', value: currentEmail },
      })
      expect(
        await active.readRepository.readCollectionSyncCursor(
          accountA.key,
          'email',
        ),
      ).toEqual({ ok: true, value: { kind: 'present', value: currentCursor } })
    })

    it('MH-S02 accepts repeated destroy-absent deltas while advancing cursor', async () => {
      const active = currentRuntime()
      const { accountA } = createTestFixtures()
      const absentEmail = createTestEmail(accountA, 'hardening-s02-absent')
      await register(active, accountA)
      let current = createTestCollectionSyncCursor(
        accountA,
        'email',
        'hardening-s02-0',
      )
      await replaceEmails(active, accountA, [], current.state)
      for (let index = 1; index <= 10; index += 1) {
        const next = createTestCollectionSyncCursor(
          accountA,
          'email',
          `hardening-s02-${index}`,
        )
        await expectWriteOk(
          active.syncPort.applyCollectionSync({
            kind: 'email',
            mode: 'delta',
            expectedCursor: { kind: 'matches', cursor: current },
            nextCursor: next,
            changed: [],
            destroyed: [absentEmail.id],
          }),
        )
        current = next
      }

      expect(await active.readRepository.readEmail(absentEmail.id)).toEqual({
        ok: true,
        value: { kind: 'absent' },
      })
      expect(
        await active.readRepository.readCollectionSyncCursor(
          accountA.key,
          'email',
        ),
      ).toEqual({ ok: true, value: { kind: 'present', value: current } })
    })

    it('MH-S03 retains many unique Keyword mutations without coalescing', async () => {
      const active = currentRuntime()
      const { accountA, emailA1 } = createTestFixtures()
      await register(active, accountA)
      await replaceEmails(
        active,
        accountA,
        [emailRecord(emailA1)],
        'hardening-s03',
      )
      const mutations = Array.from({ length: 20 }, (_, index) =>
        createTestKeywordMutation(accountA, emailA1, `hardening-s03-${index}`),
      )
      for (const mutation of mutations)
        await expectWriteOk(
          active.syncPort.applyOptimisticKeywordMutation(mutation),
        )

      const emailRead = unwrapOk(
        await active.readRepository.readEmail(emailA1.id),
      )
      expect(emailRead.kind).toBe('present')
      if (emailRead.kind === 'present')
        expect(new Set(emailRead.value.keywords)).toEqual(
          new Set(['custom-E1', '$flagged']),
        )
      const mutationRead = unwrapOk(
        await active.readRepository.listPendingMutations(accountA.key),
      )
      expect(mutationRead.kind).toBe('present')
      if (mutationRead.kind === 'present')
        expect(mutationRead.value).toHaveLength(20)
    })

    it('MH-S04 preserves valid unique memberships through move sequences', async () => {
      const active = currentRuntime()
      const { accountA, emailA1, inboxA, archiveA } = createTestFixtures()
      const third = createTestMailbox(accountA, 'hardening-s04-third')
      await register(active, accountA)
      await expectWriteOk(
        active.syncPort.applyCollectionSync({
          kind: 'mailbox',
          mode: 'replace',
          expectedCursor: { kind: 'absent' },
          nextCursor: createTestCollectionSyncCursor(
            accountA,
            'mailbox',
            'hardening-s04-mailboxes',
          ),
          snapshot: [inboxA, archiveA, third],
        }),
      )
      await expectWriteOk(
        active.syncPort.applyCollectionSync({
          kind: 'email',
          mode: 'replace',
          expectedCursor: { kind: 'absent' },
          nextCursor: createTestCollectionSyncCursor(
            accountA,
            'email',
            'hardening-s04-email',
          ),
          snapshot: [
            {
              email: emailA1,
              memberships: [createTestEmailMailbox(emailA1, inboxA)],
            },
          ],
        }),
      )
      const moves = [
        [archiveA, inboxA],
        [third, archiveA],
        [inboxA, third],
      ] as const
      for (const [add, remove] of moves) {
        const mutation = createTestMailboxMembershipMutation(
          accountA,
          emailA1,
          `hardening-s04-${add.name}`,
          [add],
          [remove],
        )
        await expectWriteOk(
          active.syncPort.applyOptimisticMailboxMembershipMutation(mutation),
        )
        const read = unwrapOk(
          await active.readRepository.readEmailMemberships(emailA1.id),
        )
        expect(read.kind).toBe('present')
        if (read.kind === 'present') {
          expect(read.value.length).toBeGreaterThan(0)
          expect(
            new Set(read.value.map((entry) => entry.mailboxId.jmapId)).size,
          ).toBe(read.value.length)
        }
      }

      expect(
        await active.readRepository.readEmailMemberships(emailA1.id),
      ).toEqual({
        ok: true,
        value: {
          kind: 'present',
          value: [createTestEmailMailbox(emailA1, inboxA)],
        },
      })
    })

    it('MH-S05 preserves exact EmailBody representations through replacements', async () => {
      const active = currentRuntime()
      const { accountA, emailA1 } = createTestFixtures()
      await register(active, accountA)
      await replaceEmails(
        active,
        accountA,
        [emailRecord(emailA1)],
        'hardening-s05',
      )
      const bodies = [
        createTestEmailBody(emailA1, 'text', null),
        createTestEmailBody(emailA1, null, '<p>html</p>'),
        createTestEmailBody(emailA1, null, null),
        createTestEmailBody(emailA1, '', null),
        createTestEmailBody(emailA1, null, ''),
        createTestEmailBody(emailA1, '', ''),
      ]
      for (const body of bodies)
        await expectWriteOk(active.syncPort.cacheEmailBody(body))

      expect(await active.readRepository.readEmailBody(emailA1.id)).toEqual({
        ok: true,
        value: { kind: 'cached', value: bodies.at(-1) },
      })
    })

    it('MH-S06 keeps attachments sharing a Blob distinct by PartId', async () => {
      const active = currentRuntime()
      const { accountA, emailA1 } = createTestFixtures()
      const first = createTestAttachmentRef(emailA1, 'part-A', {
        blobToken: 'shared',
      })
      const second = createTestAttachmentRef(emailA1, 'part-B', {
        blobToken: 'shared',
      })
      await register(active, accountA)
      await replaceEmails(
        active,
        accountA,
        [emailRecord(emailA1)],
        'hardening-s06',
      )
      await expectWriteOk(
        active.syncPort.replaceAttachmentRefs(emailA1.id, [first]),
      )
      await expectWriteOk(
        active.syncPort.replaceAttachmentRefs(emailA1.id, [second, first]),
      )

      expect(first.blobId).toEqual(second.blobId)
      expect(first.partId).not.toBe(second.partId)
      expect(
        await active.readRepository.readAttachmentRefs(emailA1.id),
      ).toEqual({ ok: true, value: { kind: 'cached', value: [second, first] } })
    })
  })

  describe('CAS and subscription hardening', () => {
    it('MH-CAS01 allows exactly one winner in repeated double claims', async () => {
      const active = currentRuntime()
      const { accountA, identityA } = createTestFixtures()
      await register(active, accountA)
      for (let index = 0; index < 10; index += 1) {
        const pending = createTestSendMutation(
          accountA,
          identityA,
          `hardening-cas01-${index}`,
        )
        const next = startMutationAttempt(pending)
        await expectWriteOk(active.syncPort.stageSendMutation(pending))
        const results = await Promise.all([
          active.syncPort.replacePendingMutationIfCurrent(pending, next),
          active.syncPort.replacePendingMutationIfCurrent(pending, next),
        ])
        expect(results.filter((result) => result.ok)).toHaveLength(1)
        expect(
          results.filter(
            (result) => !result.ok && result.error.kind === 'conflict',
          ),
        ).toHaveLength(1)
        expect(
          await active.readRepository.readPendingMutation(
            accountA.key,
            pending.mutationId,
          ),
        ).toEqual({ ok: true, value: { kind: 'present', value: next } })
      }
    })

    it('MH-CAS02 rejects old snapshots after a multi-step lifecycle', async () => {
      const active = currentRuntime()
      const { accountA, identityA } = createTestFixtures()
      const pending = createTestSendMutation(
        accountA,
        identityA,
        'hardening-cas02',
      )
      const inFlight1 = startMutationAttempt(pending)
      const retrying = scheduleMutationRetry(
        inFlight1,
        createTestMutationInstant('2026-02-01T00:00:00.000Z'),
      )
      const inFlight2 = startMutationAttempt(retrying)
      const terminal = failMutationTerminal(inFlight2)
      await register(active, accountA)
      await expectWriteOk(active.syncPort.stageSendMutation(pending))
      await expectWriteOk(
        active.syncPort.replacePendingMutationIfCurrent(pending, inFlight1),
      )
      await expectWriteOk(
        active.syncPort.replacePendingMutationIfCurrent(inFlight1, retrying),
      )
      await expectWriteOk(
        active.syncPort.replacePendingMutationIfCurrent(retrying, inFlight2),
      )
      await expectWriteOk(
        active.syncPort.replacePendingMutationIfCurrent(inFlight2, terminal),
      )

      expectErrorKind(
        await active.syncPort.replacePendingMutationIfCurrent(
          pending,
          inFlight1,
        ),
        'conflict',
      )
      expectErrorKind(
        await active.syncPort.replacePendingMutationIfCurrent(
          inFlight1,
          retrying,
        ),
        'conflict',
      )
      expect(
        await active.readRepository.readPendingMutation(
          accountA.key,
          pending.mutationId,
        ),
      ).toEqual({ ok: true, value: { kind: 'present', value: terminal } })
    })

    it('MH-N01 lets a subscriber unsubscribe itself during callback', async () => {
      const active = currentRuntime()
      const { accountA, accountB } = createTestFixtures()
      let calls = 0
      const subscriptionHolder: { current?: LocalChangeSubscription } = {}
      subscriptionHolder.current = unwrapOk(
        await active.localChangeSource.subscribe(() => {
          calls += 1
          subscriptionHolder.current?.unsubscribe()
        }),
      )

      await expectWriteOk(active.syncPort.registerAccount(accountA))
      await active.settle()
      const callsAfterFirst = calls
      await expectWriteOk(active.syncPort.registerAccount(accountB))
      await active.settle()

      expect(callsAfterFirst).toBeGreaterThan(0)
      expect(calls).toBe(callsAfterFirst)
      subscriptionHolder.current.unsubscribe()
    })

    it('MH-N02 keeps the change hub healthy around a throwing listener', async () => {
      const active = currentRuntime()
      const { accountA, accountB } = createTestFixtures()
      const recorder = createNotificationRecorder()
      const throwing = unwrapOk(
        await active.localChangeSource.subscribe(() => {
          throw new Error('hardening listener failure')
        }),
      )
      const healthy = unwrapOk(
        await active.localChangeSource.subscribe(recorder.listener),
      )
      try {
        await expectWriteOk(active.syncPort.registerAccount(accountA))
        await expectWriteOk(active.syncPort.registerAccount(accountB))
        await active.settle()
        expectHintCoverage(recorder.hints(), [{ kind: 'accounts' }])
        expect(await active.readRepository.listAccounts()).toEqual({
          ok: true,
          value: [accountA, accountB],
        })
      } finally {
        throwing.unsubscribe()
        healthy.unsubscribe()
      }
    })
  })
})
