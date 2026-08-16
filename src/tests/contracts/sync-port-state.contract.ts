import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { account, type Account } from '../../domain/account'
import type { Email } from '../../domain/email'
import { identity, type Identity } from '../../domain/identity'
import type { EmailMailbox, Mailbox } from '../../domain/mailbox'
import type { CollectionSyncCursor } from '../../domain/sync-cursor'
import type { ReadRepository } from '../../ports/read-repository'
import type {
  CollectionCursorPrecondition,
  EmailSyncRecord,
  SyncPort,
  WriteResult,
} from '../../ports/sync-port'
import { expectErrorKind, unwrapOk } from './assertions'
import {
  createTestAttachmentRef,
  createTestCollectionSyncCursor,
  createTestEmail,
  createTestEmailBody,
  createTestEmailMailbox,
  createTestFixtures,
  createTestIdentity,
  createTestMailbox,
  createTestMailboxView,
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
  email: Email,
  memberships: readonly EmailMailbox[] = [],
): EmailSyncRecord {
  return { email, memberships }
}

async function replaceEmails(
  syncPort: SyncPort,
  expectedCursor: CollectionCursorPrecondition,
  nextCursor: CollectionSyncCursor,
  snapshot: readonly EmailSyncRecord[],
): Promise<void> {
  await expectWriteOk(
    syncPort.applyCollectionSync({
      kind: 'email',
      mode: 'replace',
      expectedCursor,
      nextCursor,
      snapshot,
    }),
  )
}

async function deltaEmails(
  syncPort: SyncPort,
  expectedCursor: CollectionSyncCursor,
  nextCursor: CollectionSyncCursor,
  changed: readonly EmailSyncRecord[],
  destroyed: readonly Email['id'][],
): Promise<void> {
  await expectWriteOk(
    syncPort.applyCollectionSync({
      kind: 'email',
      mode: 'delta',
      expectedCursor: { kind: 'matches', cursor: expectedCursor },
      nextCursor,
      changed,
      destroyed,
    }),
  )
}

async function replaceMailboxes(
  syncPort: SyncPort,
  expectedCursor: CollectionCursorPrecondition,
  nextCursor: CollectionSyncCursor,
  snapshot: readonly Mailbox[],
): Promise<void> {
  await expectWriteOk(
    syncPort.applyCollectionSync({
      kind: 'mailbox',
      mode: 'replace',
      expectedCursor,
      nextCursor,
      snapshot,
    }),
  )
}

async function replaceIdentities(
  syncPort: SyncPort,
  expectedCursor: CollectionCursorPrecondition,
  nextCursor: CollectionSyncCursor,
  snapshot: readonly Identity[],
): Promise<void> {
  await expectWriteOk(
    syncPort.applyCollectionSync({
      kind: 'identity',
      mode: 'replace',
      expectedCursor,
      nextCursor,
      snapshot,
    }),
  )
}

async function expectEmailPresent(
  readRepository: ReadRepository,
  expected: Email,
): Promise<void> {
  expect(unwrapOk(await readRepository.readEmail(expected.id))).toEqual({
    kind: 'present',
    value: expected,
  })
}

async function expectEmailAbsent(
  readRepository: ReadRepository,
  expected: Email,
): Promise<void> {
  expect(unwrapOk(await readRepository.readEmail(expected.id))).toEqual({
    kind: 'absent',
  })
}

async function expectCursor(
  readRepository: ReadRepository,
  expected: CollectionSyncCursor,
): Promise<void> {
  expect(
    unwrapOk(
      await readRepository.readCollectionSyncCursor(
        expected.accountKey,
        expected.dataType,
      ),
    ),
  ).toEqual({ kind: 'present', value: expected })
}

