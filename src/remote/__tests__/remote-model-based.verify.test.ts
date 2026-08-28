import { describe, expect, it } from 'vitest'
import { createMemoryLocalEngine } from '../../adapters/memory'
import type { AccountKey } from '../../domain/ids'
import type { CollectionSyncCursor } from '../../domain/sync-cursor'
import type { ReadRepository } from '../../ports/read-repository'
import { Coordinator } from '../../sync/coordinator'
import { unwrapOk } from '../../tests/contracts/assertions'
import { createTestAccount } from '../../tests/contracts/fixtures'
import { localEmailId } from '../compat/domain-ids'
import type { RemoteCollectionSync } from '../mail'
import { FakeRemoteMail } from '../testing'
import type {
  RemoteEmail,
  RemoteEmailId,
  RemoteIdentity,
  RemoteMailbox,
} from '../types'
import {
  remoteAccountIdFromString,
  remoteBlobIdFromString,
  remoteEmailIdFromString,
  remoteIdentityIdFromString,
  remoteMailboxIdFromString,
  remoteSyncStateFromString,
  remoteThreadIdFromString,
} from '../types'

const SEED = 0xb0c0ffee
const SCENARIOS = 75

type ModelEmail = {
  id: string
  subject: string
  preview: string
  keywords: Set<string>
  mailboxIds: Set<string>
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0
    return state / 0x1_0000_0000
  }
}

function pick<T>(values: readonly T[], random: () => number): T {
  const value = values[Math.floor(random() * values.length)]
  if (value === undefined) throw new Error('Cannot pick from an empty list')
  return value
}

function modelEmail(
  scenario: number,
  ordinal: number,
  mailboxIds: readonly string[],
  random: () => number,
): ModelEmail {
  const keywords = new Set<string>()
  if (random() < 0.5) keywords.add('$seen')
  if (random() < 0.3) keywords.add('$flagged')
  if (random() < 0.25) keywords.add(`custom/${scenario}:${ordinal}-initial`)
  return {
    id: `uid|${scenario}|${ordinal}`,
    subject: `Subject ${scenario}/${ordinal}`,
    preview: `Preview ${scenario}/${ordinal}`,
    keywords,
    mailboxIds: new Set(mailboxIds),
  }
}

function toRemoteEmail(value: ModelEmail, scenario: number): RemoteEmail {
  const suffix = value.id.split('|').at(-1) ?? '0'
  return {
    id: remoteEmailIdFromString(value.id),
    blobId: remoteBlobIdFromString(`blob/${scenario}/${suffix}`),
    threadId: remoteThreadIdFromString(`thread:${scenario}:${suffix}`),
    sender: null,
    from: [{ name: null, email: `sender-${suffix}@example.test` }],
    replyTo: null,
    to: [],
    cc: null,
    bcc: [],
    subject: value.subject,
    sentAt: null,
    receivedAt: `2026-04-${String((Number(suffix) % 28) + 1).padStart(2, '0')}T00:00:00Z`,
    size: Number(suffix) + 100,
    preview: value.preview,
    hasAttachment: false,
    keywords: new Set(value.keywords),
    mailboxIds: [...value.mailboxIds].map(remoteMailboxIdFromString),
  }
}

function stateFor(scenario: number, step: number): string {
  if (step < 0) return `initial:${scenario}`
  switch (step % 3) {
    case 0:
      return ''
    case 1:
      return `{"uv":${scenario},"step":${step}}`
    case 2:
      return `state:${scenario}:${step}`
  }
  throw new Error('Unreachable state selector')
}

async function readCursor(
  repository: ReadRepository,
  accountKey: AccountKey,
): Promise<CollectionSyncCursor> {
  const read = unwrapOk(
    await repository.readCollectionSyncCursor(accountKey, 'email'),
  )
  if (read.kind !== 'present') throw new Error('Expected Email cursor')
  return read.value
}

