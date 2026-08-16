import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { Account } from '../../domain/account'
import type { Email } from '../../domain/email'
import type { Identity } from '../../domain/identity'
import type { EmailMailbox, Mailbox } from '../../domain/mailbox'
import type { CollectionSyncCursor } from '../../domain/sync-cursor'
import type {
  EmailSyncRecord,
  SyncPort,
  WriteResult,
} from '../../ports/sync-port'
import { unwrapOk } from './assertions'
import {
  createTestCollectionSyncCursor,
  createTestEmail,
  createTestEmailBody,
  createTestEmailMailbox,
  createTestFixtures,
  createTestIdentity,
  createTestSendMutation,
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

async function registerAccounts(
  syncPort: SyncPort,
  accounts: readonly Account[],
): Promise<void> {
  for (const account of accounts) {
    await expectWriteOk(syncPort.registerAccount(account))
  }
}

async function replaceMailboxes(
  syncPort: SyncPort,
  owner: Account,
  snapshot: readonly Mailbox[],
  nextCursor: CollectionSyncCursor = createTestCollectionSyncCursor(
    owner,
    'mailbox',
    'mailbox-state-setup',
  ),
): Promise<void> {
  await expectWriteOk(
    syncPort.applyCollectionSync({
      kind: 'mailbox',
      mode: 'replace',
      expectedCursor: { kind: 'absent' },
      nextCursor,
      snapshot,
    }),
  )
}

async function replaceIdentities(
  syncPort: SyncPort,
  owner: Account,
  snapshot: readonly Identity[],
  nextCursor: CollectionSyncCursor = createTestCollectionSyncCursor(
    owner,
    'identity',
    'identity-state-setup',
  ),
): Promise<void> {
  await expectWriteOk(
    syncPort.applyCollectionSync({
      kind: 'identity',
      mode: 'replace',
      expectedCursor: { kind: 'absent' },
      nextCursor,
      snapshot,
    }),
  )
}

async function replaceEmails(
  syncPort: SyncPort,
  owner: Account,
  snapshot: readonly EmailSyncRecord[],
  nextCursor: CollectionSyncCursor = createTestCollectionSyncCursor(
    owner,
    'email',
    'email-state-setup',
  ),
): Promise<void> {
  await expectWriteOk(
    syncPort.applyCollectionSync({
      kind: 'email',
      mode: 'replace',
      expectedCursor: { kind: 'absent' },
      nextCursor,
      snapshot,
    }),
  )
}

function emailRecord(
  email: Email,
  memberships: readonly EmailMailbox[] = [],
): EmailSyncRecord {
  return { email, memberships }
}

export function defineReadRepositoryContract(
  harness: LocalEngineContractHarness,
): void {
  describe(`ReadRepository contract — ${harness.name}`, () => {
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
        throw new Error('ReadRepository contract runtime is not available')
      }

      return runtime
    }

    describe('Account', () => {
      it('RR-A01 returns an empty Account list from a fresh runtime', async () => {
        const { readRepository } = currentRuntime()

        expect(unwrapOk(await readRepository.listAccounts())).toEqual([])
      })

      it('RR-A02 reports local Account absence without a remote claim', async () => {
        const { accountA } = createTestFixtures()
        const { readRepository } = currentRuntime()

        expect(
          unwrapOk(await readRepository.readAccount(accountA.key)),
        ).toEqual({ kind: 'absent' })
      })

      it('RR-A03 reads an Account after public registration', async () => {
        const { accountA } = createTestFixtures()
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])

        expect(
          unwrapOk(await readRepository.readAccount(accountA.key)),
        ).toEqual({ kind: 'present', value: accountA })
      })

      it('RR-A04 lists and reads multiple Accounts without collisions', async () => {
        const { accountA, accountB } = createTestFixtures()
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA, accountB])

        expectUnorderedExact(unwrapOk(await readRepository.listAccounts()), [
          accountA,
          accountB,
        ])
        expect(
          unwrapOk(await readRepository.readAccount(accountA.key)),
        ).toEqual({ kind: 'present', value: accountA })
        expect(
          unwrapOk(await readRepository.readAccount(accountB.key)),
        ).toEqual({ kind: 'present', value: accountB })
      })
    })

    describe('MailboxView', () => {
      it('RR-V01 reports ownerAbsent when the View Mailbox is absent', async () => {
        const { inboxViewSpecA } = createTestFixtures()
        const { readRepository } = currentRuntime()

        expect(
          unwrapOk(await readRepository.readMailboxView(inboxViewSpecA)),
        ).toEqual({ kind: 'ownerAbsent' })
      })

      it('RR-V02 reports notCached for a materialized Mailbox without a View', async () => {
        const { accountA, inboxA, inboxViewSpecA } = createTestFixtures()
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceMailboxes(syncPort, accountA, [inboxA])

        expect(
          unwrapOk(await readRepository.readMailboxView(inboxViewSpecA)),
        ).toEqual({ kind: 'notCached' })
      })

      it('RR-V03 reads the cached View for its exact semantic spec', async () => {
        const { accountA, inboxA, emptyInboxViewA } = createTestFixtures()
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceMailboxes(syncPort, accountA, [inboxA])
        await expectWriteOk(syncPort.replaceMailboxView(emptyInboxViewA))

        expect(
          unwrapOk(await readRepository.readMailboxView(emptyInboxViewA.spec)),
        ).toEqual({ kind: 'cached', value: emptyInboxViewA })
      })

      it('RR-V04 treats an alternative semantic spec as a different View', async () => {
        const { accountA, inboxA, emptyInboxViewA, alternativeViewSpecA } =
          createTestFixtures()
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceMailboxes(syncPort, accountA, [inboxA])
        await expectWriteOk(syncPort.replaceMailboxView(emptyInboxViewA))

        expect(
          unwrapOk(await readRepository.readMailboxView(alternativeViewSpecA)),
        ).toEqual({ kind: 'notCached' })
      })

      it('RR-V05 preserves partial and disjoint coverage as exact View data', async () => {
        const { accountA, inboxA, partialInboxViewA, disjointInboxViewA } =
          createTestFixtures()
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceMailboxes(syncPort, accountA, [inboxA])
        await expectWriteOk(syncPort.replaceMailboxView(partialInboxViewA))

        expect(
          unwrapOk(
            await readRepository.readMailboxView(partialInboxViewA.spec),
          ),
        ).toEqual({ kind: 'cached', value: partialInboxViewA })

        await expectWriteOk(syncPort.replaceMailboxView(disjointInboxViewA))

        expect(
          unwrapOk(
            await readRepository.readMailboxView(disjointInboxViewA.spec),
          ),
        ).toEqual({ kind: 'cached', value: disjointInboxViewA })
      })
    })

    describe('CollectionSyncCursor', () => {
      it('RR-C01 reports ownerAbsent when the cursor Account is absent', async () => {
        const { accountA } = createTestFixtures()
        const { readRepository } = currentRuntime()

        expect(
          unwrapOk(
            await readRepository.readCollectionSyncCursor(
              accountA.key,
              'email',
            ),
          ),
        ).toEqual({ kind: 'ownerAbsent' })
      })

      it('RR-C02 reports an absent cursor for an existing unsynchronized Account', async () => {
        const { accountA } = createTestFixtures()
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])

        expect(
          unwrapOk(
            await readRepository.readCollectionSyncCursor(
              accountA.key,
              'email',
            ),
          ),
        ).toEqual({ kind: 'absent' })
      })

      it('RR-C03 reads the exact cursor produced by collection materialization', async () => {
        const { accountA, emailCursorA } = createTestFixtures()
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceEmails(syncPort, accountA, [], emailCursorA)

        expect(
          unwrapOk(
            await readRepository.readCollectionSyncCursor(
              accountA.key,
              'email',
            ),
          ),
        ).toEqual({ kind: 'present', value: emailCursorA })
      })

      it('RR-C04 preserves an empty opaque cursor state as present', async () => {
        const { accountA, emptyStateEmailCursorA } = createTestFixtures()
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceEmails(syncPort, accountA, [], emptyStateEmailCursorA)

        const result = unwrapOk(
          await readRepository.readCollectionSyncCursor(accountA.key, 'email'),
        )
        expect(result).toEqual({
          kind: 'present',
          value: emptyStateEmailCursorA,
        })
        if (result.kind === 'present') {
          expect(result.value.state).toBe('')
        }
      })
    })

    describe('PendingMutation', () => {
      it('RR-P01 reports ownerAbsent when the mutation Account is absent', async () => {
        const { accountA, sendMutationA } = createTestFixtures()
        const { readRepository } = currentRuntime()

        expect(
          unwrapOk(
            await readRepository.readPendingMutation(
              accountA.key,
              sendMutationA.mutationId,
            ),
          ),
        ).toEqual({ kind: 'ownerAbsent' })
      })

      it('RR-P02 reports an absent mutation under an existing Account', async () => {
        const { accountA, sendMutationA } = createTestFixtures()
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])

        expect(
          unwrapOk(
            await readRepository.readPendingMutation(
              accountA.key,
              sendMutationA.mutationId,
            ),
          ),
        ).toEqual({ kind: 'absent' })
      })

      it('RR-P03 reads an exact staged PendingMutation', async () => {
        const { accountA, sendMutationA } = createTestFixtures()
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await expectWriteOk(syncPort.stageSendMutation(sendMutationA))

        expect(
          unwrapOk(
            await readRepository.readPendingMutation(
              accountA.key,
              sendMutationA.mutationId,
            ),
          ),
        ).toEqual({ kind: 'present', value: sendMutationA })
      })

      it('RR-P04 returns a present empty mutation snapshot', async () => {
        const { accountA } = createTestFixtures()
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])

        expect(
          unwrapOk(await readRepository.listPendingMutations(accountA.key)),
        ).toEqual({ kind: 'present', value: [] })
      })

      it('RR-P05 lists multiple PendingMutations without ordering assumptions', async () => {
        const { accountA, identityA } = createTestFixtures()
        const firstMutation = createTestSendMutation(
          accountA,
          identityA,
          'snapshot-1',
        )
        const secondMutation = createTestSendMutation(
          accountA,
          identityA,
          'snapshot-2',
        )
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await expectWriteOk(syncPort.stageSendMutation(firstMutation))
        await expectWriteOk(syncPort.stageSendMutation(secondMutation))

        const snapshot = unwrapOk(
          await readRepository.listPendingMutations(accountA.key),
        )
        expect(snapshot.kind).toBe('present')
        if (snapshot.kind === 'present') {
          expectUnorderedExact(snapshot.value, [firstMutation, secondMutation])
        }
      })
    })

    describe('Identity', () => {
      it('RR-I01 reports ownerAbsent when the Identity Account is absent', async () => {
        const { accountA } = createTestFixtures()
        const { readRepository } = currentRuntime()

        expect(
          unwrapOk(await readRepository.listIdentities(accountA.key)),
        ).toEqual({ kind: 'ownerAbsent' })
      })

      it('RR-I02 returns a present empty Identity snapshot for an existing Account', async () => {
        const { accountA } = createTestFixtures()
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])

        expect(
          unwrapOk(await readRepository.listIdentities(accountA.key)),
        ).toEqual({ kind: 'present', value: [] })
      })

      it('RR-I03 distinguishes an absent Identity from a materialized Identity', async () => {
        const { accountA, identityA } = createTestFixtures()
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])

        expect(
          unwrapOk(await readRepository.readIdentity(identityA.id)),
        ).toEqual({ kind: 'absent' })

        await replaceIdentities(syncPort, accountA, [identityA])

        expect(
          unwrapOk(await readRepository.readIdentity(identityA.id)),
        ).toEqual({ kind: 'present', value: identityA })
      })

      it('RR-I04 preserves Identity Account scope for equal remote-like tokens', async () => {
        const { accountA, accountB } = createTestFixtures()
        const identityA = createTestIdentity(accountA, 'shared')
        const identityB = createTestIdentity(accountB, 'shared')
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA, accountB])
        await replaceIdentities(syncPort, accountA, [identityA])
        await replaceIdentities(syncPort, accountB, [identityB])

        expect(identityA.id.jmapId).toBe(identityB.id.jmapId)
        expect(
          unwrapOk(await readRepository.readIdentity(identityA.id)),
        ).toEqual({ kind: 'present', value: identityA })
        expect(
          unwrapOk(await readRepository.readIdentity(identityB.id)),
        ).toEqual({ kind: 'present', value: identityB })
      })
    })

    describe('Email', () => {
      it('RR-E01 distinguishes an absent Email from a materialized Email', async () => {
        const { accountA, emailA1 } = createTestFixtures()
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])

        expect(unwrapOk(await readRepository.readEmail(emailA1.id))).toEqual({
          kind: 'absent',
        })

        await replaceEmails(syncPort, accountA, [emailRecord(emailA1)])

        expect(unwrapOk(await readRepository.readEmail(emailA1.id))).toEqual({
          kind: 'present',
          value: emailA1,
        })
      })

      it('RR-E02 returns an empty positional result for empty bulk input', async () => {
        const { readRepository } = currentRuntime()

        expect(unwrapOk(await readRepository.readEmails([]))).toEqual([])
      })

      it('RR-E03 preserves mixed present and absent bulk positions', async () => {
        const { accountA, emailA1, emailA2 } = createTestFixtures()
        const emailA3 = createTestEmail(accountA, 'E3')
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceEmails(syncPort, accountA, [
          emailRecord(emailA1),
          emailRecord(emailA3),
        ])

        expect(
          unwrapOk(
            await readRepository.readEmails([
              emailA1.id,
              emailA2.id,
              emailA3.id,
            ]),
          ),
        ).toEqual([
          { kind: 'present', value: emailA1 },
          { kind: 'absent' },
          { kind: 'present', value: emailA3 },
        ])
      })

      it('RR-E04 preserves duplicate Email IDs as independent output positions', async () => {
        const { accountA, emailA1, emailA2 } = createTestFixtures()
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceEmails(syncPort, accountA, [
          emailRecord(emailA1),
          emailRecord(emailA2),
        ])

        expect(
          unwrapOk(
            await readRepository.readEmails([
              emailA1.id,
              emailA1.id,
              emailA2.id,
            ]),
          ),
        ).toEqual([
          { kind: 'present', value: emailA1 },
          { kind: 'present', value: emailA1 },
          { kind: 'present', value: emailA2 },
        ])
      })

      it('RR-E05 preserves bulk input length and every mixed index', async () => {
        const { accountA, emailA1, emailA2 } = createTestFixtures()
        const emailA3 = createTestEmail(accountA, 'E3')
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceEmails(syncPort, accountA, [
          emailRecord(emailA1),
          emailRecord(emailA3),
        ])
        const input = [emailA1.id, emailA2.id, emailA1.id, emailA3.id]

        const result = unwrapOk(await readRepository.readEmails(input))

        expect(result).toHaveLength(input.length)
        expect(result).toEqual([
          { kind: 'present', value: emailA1 },
          { kind: 'absent' },
          { kind: 'present', value: emailA1 },
          { kind: 'present', value: emailA3 },
        ])
      })

      it('RR-E06 isolates equal remote-like Email IDs across Accounts', async () => {
        const { accountA, accountB, emailA1, emailB1 } = createTestFixtures()
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA, accountB])
        await replaceEmails(syncPort, accountA, [emailRecord(emailA1)])
        await replaceEmails(syncPort, accountB, [emailRecord(emailB1)])

        expect(emailA1.id.jmapId).toBe(emailB1.id.jmapId)
        expect(unwrapOk(await readRepository.readEmail(emailA1.id))).toEqual({
          kind: 'present',
          value: emailA1,
        })
        expect(unwrapOk(await readRepository.readEmail(emailB1.id))).toEqual({
          kind: 'present',
          value: emailB1,
        })
      })
    })

    describe('EmailMailbox', () => {
      it('RR-EM01 reports ownerAbsent when the Email is absent', async () => {
        const { emailA1 } = createTestFixtures()
        const { readRepository } = currentRuntime()

        expect(
          unwrapOk(await readRepository.readEmailMemberships(emailA1.id)),
        ).toEqual({ kind: 'ownerAbsent' })
      })

      it('RR-EM02 preserves a present empty membership snapshot', async () => {
        const { accountA, emailA1 } = createTestFixtures()
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceEmails(syncPort, accountA, [emailRecord(emailA1)])

        expect(
          unwrapOk(await readRepository.readEmailMemberships(emailA1.id)),
        ).toEqual({ kind: 'present', value: [] })
      })

      it('RR-EM03 returns the exact membership snapshot without ordering assumptions', async () => {
        const { accountA, inboxA, archiveA, emailA1 } = createTestFixtures()
        const memberships = [
          createTestEmailMailbox(emailA1, inboxA),
          createTestEmailMailbox(emailA1, archiveA),
        ]
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceMailboxes(syncPort, accountA, [inboxA, archiveA])
        await replaceEmails(syncPort, accountA, [
          emailRecord(emailA1, memberships),
        ])

        const snapshot = unwrapOk(
          await readRepository.readEmailMemberships(emailA1.id),
        )
        expect(snapshot.kind).toBe('present')
        if (snapshot.kind === 'present') {
          expectUnorderedExact(snapshot.value, memberships)
        }
      })
    })

    describe('Mailbox', () => {
      it('RR-M01 reports ownerAbsent when the Account is absent', async () => {
        const { accountA } = createTestFixtures()
        const { readRepository } = currentRuntime()

        expect(
          unwrapOk(await readRepository.listMailboxes(accountA.key)),
        ).toEqual({ kind: 'ownerAbsent' })
      })

      it('RR-M02 returns a present empty Mailbox snapshot for an existing Account', async () => {
        const { accountA } = createTestFixtures()
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])

        expect(
          unwrapOk(await readRepository.listMailboxes(accountA.key)),
        ).toEqual({ kind: 'present', value: [] })
      })

      it('RR-M03 reports an unmaterialized Mailbox as absent', async () => {
        const { accountA, inboxA } = createTestFixtures()
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])

        expect(unwrapOk(await readRepository.readMailbox(inboxA.id))).toEqual({
          kind: 'absent',
        })
      })

      it('RR-M04 reads a materialized Mailbox collection without ordering assumptions', async () => {
        const { accountA, inboxA, archiveA } = createTestFixtures()
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceMailboxes(syncPort, accountA, [inboxA, archiveA])

        expect(unwrapOk(await readRepository.readMailbox(inboxA.id))).toEqual({
          kind: 'present',
          value: inboxA,
        })

        const snapshot = unwrapOk(
          await readRepository.listMailboxes(accountA.key),
        )
        expect(snapshot.kind).toBe('present')
        if (snapshot.kind === 'present') {
          expectUnorderedExact(snapshot.value, [inboxA, archiveA])
        }
      })
    })

    describe('EmailBody', () => {
      it('RR-B01 reports ownerAbsent when the Email is absent', async () => {
        const { emailA1 } = createTestFixtures()
        const { readRepository } = currentRuntime()

        expect(
          unwrapOk(await readRepository.readEmailBody(emailA1.id)),
        ).toEqual({ kind: 'ownerAbsent' })
      })

      it('RR-B02 reports notCached for a materialized Email without a body cache', async () => {
        const { accountA, emailA1 } = createTestFixtures()
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceEmails(syncPort, accountA, [emailRecord(emailA1)])

        expect(
          unwrapOk(await readRepository.readEmailBody(emailA1.id)),
        ).toEqual({ kind: 'notCached' })
      })

      it('RR-B03 preserves a cached null/null EmailBody as complete', async () => {
        const { accountA, emailA1, nullBodyA1 } = createTestFixtures()
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceEmails(syncPort, accountA, [emailRecord(emailA1)])
        await expectWriteOk(syncPort.cacheEmailBody(nullBodyA1))

        expect(
          unwrapOk(await readRepository.readEmailBody(emailA1.id)),
        ).toEqual({ kind: 'cached', value: nullBodyA1 })
      })

      it('RR-B04 preserves empty body representations without coalescing to null', async () => {
        const { accountA, emailA1, emptyBodyA1 } = createTestFixtures()
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceEmails(syncPort, accountA, [emailRecord(emailA1)])
        await expectWriteOk(syncPort.cacheEmailBody(emptyBodyA1))

        const result = unwrapOk(await readRepository.readEmailBody(emailA1.id))
        expect(result).toEqual({ kind: 'cached', value: emptyBodyA1 })
        if (result.kind === 'cached') {
          expect(result.value.text).toBe('')
          expect(result.value.html).toBe('')
          expect(result.value.text).not.toBeNull()
          expect(result.value.html).not.toBeNull()
        }
      })

      it('RR-B05 returns the latest complete body replacement', async () => {
        const { accountA, emailA1, standardBodyA1 } = createTestFixtures()
        const replacement = createTestEmailBody(emailA1, 'replacement', null)
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceEmails(syncPort, accountA, [emailRecord(emailA1)])
        await expectWriteOk(syncPort.cacheEmailBody(standardBodyA1))

        expect(
          unwrapOk(await readRepository.readEmailBody(emailA1.id)),
        ).toEqual({ kind: 'cached', value: standardBodyA1 })

        await expectWriteOk(syncPort.cacheEmailBody(replacement))

        expect(
          unwrapOk(await readRepository.readEmailBody(emailA1.id)),
        ).toEqual({ kind: 'cached', value: replacement })
      })
    })

    describe('AttachmentRef', () => {
      it('RR-AR01 reports ownerAbsent when the Email is absent', async () => {
        const { emailA1 } = createTestFixtures()
        const { readRepository } = currentRuntime()

        expect(
          unwrapOk(await readRepository.readAttachmentRefs(emailA1.id)),
        ).toEqual({ kind: 'ownerAbsent' })
      })

      it('RR-AR02 reports notCached before attachment metadata is materialized', async () => {
        const { accountA, emailA1 } = createTestFixtures()
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceEmails(syncPort, accountA, [emailRecord(emailA1)])

        expect(
          unwrapOk(await readRepository.readAttachmentRefs(emailA1.id)),
        ).toEqual({ kind: 'notCached' })
      })

      it('RR-AR03 distinguishes a cached empty attachment snapshot from notCached', async () => {
        const { accountA, emailA1 } = createTestFixtures()
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceEmails(syncPort, accountA, [emailRecord(emailA1)])
        await expectWriteOk(syncPort.replaceAttachmentRefs(emailA1.id, []))

        expect(
          unwrapOk(await readRepository.readAttachmentRefs(emailA1.id)),
        ).toEqual({ kind: 'cached', value: [] })
      })

      it('RR-AR04 returns a complete cached ref snapshot without ordering assumptions', async () => {
        const { accountA, emailA1, attachmentsA1 } = createTestFixtures()
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceEmails(syncPort, accountA, [emailRecord(emailA1)])
        await expectWriteOk(
          syncPort.replaceAttachmentRefs(emailA1.id, attachmentsA1),
        )

        const snapshot = unwrapOk(
          await readRepository.readAttachmentRefs(emailA1.id),
        )
        expect(snapshot.kind).toBe('cached')
        if (snapshot.kind === 'cached') {
          expectUnorderedExact(snapshot.value, attachmentsA1)
        }
      })

      it('RR-AR05 replaces the complete cached attachment snapshot', async () => {
        const { accountA, emailA1, attachmentsA1 } = createTestFixtures()
        const [, secondAttachment] = attachmentsA1
        const { readRepository, syncPort } = currentRuntime()
        await registerAccounts(syncPort, [accountA])
        await replaceEmails(syncPort, accountA, [emailRecord(emailA1)])
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
    })
  })
}