export function defineSyncPortStateContract(
  harness: LocalEngineContractHarness,
): void {
  describe(`SyncPort state contract — ${harness.name}`, () => {
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
        throw new Error('SyncPort state contract runtime is not available')
      }

      return runtime
    }

    describe('Account registration', () => {
      it('SP-A01 registers a new Account', async () => {
        const { accountA } = createTestFixtures()
        const { readRepository, syncPort } = currentRuntime()

        await expectWriteOk(syncPort.registerAccount(accountA))

        expect(
          unwrapOk(await readRepository.readAccount(accountA.key)),
        ).toEqual({ kind: 'present', value: accountA })
      })

      it('SP-A02 treats the same Account and binding idempotently', async () => {
        const { accountA } = createTestFixtures()
        const { readRepository, syncPort } = currentRuntime()
        await expectWriteOk(syncPort.registerAccount(accountA))

        await expectWriteOk(syncPort.registerAccount(accountA))

        expect(
          unwrapOk(await readRepository.readAccount(accountA.key)),
        ).toEqual({ kind: 'present', value: accountA })
        expect(unwrapOk(await readRepository.listAccounts())).toEqual([
          accountA,
        ])
      })

      it('SP-A03 rejects a silent Account rebind and preserves the original', async () => {
        const { accountA } = createTestFixtures()
        const alternativeBinding = createTestFixtures().accountB.remoteRef
        const reboundAccount = account(accountA.key, alternativeBinding)
        const { readRepository, syncPort } = currentRuntime()
        await expectWriteOk(syncPort.registerAccount(accountA))

        await expectWriteConflict(syncPort.registerAccount(reboundAccount))

        expect(
          unwrapOk(await readRepository.readAccount(accountA.key)),
        ).toEqual({ kind: 'present', value: accountA })
        expect(unwrapOk(await readRepository.listAccounts())).toEqual([
          accountA,
        ])
      })
    })

    describe('Collection sync general', () => {
      it('SP-CS01 requires the Account owner and commits no hidden state', async () => {
        const { accountA, emailA1 } = createTestFixtures()
        const cursor = createTestCollectionSyncCursor(
          accountA,
          'email',
          'state-1',
        )
        const { readRepository, syncPort } = currentRuntime()

        await expectWriteConflict(
          syncPort.applyCollectionSync({
            kind: 'email',
            mode: 'replace',
            expectedCursor: { kind: 'absent' },
            nextCursor: cursor,
            snapshot: [emailRecord(emailA1)],
          }),
        )

        expect(
          unwrapOk(await readRepository.readAccount(accountA.key)),
        ).toEqual({ kind: 'absent' })
        expect(
          unwrapOk(
            await readRepository.readCollectionSyncCursor(
              accountA.key,
              'email',
            ),
          ),
        ).toEqual({ kind: 'ownerAbsent' })
        await expectEmailAbsent(readRepository, emailA1)
      })

      it('SP-CS02 applies an initial replace from an absent cursor', async () => {
        const { accountA, emailA1, inboxA } = createTestFixtures()
        const membership = createTestEmailMailbox(emailA1, inboxA)
        const cursor = createTestCollectionSyncCursor(
          accountA,
          'email',
          'state-1',
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])

        await replaceEmails(syncPort, { kind: 'absent' }, cursor, [
          emailRecord(emailA1, [membership]),
        ])

        await expectEmailPresent(readRepository, emailA1)
        expect(
          unwrapOk(await readRepository.readEmailMemberships(emailA1.id)),
        ).toEqual({ kind: 'present', value: [membership] })
        await expectCursor(readRepository, cursor)
      })

      it('SP-CS03 rejects expected absent after a cursor exists without replacing state', async () => {
        const { accountA, emailA1, emailA2 } = createTestFixtures()
        const cursor1 = createTestCollectionSyncCursor(
          accountA,
          'email',
          'state-1',
        )
        const cursor2 = createTestCollectionSyncCursor(
          accountA,
          'email',
          'state-2',
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceEmails(syncPort, { kind: 'absent' }, cursor1, [
          emailRecord(emailA1),
        ])

        await expectWriteConflict(
          syncPort.applyCollectionSync({
            kind: 'email',
            mode: 'replace',
            expectedCursor: { kind: 'absent' },
            nextCursor: cursor2,
            snapshot: [emailRecord(emailA2)],
          }),
        )

        await expectEmailPresent(readRepository, emailA1)
        await expectEmailAbsent(readRepository, emailA2)
        await expectCursor(readRepository, cursor1)
      })

      it('SP-CS04 replaces a collection with its exact expected cursor', async () => {
        const { accountA, emailA1, emailA2 } = createTestFixtures()
        const cursor1 = createTestCollectionSyncCursor(
          accountA,
          'email',
          'state-1',
        )
        const cursor2 = createTestCollectionSyncCursor(
          accountA,
          'email',
          'state-2',
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceEmails(syncPort, { kind: 'absent' }, cursor1, [
          emailRecord(emailA1),
        ])

        await replaceEmails(
          syncPort,
          { kind: 'matches', cursor: cursor1 },
          cursor2,
          [emailRecord(emailA2)],
        )

        await expectEmailAbsent(readRepository, emailA1)
        await expectEmailPresent(readRepository, emailA2)
        await expectCursor(readRepository, cursor2)
      })

      it('SP-CS05 rejects a stale replace and preserves collection and cursor', async () => {
        const { accountA, emailA1, emailA2 } = createTestFixtures()
        const emailA3 = createTestEmail(accountA, 'E3')
        const cursor1 = createTestCollectionSyncCursor(
          accountA,
          'email',
          'state-1',
        )
        const cursor2 = createTestCollectionSyncCursor(
          accountA,
          'email',
          'state-2',
        )
        const cursor3 = createTestCollectionSyncCursor(
          accountA,
          'email',
          'state-3',
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceEmails(syncPort, { kind: 'absent' }, cursor1, [
          emailRecord(emailA1),
        ])
        await replaceEmails(
          syncPort,
          { kind: 'matches', cursor: cursor1 },
          cursor2,
          [emailRecord(emailA2)],
        )

        await expectWriteConflict(
          syncPort.applyCollectionSync({
            kind: 'email',
            mode: 'replace',
            expectedCursor: { kind: 'matches', cursor: cursor1 },
            nextCursor: cursor3,
            snapshot: [emailRecord(emailA3)],
          }),
        )

        await expectEmailAbsent(readRepository, emailA1)
        await expectEmailPresent(readRepository, emailA2)
        await expectEmailAbsent(readRepository, emailA3)
        await expectCursor(readRepository, cursor2)
      })

      it('SP-CS06 applies changed and destroyed records with an exact delta cursor', async () => {
        const { accountA, emailA1, emailA2 } = createTestFixtures()
        const updatedEmailA1 = createTestEmail(accountA, 'E1', {
          subject: 'updated-subject-E1',
        })
        const emailA3 = createTestEmail(accountA, 'E3')
        const cursor1 = createTestCollectionSyncCursor(
          accountA,
          'email',
          'state-1',
        )
        const cursor2 = createTestCollectionSyncCursor(
          accountA,
          'email',
          'state-2',
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceEmails(syncPort, { kind: 'absent' }, cursor1, [
          emailRecord(emailA1),
          emailRecord(emailA2),
        ])

        await deltaEmails(
          syncPort,
          cursor1,
          cursor2,
          [emailRecord(updatedEmailA1), emailRecord(emailA3)],
          [emailA2.id],
        )

        await expectEmailPresent(readRepository, updatedEmailA1)
        await expectEmailAbsent(readRepository, emailA2)
        await expectEmailPresent(readRepository, emailA3)
        await expectCursor(readRepository, cursor2)
      })

      it('SP-CS07 rejects a stale delta without applying changed or destroyed records', async () => {
        const { accountA, emailA1, emailA2 } = createTestFixtures()
        const updatedEmailA1 = createTestEmail(accountA, 'E1', {
          subject: 'stale-update',
        })
        const emailA3 = createTestEmail(accountA, 'E3')
        const cursor1 = createTestCollectionSyncCursor(
          accountA,
          'email',
          'state-1',
        )
        const cursor2 = createTestCollectionSyncCursor(
          accountA,
          'email',
          'state-2',
        )
        const cursor3 = createTestCollectionSyncCursor(
          accountA,
          'email',
          'state-3',
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceEmails(syncPort, { kind: 'absent' }, cursor1, [
          emailRecord(emailA1),
          emailRecord(emailA2),
        ])
        await deltaEmails(syncPort, cursor1, cursor2, [], [])

        await expectWriteConflict(
          syncPort.applyCollectionSync({
            kind: 'email',
            mode: 'delta',
            expectedCursor: { kind: 'matches', cursor: cursor1 },
            nextCursor: cursor3,
            changed: [emailRecord(updatedEmailA1), emailRecord(emailA3)],
            destroyed: [emailA2.id],
          }),
        )

        await expectEmailPresent(readRepository, emailA1)
        await expectEmailPresent(readRepository, emailA2)
        await expectEmailAbsent(readRepository, emailA3)
        await expectCursor(readRepository, cursor2)
      })

      it('SP-CS08 allows an empty delta to advance the cursor', async () => {
        const { accountA, emailA1 } = createTestFixtures()
        const cursor1 = createTestCollectionSyncCursor(
          accountA,
          'email',
          'state-1',
        )
        const cursor2 = createTestCollectionSyncCursor(
          accountA,
          'email',
          'state-2',
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceEmails(syncPort, { kind: 'absent' }, cursor1, [
          emailRecord(emailA1),
        ])

        await deltaEmails(syncPort, cursor1, cursor2, [], [])

        await expectEmailPresent(readRepository, emailA1)
        await expectCursor(readRepository, cursor2)
      })

      it('SP-CS09 accepts an equal opaque next state without monotonic interpretation', async () => {
        const { accountA, emailA1 } = createTestFixtures()
        const cursor1 = createTestCollectionSyncCursor(
          accountA,
          'email',
          'opaque-state',
        )
        const equalStateCursor = createTestCollectionSyncCursor(
          accountA,
          'email',
          'opaque-state',
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceEmails(syncPort, { kind: 'absent' }, cursor1, [
          emailRecord(emailA1),
        ])

        await deltaEmails(syncPort, cursor1, equalStateCursor, [], [])

        await expectEmailPresent(readRepository, emailA1)
        await expectCursor(readRepository, equalStateCursor)
      })

      it('SP-CS10 rejects a cross-Account next cursor without modifying either Account', async () => {
        const { accountA, accountB, emailA1, emailB1 } = createTestFixtures()
        const cursorB = createTestCollectionSyncCursor(
          accountB,
          'email',
          'state-B',
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA, accountB])

        await expectWriteConflict(
          syncPort.applyCollectionSync({
            kind: 'email',
            mode: 'replace',
            expectedCursor: { kind: 'absent' },
            nextCursor: cursorB,
            snapshot: [emailRecord(emailA1)],
          }),
        )

        await expectEmailAbsent(readRepository, emailA1)
        await expectEmailAbsent(readRepository, emailB1)
        expect(
          unwrapOk(
            await readRepository.readCollectionSyncCursor(
              accountA.key,
              'email',
            ),
          ),
        ).toEqual({ kind: 'absent' })
        expect(
          unwrapOk(
            await readRepository.readCollectionSyncCursor(
              accountB.key,
              'email',
            ),
          ),
        ).toEqual({ kind: 'absent' })
      })

      it('SP-CS11 rejects a collection and cursor dataType mismatch without state changes', async () => {
        const { accountA, emailA1 } = createTestFixtures()
        const mailboxCursor = createTestCollectionSyncCursor(
          accountA,
          'mailbox',
          'state-1',
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])

        await expectWriteConflict(
          syncPort.applyCollectionSync({
            kind: 'email',
            mode: 'replace',
            expectedCursor: { kind: 'absent' },
            nextCursor: mailboxCursor,
            snapshot: [emailRecord(emailA1)],
          }),
        )

        await expectEmailAbsent(readRepository, emailA1)
        expect(
          unwrapOk(
            await readRepository.readCollectionSyncCursor(
              accountA.key,
              'email',
            ),
          ),
        ).toEqual({ kind: 'absent' })
        expect(
          unwrapOk(
            await readRepository.readCollectionSyncCursor(
              accountA.key,
              'mailbox',
            ),
          ),
        ).toEqual({ kind: 'absent' })
      })

      it('SP-CS12 rejects duplicate changed identities without advancing state', async () => {
        const { accountA, emailA1 } = createTestFixtures()
        const cursor1 = createTestCollectionSyncCursor(
          accountA,
          'email',
          'state-1',
        )
        const cursor2 = createTestCollectionSyncCursor(
          accountA,
          'email',
          'state-2',
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceEmails(syncPort, { kind: 'absent' }, cursor1, [
          emailRecord(emailA1),
        ])
        const updatedEmailA1 = createTestEmail(accountA, 'E1', {
          subject: 'duplicate-update',
        })

        await expectWriteConflict(
          syncPort.applyCollectionSync({
            kind: 'email',
            mode: 'delta',
            expectedCursor: { kind: 'matches', cursor: cursor1 },
            nextCursor: cursor2,
            changed: [emailRecord(updatedEmailA1), emailRecord(updatedEmailA1)],
            destroyed: [],
          }),
        )

        await expectEmailPresent(readRepository, emailA1)
        await expectCursor(readRepository, cursor1)
      })

      it('SP-CS13 rejects duplicate destroyed identities without advancing state', async () => {
        const { accountA, emailA1 } = createTestFixtures()
        const cursor1 = createTestCollectionSyncCursor(
          accountA,
          'email',
          'state-1',
        )
        const cursor2 = createTestCollectionSyncCursor(
          accountA,
          'email',
          'state-2',
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceEmails(syncPort, { kind: 'absent' }, cursor1, [
          emailRecord(emailA1),
        ])

        await expectWriteConflict(
          syncPort.applyCollectionSync({
            kind: 'email',
            mode: 'delta',
            expectedCursor: { kind: 'matches', cursor: cursor1 },
            nextCursor: cursor2,
            changed: [],
            destroyed: [emailA1.id, emailA1.id],
          }),
        )

        await expectEmailPresent(readRepository, emailA1)
        await expectCursor(readRepository, cursor1)
      })

      it('SP-CS14 rejects changed and destroyed overlap without partial state', async () => {
        const { accountA, emailA1 } = createTestFixtures()
        const cursor1 = createTestCollectionSyncCursor(
          accountA,
          'email',
          'state-1',
        )
        const cursor2 = createTestCollectionSyncCursor(
          accountA,
          'email',
          'state-2',
        )
        const updatedEmailA1 = createTestEmail(accountA, 'E1', {
          subject: 'overlap-update',
        })
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceEmails(syncPort, { kind: 'absent' }, cursor1, [
          emailRecord(emailA1),
        ])

        await expectWriteConflict(
          syncPort.applyCollectionSync({
            kind: 'email',
            mode: 'delta',
            expectedCursor: { kind: 'matches', cursor: cursor1 },
            nextCursor: cursor2,
            changed: [emailRecord(updatedEmailA1)],
            destroyed: [emailA1.id],
          }),
        )

        await expectEmailPresent(readRepository, emailA1)
        await expectCursor(readRepository, cursor1)
      })

      it('SP-CS15 rejects an entity from another Account without modifying either scope', async () => {
        const { accountA, accountB, emailA1, emailB1 } = createTestFixtures()
        const cursorA = createTestCollectionSyncCursor(
          accountA,
          'email',
          'state-A',
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA, accountB])

        await expectWriteConflict(
          syncPort.applyCollectionSync({
            kind: 'email',
            mode: 'replace',
            expectedCursor: { kind: 'absent' },
            nextCursor: cursorA,
            snapshot: [emailRecord(emailB1)],
          }),
        )

        await expectEmailAbsent(readRepository, emailA1)
        await expectEmailAbsent(readRepository, emailB1)
        expect(
          unwrapOk(
            await readRepository.readCollectionSyncCursor(
              accountA.key,
              'email',
            ),
          ),
        ).toEqual({ kind: 'absent' })
        expect(
          unwrapOk(
            await readRepository.readCollectionSyncCursor(
              accountB.key,
              'email',
            ),
          ),
        ).toEqual({ kind: 'absent' })
      })

      it('SP-CS16 treats destruction of an absent entity idempotently', async () => {
        const { accountA, emailA1 } = createTestFixtures()
        const cursor1 = createTestCollectionSyncCursor(
          accountA,
          'email',
          'state-1',
        )
        const cursor2 = createTestCollectionSyncCursor(
          accountA,
          'email',
          'state-2',
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceEmails(syncPort, { kind: 'absent' }, cursor1, [])

        await deltaEmails(syncPort, cursor1, cursor2, [], [emailA1.id])

        await expectEmailAbsent(readRepository, emailA1)
        await expectCursor(readRepository, cursor2)
      })

      it('SP-CS17 keeps every affected projection unchanged after failed cursor CAS', async () => {
        const { accountA, emailA1, emailA2, inboxA } = createTestFixtures()
        const emailA3 = createTestEmail(accountA, 'E3')
        const updatedEmailA1 = createTestEmail(accountA, 'E1', {
          subject: 'stale-full-update',
        })
        const membership = createTestEmailMailbox(emailA1, inboxA)
        const cursor1 = createTestCollectionSyncCursor(
          accountA,
          'email',
          'state-1',
        )
        const cursor2 = createTestCollectionSyncCursor(
          accountA,
          'email',
          'state-2',
        )
        const cursor3 = createTestCollectionSyncCursor(
          accountA,
          'email',
          'state-3',
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceEmails(syncPort, { kind: 'absent' }, cursor1, [
          emailRecord(emailA1, [membership]),
          emailRecord(emailA2),
        ])
        await deltaEmails(syncPort, cursor1, cursor2, [], [])

        await expectWriteConflict(
          syncPort.applyCollectionSync({
            kind: 'email',
            mode: 'delta',
            expectedCursor: { kind: 'matches', cursor: cursor1 },
            nextCursor: cursor3,
            changed: [emailRecord(updatedEmailA1), emailRecord(emailA3)],
            destroyed: [emailA2.id],
          }),
        )

        await expectEmailPresent(readRepository, emailA1)
        await expectEmailPresent(readRepository, emailA2)
        await expectEmailAbsent(readRepository, emailA3)
        expect(
          unwrapOk(await readRepository.readEmailMemberships(emailA1.id)),
        ).toEqual({ kind: 'present', value: [membership] })
        await expectCursor(readRepository, cursor2)
      })
    })

    describe('Email collection semantics', () => {
      it('SP-E01 commits a valid EmailSyncRecord and its memberships', async () => {
        const { accountA, emailA1, inboxA } = createTestFixtures()
        const membership = createTestEmailMailbox(emailA1, inboxA)
        const cursor = createTestCollectionSyncCursor(
          accountA,
          'email',
          'email-state-1',
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])

        await replaceEmails(syncPort, { kind: 'absent' }, cursor, [
          emailRecord(emailA1, [membership]),
        ])

        await expectEmailPresent(readRepository, emailA1)
        expect(
          unwrapOk(await readRepository.readEmailMemberships(emailA1.id)),
        ).toEqual({ kind: 'present', value: [membership] })
      })

      it('SP-E02 rejects a membership that targets another Email and commits nothing', async () => {
        const { accountA, emailA1, emailA2, inboxA } = createTestFixtures()
        const wrongMembership = createTestEmailMailbox(emailA2, inboxA)
        const cursor = createTestCollectionSyncCursor(
          accountA,
          'email',
          'email-state-1',
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])

        await expectWriteConflict(
          syncPort.applyCollectionSync({
            kind: 'email',
            mode: 'replace',
            expectedCursor: { kind: 'absent' },
            nextCursor: cursor,
            snapshot: [emailRecord(emailA1, [wrongMembership])],
          }),
        )

        await expectEmailAbsent(readRepository, emailA1)
        expect(
          unwrapOk(await readRepository.readEmailMemberships(emailA1.id)),
        ).toEqual({ kind: 'ownerAbsent' })
        expect(
          unwrapOk(
            await readRepository.readCollectionSyncCursor(
              accountA.key,
              'email',
            ),
          ),
        ).toEqual({ kind: 'absent' })
      })

      it('SP-E03 rejects duplicate membership identities and commits nothing', async () => {
        const { accountA, emailA1, inboxA } = createTestFixtures()
        const membership = createTestEmailMailbox(emailA1, inboxA)
        const cursor = createTestCollectionSyncCursor(
          accountA,
          'email',
          'email-state-1',
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])

        await expectWriteConflict(
          syncPort.applyCollectionSync({
            kind: 'email',
            mode: 'replace',
            expectedCursor: { kind: 'absent' },
            nextCursor: cursor,
            snapshot: [emailRecord(emailA1, [membership, membership])],
          }),
        )

        await expectEmailAbsent(readRepository, emailA1)
        expect(
          unwrapOk(await readRepository.readEmailMemberships(emailA1.id)),
        ).toEqual({ kind: 'ownerAbsent' })
        expect(
          unwrapOk(
            await readRepository.readCollectionSyncCursor(
              accountA.key,
              'email',
            ),
          ),
        ).toEqual({ kind: 'absent' })
      })

      it('SP-E04 accepts a valid membership whose Mailbox row is not materialized', async () => {
        const { accountA, emailA1, inboxA } = createTestFixtures()
        const membership = createTestEmailMailbox(emailA1, inboxA)
        const cursor = createTestCollectionSyncCursor(
          accountA,
          'email',
          'email-state-1',
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])

        await replaceEmails(syncPort, { kind: 'absent' }, cursor, [
          emailRecord(emailA1, [membership]),
        ])

        await expectEmailPresent(readRepository, emailA1)
        expect(
          unwrapOk(await readRepository.readEmailMemberships(emailA1.id)),
        ).toEqual({ kind: 'present', value: [membership] })
        expect(unwrapOk(await readRepository.readMailbox(inboxA.id))).toEqual({
          kind: 'absent',
        })
      })

      it('SP-E05 replaces the complete membership snapshot of a changed Email', async () => {
        const { accountA, emailA1, inboxA, archiveA } = createTestFixtures()
        const inboxMembership = createTestEmailMailbox(emailA1, inboxA)
        const archiveMembership = createTestEmailMailbox(emailA1, archiveA)
        const updatedEmailA1 = createTestEmail(accountA, 'E1', {
          subject: 'membership-update',
        })
        const cursor1 = createTestCollectionSyncCursor(
          accountA,
          'email',
          'email-state-1',
        )
        const cursor2 = createTestCollectionSyncCursor(
          accountA,
          'email',
          'email-state-2',
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceEmails(syncPort, { kind: 'absent' }, cursor1, [
          emailRecord(emailA1, [inboxMembership, archiveMembership]),
        ])

        await deltaEmails(
          syncPort,
          cursor1,
          cursor2,
          [emailRecord(updatedEmailA1, [archiveMembership])],
          [],
        )

        await expectEmailPresent(readRepository, updatedEmailA1)
        expect(
          unwrapOk(await readRepository.readEmailMemberships(emailA1.id)),
        ).toEqual({ kind: 'present', value: [archiveMembership] })
      })

      it('SP-E06 removes Emails omitted from a replacement snapshot', async () => {
        const { accountA, emailA1, emailA2 } = createTestFixtures()
        const emailA3 = createTestEmail(accountA, 'E3')
        const cursor1 = createTestCollectionSyncCursor(
          accountA,
          'email',
          'email-state-1',
        )
        const cursor2 = createTestCollectionSyncCursor(
          accountA,
          'email',
          'email-state-2',
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceEmails(syncPort, { kind: 'absent' }, cursor1, [
          emailRecord(emailA1),
          emailRecord(emailA2),
          emailRecord(emailA3),
        ])

        await replaceEmails(
          syncPort,
          { kind: 'matches', cursor: cursor1 },
          cursor2,
          [emailRecord(emailA1), emailRecord(emailA3)],
        )

        await expectEmailPresent(readRepository, emailA1)
        await expectEmailAbsent(readRepository, emailA2)
        await expectEmailPresent(readRepository, emailA3)
        await expectCursor(readRepository, cursor2)
      })

      it('SP-E07 preserves lazy caches across a delta for a surviving Email', async () => {
        const { accountA, emailA1, standardBodyA1, attachmentsA1 } =
          createTestFixtures()
        const updatedEmailA1 = createTestEmail(accountA, 'E1', {
          subject: 'delta-survivor',
        })
        const cursor1 = createTestCollectionSyncCursor(
          accountA,
          'email',
          'email-state-1',
        )
        const cursor2 = createTestCollectionSyncCursor(
          accountA,
          'email',
          'email-state-2',
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceEmails(syncPort, { kind: 'absent' }, cursor1, [
          emailRecord(emailA1),
        ])
        await expectWriteOk(syncPort.cacheEmailBody(standardBodyA1))
        await expectWriteOk(
          syncPort.replaceAttachmentRefs(emailA1.id, attachmentsA1),
        )

        await deltaEmails(
          syncPort,
          cursor1,
          cursor2,
          [emailRecord(updatedEmailA1)],
          [],
        )

        await expectEmailPresent(readRepository, updatedEmailA1)
        expect(
          unwrapOk(await readRepository.readEmailBody(emailA1.id)),
        ).toEqual({ kind: 'cached', value: standardBodyA1 })
        const refs = unwrapOk(
          await readRepository.readAttachmentRefs(emailA1.id),
        )
        expect(refs.kind).toBe('cached')
        if (refs.kind === 'cached') {
          expectUnorderedExact(refs.value, attachmentsA1)
        }
      })

      it('SP-E08 preserves lazy caches across replace for a surviving Email', async () => {
        const { accountA, emailA1, emailA2, standardBodyA1, attachmentsA1 } =
          createTestFixtures()
        const updatedEmailA1 = createTestEmail(accountA, 'E1', {
          subject: 'replace-survivor',
        })
        const cursor1 = createTestCollectionSyncCursor(
          accountA,
          'email',
          'email-state-1',
        )
        const cursor2 = createTestCollectionSyncCursor(
          accountA,
          'email',
          'email-state-2',
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceEmails(syncPort, { kind: 'absent' }, cursor1, [
          emailRecord(emailA1),
          emailRecord(emailA2),
        ])
        await expectWriteOk(syncPort.cacheEmailBody(standardBodyA1))
        await expectWriteOk(
          syncPort.replaceAttachmentRefs(emailA1.id, attachmentsA1),
        )

        await replaceEmails(
          syncPort,
          { kind: 'matches', cursor: cursor1 },
          cursor2,
          [emailRecord(updatedEmailA1), emailRecord(emailA2)],
        )

        await expectEmailPresent(readRepository, updatedEmailA1)
        expect(
          unwrapOk(await readRepository.readEmailBody(emailA1.id)),
        ).toEqual({ kind: 'cached', value: standardBodyA1 })
        const refs = unwrapOk(
          await readRepository.readAttachmentRefs(emailA1.id),
        )
        expect(refs.kind).toBe('cached')
        if (refs.kind === 'cached') {
          expectUnorderedExact(refs.value, attachmentsA1)
        }
      })

      it('SP-E09 leaves cached MailboxView state unchanged during Email sync', async () => {
        const { accountA, inboxA, emptyInboxViewA, emailA1 } =
          createTestFixtures()
        const mailboxCursor = createTestCollectionSyncCursor(
          accountA,
          'mailbox',
          'mailbox-state-1',
        )
        const emailCursor = createTestCollectionSyncCursor(
          accountA,
          'email',
          'email-state-1',
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceMailboxes(syncPort, { kind: 'absent' }, mailboxCursor, [
          inboxA,
        ])
        await expectWriteOk(syncPort.replaceMailboxView(emptyInboxViewA))

        await replaceEmails(syncPort, { kind: 'absent' }, emailCursor, [
          emailRecord(emailA1),
        ])

        expect(
          unwrapOk(await readRepository.readMailboxView(emptyInboxViewA.spec)),
        ).toEqual({ kind: 'cached', value: emptyInboxViewA })
      })
    })

    describe('Mailbox collection', () => {
      it('SP-M01 applies Mailbox delta create, update, and destroy semantics', async () => {
        const { accountA } = createTestFixtures()
        const mailbox1 = createTestMailbox(accountA, 'M1')
        const mailbox2 = createTestMailbox(accountA, 'M2')
        const updatedMailbox1 = createTestMailbox(accountA, 'M1', {
          totalEmails: 3,
          unreadEmails: 1,
        })
        const mailbox3 = createTestMailbox(accountA, 'M3')
        const cursor1 = createTestCollectionSyncCursor(
          accountA,
          'mailbox',
          'mailbox-state-1',
        )
        const cursor2 = createTestCollectionSyncCursor(
          accountA,
          'mailbox',
          'mailbox-state-2',
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceMailboxes(syncPort, { kind: 'absent' }, cursor1, [
          mailbox1,
          mailbox2,
        ])

        await expectWriteOk(
          syncPort.applyCollectionSync({
            kind: 'mailbox',
            mode: 'delta',
            expectedCursor: { kind: 'matches', cursor: cursor1 },
            nextCursor: cursor2,
            changed: [updatedMailbox1, mailbox3],
            destroyed: [mailbox2.id],
          }),
        )

        const snapshot = unwrapOk(
          await readRepository.listMailboxes(accountA.key),
        )
        expect(snapshot.kind).toBe('present')
        if (snapshot.kind === 'present') {
          expectUnorderedExact(snapshot.value, [updatedMailbox1, mailbox3])
        }
        expect(unwrapOk(await readRepository.readMailbox(mailbox2.id))).toEqual(
          { kind: 'absent' },
        )
        await expectCursor(readRepository, cursor2)
      })

      it('SP-M02 removes Mailboxes omitted from a replacement snapshot', async () => {
        const { accountA } = createTestFixtures()
        const mailbox1 = createTestMailbox(accountA, 'M1')
        const mailbox2 = createTestMailbox(accountA, 'M2')
        const mailbox3 = createTestMailbox(accountA, 'M3')
        const cursor1 = createTestCollectionSyncCursor(
          accountA,
          'mailbox',
          'mailbox-state-1',
        )
        const cursor2 = createTestCollectionSyncCursor(
          accountA,
          'mailbox',
          'mailbox-state-2',
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceMailboxes(syncPort, { kind: 'absent' }, cursor1, [
          mailbox1,
          mailbox2,
          mailbox3,
        ])

        await replaceMailboxes(
          syncPort,
          { kind: 'matches', cursor: cursor1 },
          cursor2,
          [mailbox1, mailbox3],
        )

        const snapshot = unwrapOk(
          await readRepository.listMailboxes(accountA.key),
        )
        expect(snapshot.kind).toBe('present')
        if (snapshot.kind === 'present') {
          expectUnorderedExact(snapshot.value, [mailbox1, mailbox3])
        }
        expect(unwrapOk(await readRepository.readMailbox(mailbox2.id))).toEqual(
          { kind: 'absent' },
        )
        await expectCursor(readRepository, cursor2)
      })
    })

    describe('Identity collection', () => {
      it('SP-I01 applies Identity delta create, update, and destroy semantics', async () => {
        const { accountA } = createTestFixtures()
        const identity1 = createTestIdentity(accountA, 'I1')
        const identity2 = createTestIdentity(accountA, 'I2')
        const identity3 = createTestIdentity(accountA, 'I3')
        const updatedIdentity1 = identity({
          id: identity1.id,
          name: 'Updated Identity I1',
          email: identity1.email,
          replyTo: identity1.replyTo,
          bcc: identity1.bcc,
        })
        const cursor1 = createTestCollectionSyncCursor(
          accountA,
          'identity',
          'identity-state-1',
        )
        const cursor2 = createTestCollectionSyncCursor(
          accountA,
          'identity',
          'identity-state-2',
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceIdentities(syncPort, { kind: 'absent' }, cursor1, [
          identity1,
          identity2,
        ])

        await expectWriteOk(
          syncPort.applyCollectionSync({
            kind: 'identity',
            mode: 'delta',
            expectedCursor: { kind: 'matches', cursor: cursor1 },
            nextCursor: cursor2,
            changed: [updatedIdentity1, identity3],
            destroyed: [identity2.id],
          }),
        )

        const snapshot = unwrapOk(
          await readRepository.listIdentities(accountA.key),
        )
        expect(snapshot.kind).toBe('present')
        if (snapshot.kind === 'present') {
          expectUnorderedExact(snapshot.value, [updatedIdentity1, identity3])
        }
        expect(
          unwrapOk(await readRepository.readIdentity(identity2.id)),
        ).toEqual({ kind: 'absent' })
        await expectCursor(readRepository, cursor2)
      })

      it('SP-I02 removes Identities omitted from a replacement snapshot', async () => {
        const { accountA } = createTestFixtures()
        const identity1 = createTestIdentity(accountA, 'I1')
        const identity2 = createTestIdentity(accountA, 'I2')
        const cursor1 = createTestCollectionSyncCursor(
          accountA,
          'identity',
          'identity-state-1',
        )
        const cursor2 = createTestCollectionSyncCursor(
          accountA,
          'identity',
          'identity-state-2',
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceIdentities(syncPort, { kind: 'absent' }, cursor1, [
          identity1,
          identity2,
        ])

        await replaceIdentities(
          syncPort,
          { kind: 'matches', cursor: cursor1 },
          cursor2,
          [identity2],
        )

        expect(
          unwrapOk(await readRepository.readIdentity(identity1.id)),
        ).toEqual({ kind: 'absent' })
        expect(
          unwrapOk(await readRepository.readIdentity(identity2.id)),
        ).toEqual({ kind: 'present', value: identity2 })
        await expectCursor(readRepository, cursor2)
      })
    })

    describe('EmailBody cache', () => {
      it('SP-B01 requires an Email owner before caching a body', async () => {
        const { accountA, emailA1, standardBodyA1 } = createTestFixtures()
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])

        await expectWriteConflict(syncPort.cacheEmailBody(standardBodyA1))

        expect(
          unwrapOk(await readRepository.readEmailBody(emailA1.id)),
        ).toEqual({ kind: 'ownerAbsent' })
      })

      it('SP-B02 caches a complete EmailBody for a materialized Email', async () => {
        const { accountA, emailA1, standardBodyA1 } = createTestFixtures()
        const cursor = createTestCollectionSyncCursor(
          accountA,
          'email',
          'email-state-1',
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceEmails(syncPort, { kind: 'absent' }, cursor, [
          emailRecord(emailA1),
        ])

        await expectWriteOk(syncPort.cacheEmailBody(standardBodyA1))

        expect(
          unwrapOk(await readRepository.readEmailBody(emailA1.id)),
        ).toEqual({ kind: 'cached', value: standardBodyA1 })
      })

      it('SP-B03 replaces the complete cached EmailBody snapshot', async () => {
        const { accountA, emailA1, standardBodyA1 } = createTestFixtures()
        const replacement = createTestEmailBody(emailA1, 'replacement', null)
        const cursor = createTestCollectionSyncCursor(
          accountA,
          'email',
          'email-state-1',
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceEmails(syncPort, { kind: 'absent' }, cursor, [
          emailRecord(emailA1),
        ])
        await expectWriteOk(syncPort.cacheEmailBody(standardBodyA1))

        await expectWriteOk(syncPort.cacheEmailBody(replacement))

        expect(
          unwrapOk(await readRepository.readEmailBody(emailA1.id)),
        ).toEqual({ kind: 'cached', value: replacement })
      })
    })

    describe('AttachmentRef cache', () => {
      it('SP-AR01 requires an Email owner before caching attachment refs', async () => {
        const { accountA, emailA1, attachmentsA1 } = createTestFixtures()
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])

        await expectWriteConflict(
          syncPort.replaceAttachmentRefs(emailA1.id, attachmentsA1),
        )

        expect(
          unwrapOk(await readRepository.readAttachmentRefs(emailA1.id)),
        ).toEqual({ kind: 'ownerAbsent' })
      })

      it('SP-AR02 materializes an empty attachment cache snapshot', async () => {
        const { accountA, emailA1 } = createTestFixtures()
        const cursor = createTestCollectionSyncCursor(
          accountA,
          'email',
          'email-state-1',
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceEmails(syncPort, { kind: 'absent' }, cursor, [
          emailRecord(emailA1),
        ])
        expect(
          unwrapOk(await readRepository.readAttachmentRefs(emailA1.id)),
        ).toEqual({ kind: 'notCached' })

        await expectWriteOk(syncPort.replaceAttachmentRefs(emailA1.id, []))

        expect(
          unwrapOk(await readRepository.readAttachmentRefs(emailA1.id)),
        ).toEqual({ kind: 'cached', value: [] })
      })

      it('SP-AR03 replaces the complete attachment cache snapshot', async () => {
        const { accountA, emailA1, attachmentsA1 } = createTestFixtures()
        const [, secondAttachment] = attachmentsA1
        const cursor = createTestCollectionSyncCursor(
          accountA,
          'email',
          'email-state-1',
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceEmails(syncPort, { kind: 'absent' }, cursor, [
          emailRecord(emailA1),
        ])
        await expectWriteOk(
          syncPort.replaceAttachmentRefs(emailA1.id, attachmentsA1),
        )

        await expectWriteOk(
          syncPort.replaceAttachmentRefs(emailA1.id, [secondAttachment]),
        )

        expect(
          unwrapOk(await readRepository.readAttachmentRefs(emailA1.id)),
        ).toEqual({ kind: 'cached', value: [secondAttachment] })
      })

      it('SP-AR04 rejects a ref owned by another Email and preserves the cache', async () => {
        const { accountA, emailA1, emailA2, attachmentsA1 } =
          createTestFixtures()
        const [firstAttachment] = attachmentsA1
        const attachmentA2 = createTestAttachmentRef(emailA2, 'part-E2')
        const cursor = createTestCollectionSyncCursor(
          accountA,
          'email',
          'email-state-1',
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceEmails(syncPort, { kind: 'absent' }, cursor, [
          emailRecord(emailA1),
          emailRecord(emailA2),
        ])
        await expectWriteOk(
          syncPort.replaceAttachmentRefs(emailA1.id, [firstAttachment]),
        )

        await expectWriteConflict(
          syncPort.replaceAttachmentRefs(emailA1.id, [attachmentA2]),
        )

        expect(
          unwrapOk(await readRepository.readAttachmentRefs(emailA1.id)),
        ).toEqual({ kind: 'cached', value: [firstAttachment] })
      })

      it('SP-AR05 rejects duplicate attachment identities without materializing cache', async () => {
        const { accountA, emailA1, attachmentsA1 } = createTestFixtures()
        const [firstAttachment] = attachmentsA1
        const cursor = createTestCollectionSyncCursor(
          accountA,
          'email',
          'email-state-1',
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceEmails(syncPort, { kind: 'absent' }, cursor, [
          emailRecord(emailA1),
        ])

        await expectWriteConflict(
          syncPort.replaceAttachmentRefs(emailA1.id, [
            firstAttachment,
            firstAttachment,
          ]),
        )

        expect(
          unwrapOk(await readRepository.readAttachmentRefs(emailA1.id)),
        ).toEqual({ kind: 'notCached' })
      })
    })

    describe('MailboxView cache', () => {
      it('SP-V01 requires a Mailbox owner before caching a view', async () => {
        const { accountA, emptyInboxViewA } = createTestFixtures()
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])

        await expectWriteConflict(syncPort.replaceMailboxView(emptyInboxViewA))

        expect(
          unwrapOk(await readRepository.readMailboxView(emptyInboxViewA.spec)),
        ).toEqual({ kind: 'ownerAbsent' })
      })

      it('SP-V02 caches a MailboxView for a materialized Mailbox', async () => {
        const { accountA, inboxA, emptyInboxViewA } = createTestFixtures()
        const cursor = createTestCollectionSyncCursor(
          accountA,
          'mailbox',
          'mailbox-state-1',
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceMailboxes(syncPort, { kind: 'absent' }, cursor, [inboxA])

        await expectWriteOk(syncPort.replaceMailboxView(emptyInboxViewA))

        expect(
          unwrapOk(await readRepository.readMailboxView(emptyInboxViewA.spec)),
        ).toEqual({ kind: 'cached', value: emptyInboxViewA })
      })

      it('SP-V03 replaces the complete snapshot for the same semantic ViewSpec', async () => {
        const { accountA, inboxA, emailA2, partialInboxViewA } =
          createTestFixtures()
        const replacement = createTestMailboxView({
          spec: partialInboxViewA.spec,
          queryState: 'view-state-replacement',
          total: 10,
          coverage: [{ start: 0, endExclusive: 1 }],
          items: [{ position: 0, email: emailA2 }],
        })
        const cursor = createTestCollectionSyncCursor(
          accountA,
          'mailbox',
          'mailbox-state-1',
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceMailboxes(syncPort, { kind: 'absent' }, cursor, [inboxA])
        await expectWriteOk(syncPort.replaceMailboxView(partialInboxViewA))

        await expectWriteOk(syncPort.replaceMailboxView(replacement))

        expect(
          unwrapOk(
            await readRepository.readMailboxView(partialInboxViewA.spec),
          ),
        ).toEqual({ kind: 'cached', value: replacement })
      })

      it('SP-V04 treats queryState as opaque rather than monotonic', async () => {
        const { accountA, inboxA, emptyInboxViewA } = createTestFixtures()
        const lexicographicallyLater = createTestMailboxView({
          spec: emptyInboxViewA.spec,
          queryState: 'z-state',
          total: 0,
          coverage: [],
          items: [],
        })
        const lexicographicallyEarlier = createTestMailboxView({
          spec: emptyInboxViewA.spec,
          queryState: 'a-state',
          total: 0,
          coverage: [],
          items: [],
        })
        const cursor = createTestCollectionSyncCursor(
          accountA,
          'mailbox',
          'mailbox-state-1',
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceMailboxes(syncPort, { kind: 'absent' }, cursor, [inboxA])
        await expectWriteOk(syncPort.replaceMailboxView(lexicographicallyLater))

        await expectWriteOk(
          syncPort.replaceMailboxView(lexicographicallyEarlier),
        )

        expect(
          unwrapOk(await readRepository.readMailboxView(emptyInboxViewA.spec)),
        ).toEqual({ kind: 'cached', value: lexicographicallyEarlier })
      })
    })

    describe('Input snapshot safety', () => {
      it('SP-SNAP01 snapshots changed Email records before returning success', async () => {
        const { accountA, emailA1, emailA2 } = createTestFixtures()
        const initialCursor = createTestCollectionSyncCursor(
          accountA,
          'email',
          'email-state-1',
        )
        const nextCursor = createTestCollectionSyncCursor(
          accountA,
          'email',
          'email-state-2',
        )
        const changed = [emailRecord(emailA1)]
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceEmails(syncPort, { kind: 'absent' }, initialCursor, [])

        await expectWriteOk(
          syncPort.applyCollectionSync({
            kind: 'email',
            mode: 'delta',
            expectedCursor: { kind: 'matches', cursor: initialCursor },
            nextCursor,
            changed,
            destroyed: [],
          }),
        )
        changed.splice(0, changed.length, emailRecord(emailA2))

        await expectEmailPresent(readRepository, emailA1)
        await expectEmailAbsent(readRepository, emailA2)
        await expectCursor(readRepository, nextCursor)
      })

      it('SP-SNAP02 snapshots nested Email memberships before returning success', async () => {
        const { accountA, emailA1, inboxA, archiveA } = createTestFixtures()
        const initialMembership = createTestEmailMailbox(emailA1, inboxA)
        const replacementMembership = createTestEmailMailbox(emailA1, archiveA)
        const memberships = [initialMembership]
        const cursor = createTestCollectionSyncCursor(
          accountA,
          'email',
          'email-state-1',
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])

        await replaceEmails(syncPort, { kind: 'absent' }, cursor, [
          emailRecord(emailA1, memberships),
        ])
        memberships.splice(0, memberships.length, replacementMembership)

        expect(
          unwrapOk(await readRepository.readEmailMemberships(emailA1.id)),
        ).toEqual({ kind: 'present', value: [initialMembership] })
      })

      it('SP-SNAP03 snapshots AttachmentRef arrays before returning success', async () => {
        const { accountA, emailA1, attachmentsA1 } = createTestFixtures()
        const refs = [...attachmentsA1]
        const cursor = createTestCollectionSyncCursor(
          accountA,
          'email',
          'email-state-1',
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceEmails(syncPort, { kind: 'absent' }, cursor, [
          emailRecord(emailA1),
        ])

        await expectWriteOk(syncPort.replaceAttachmentRefs(emailA1.id, refs))
        refs.splice(0, refs.length)

        const cached = unwrapOk(
          await readRepository.readAttachmentRefs(emailA1.id),
        )
        expect(cached.kind).toBe('cached')
        if (cached.kind === 'cached') {
          expectUnorderedExact(cached.value, attachmentsA1)
        }
      })
    })
  })
}