async function assertMatchesModel(
  repository: ReadRepository,
  accountKey: AccountKey,
  model: ReadonlyMap<string, ModelEmail>,
  universe: ReadonlySet<string>,
  expectedState: string,
): Promise<void> {
  let actualCardinality = 0
  for (const id of [...universe].sort()) {
    const read = unwrapOk(
      await repository.readEmail(
        localEmailId(accountKey, remoteEmailIdFromString(id)),
      ),
    )
    const expected = model.get(id)
    if (expected === undefined) {
      expect(read.kind).toBe('absent')
      continue
    }
    expect(read.kind).toBe('present')
    if (read.kind !== 'present') continue
    actualCardinality += 1
    expect({
      id: read.value.id.jmapId,
      subject: read.value.subject,
      preview: read.value.preview,
      keywords: [...read.value.keywords].sort(),
    }).toEqual({
      id: expected.id,
      subject: expected.subject,
      preview: expected.preview,
      keywords: [...expected.keywords].sort(),
    })

    const memberships = unwrapOk(
      await repository.readEmailMemberships(read.value.id),
    )
    expect(memberships.kind).toBe('present')
    if (memberships.kind === 'present') {
      expect(
        memberships.value.map((value) => value.mailboxId.jmapId).sort(),
      ).toEqual([...expected.mailboxIds].sort())
    }
  }
  expect(actualCardinality).toBe(model.size)
  expect((await readCursor(repository, accountKey)).state).toBe(expectedState)
}

function cloneModelEmail(value: ModelEmail): ModelEmail {
  return {
    id: value.id,
    subject: value.subject,
    preview: value.preview,
    keywords: new Set(value.keywords),
    mailboxIds: new Set(value.mailboxIds),
  }
}

describe('TEST-DEBT-RB-02 — deterministic model-based replace and delta', () => {
  it('HARD-RB02-01..07: 75 scenarios match an independent model after every transition', async () => {
    const random = seededRandom(SEED)
    let totalDeltaSteps = 0

    for (let scenario = 0; scenario < SCENARIOS; scenario += 1) {
      const engine = createMemoryLocalEngine()
      let step = -1
      let transitionName = 'initial replace'
      try {
        const account = createTestAccount(`model-${scenario}`)
        unwrapOk(await engine.syncPort.registerAccount(account))

        const generatedMailboxCount = 1 + Math.floor(random() * 5)
        const mailboxCount =
          scenario === 1
            ? Math.max(2, generatedMailboxCount)
            : generatedMailboxCount
        const mailboxIds = Array.from(
          { length: mailboxCount },
          (_, index) => `folder|${scenario}|${index}`,
        )
        const mailboxes: RemoteMailbox[] = mailboxIds.map((id, index) => ({
          id: remoteMailboxIdFromString(id),
          name: `Folder ${scenario}/${index}`,
          parent: null,
          role: index === 0 ? 'inbox' : null,
          sortOrder: index,
          totalEmails: 0,
          unreadEmails: 0,
          rights: {
            mayReadItems: true,
            mayAddItems: true,
            mayRemoveItems: true,
            maySetSeen: true,
            maySetKeywords: true,
            maySubmit: true,
          },
        }))
        const identities: RemoteIdentity[] = [
          {
            id: remoteIdentityIdFromString(`identity|${scenario}`),
            name: `Identity ${scenario}`,
            email: `identity-${scenario}@example.test`,
            replyTo: null,
            bcc: null,
          },
        ]

        const generatedInitialCount = Math.floor(random() * 31)
        const initialCount =
          scenario === 0
            ? 0
            : scenario <= 2
              ? Math.max(1, generatedInitialCount)
              : generatedInitialCount
        const model = new Map<string, ModelEmail>()
        const universe = new Set<string>()
        for (let ordinal = 0; ordinal < initialCount; ordinal += 1) {
          const first = Math.floor(random() * mailboxCount)
          const memberships = [mailboxIds[first]]
          if (
            mailboxCount > 1 &&
            ((scenario === 1 && ordinal === 0) || random() < 0.35)
          ) {
            const second =
              (first + 1 + Math.floor(random() * (mailboxCount - 1))) %
              mailboxCount
            memberships.push(mailboxIds[second])
          }
          const value = modelEmail(scenario, ordinal, memberships, random)
          model.set(value.id, value)
          universe.add(value.id)
        }

        let emailTransition: RemoteCollectionSync<RemoteEmail, RemoteEmailId> =
          {
            mode: 'replace',
            state: remoteSyncStateFromString(stateFor(scenario, -1)),
            snapshot: [...model.values()].map((value) =>
              toRemoteEmail(value, scenario),
            ),
          }
        const remote = new FakeRemoteMail({
          syncIdentities: async () => ({
            mode: 'replace',
            state: remoteSyncStateFromString(`identity:${scenario}`),
            snapshot: identities,
          }),
          syncMailboxes: async () => ({
            mode: 'replace',
            state: remoteSyncStateFromString(`mailbox:${scenario}`),
            snapshot: mailboxes,
          }),
          syncEmails: async () => emailTransition,
        })
        const coordinator = new Coordinator(
          remote,
          engine.syncPort,
          engine.readRepository,
        )
        await coordinator.syncIdentities(
          account.key,
          remoteAccountIdFromString(`account|${scenario}`),
        )
        await coordinator.syncMailboxes(
          account.key,
          remoteAccountIdFromString(`account|${scenario}`),
        )
        await coordinator.syncEmails(
          account.key,
          remoteAccountIdFromString(`account|${scenario}`),
        )
        await assertMatchesModel(
          engine.readRepository,
          account.key,
          model,
          universe,
          stateFor(scenario, -1),
        )

        const deltaCount = 5 + Math.floor(random() * 11)
        let nextOrdinal = initialCount
        let consecutiveId: string | null = null
        for (step = 0; step < deltaCount; step += 1) {
          totalDeltaSteps += 1
          const currentIds = [...model.keys()]
          let operation = Math.floor(random() * 8)
          if (scenario === 0 && step === 0) operation = 0
          if (scenario === 0 && step === 1) operation = 7
          if (scenario === 1 && step === 0) operation = 6
          if (scenario === 2 && (step === 0 || step === 1)) operation = 1
          if (currentIds.length === 0) operation = 0

          let changed: RemoteEmail[] = []
          let destroyed: RemoteEmailId[] = []
          if (operation === 0) {
            transitionName = 'add email'
            const first = Math.floor(random() * mailboxCount)
            const memberships = [mailboxIds[first]]
            if (mailboxCount > 1 && random() < 0.5) {
              memberships.push(mailboxIds[(first + 1) % mailboxCount])
            }
            const value = modelEmail(scenario, nextOrdinal, memberships, random)
            nextOrdinal += 1
            model.set(value.id, value)
            universe.add(value.id)
            changed = [toRemoteEmail(value, scenario)]
            consecutiveId = value.id
          } else {
            const selectedId: string =
              scenario === 1 && step === 0
                ? `uid|${scenario}|0`
                : scenario === 2 && step === 1 && consecutiveId !== null
                  ? consecutiveId
                  : pick(currentIds, random)
            const current = model.get(selectedId)
            if (current === undefined)
              throw new Error('Selected Email missing from model')
            const next = cloneModelEmail(current)
            consecutiveId = selectedId

            switch (operation) {
              case 1:
                transitionName = 'update subject'
                next.subject = `${current.subject} -> ${step}`
                break
              case 2:
                transitionName = 'update preview'
                next.preview = `${current.preview} -> ${step}`
                break
              case 3:
                transitionName = 'add keyword'
                next.keywords.add(`custom/${scenario}:${step}-delta`)
                break
              case 4: {
                transitionName = 'remove keyword'
                const existing = [...next.keywords]
                if (existing.length === 0) next.keywords.add('$seen')
                else next.keywords.delete(pick(existing, random))
                break
              }
              case 5: {
                transitionName = 'add mailbox membership'
                const available = mailboxIds.filter(
                  (id) => !next.mailboxIds.has(id),
                )
                if (available.length === 0)
                  next.preview = `${next.preview} -> membership-noop-${step}`
                else next.mailboxIds.add(pick(available, random))
                break
              }
              case 6: {
                transitionName = 'remove mailbox membership'
                if (next.mailboxIds.size > 1) {
                  next.mailboxIds.delete(pick([...next.mailboxIds], random))
                } else if (mailboxCount > 1) {
                  next.mailboxIds.add(
                    pick(
                      mailboxIds.filter((id) => !next.mailboxIds.has(id)),
                      random,
                    ),
                  )
                } else {
                  next.subject = `${next.subject} -> membership-preserved-${step}`
                }
                break
              }
              case 7:
                transitionName = 'destroy email'
                model.delete(selectedId)
                destroyed = [remoteEmailIdFromString(selectedId)]
                break
            }

            if (operation !== 7) {
              model.set(selectedId, next)
              changed = [toRemoteEmail(next, scenario)]
            }
          }

          const nextState = stateFor(scenario, step)
          emailTransition = {
            mode: 'delta',
            state: remoteSyncStateFromString(nextState),
            changed,
            destroyed,
          }
          await coordinator.syncEmails(
            account.key,
            remoteAccountIdFromString(`account|${scenario}`),
          )
          await assertMatchesModel(
            engine.readRepository,
            account.key,
            model,
            universe,
            nextState,
          )
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(
          `seed=${SEED}; scenario=${scenario}; step=${step}; transition=${transitionName}: ${message}`,
          { cause: error },
        )
      } finally {
        await engine.dispose()
      }
    }

    expect(totalDeltaSteps).toBe(768)
  })
})
