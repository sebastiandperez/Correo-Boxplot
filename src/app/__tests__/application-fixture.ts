import {
  createMemoryLocalEngine,
  type MemoryLocalEngine,
} from '../../adapters/memory'
import { createTestFixtures } from '../../tests/contracts/fixtures'

export async function createSeededMemoryApplication(): Promise<{
  engine: MemoryLocalEngine
  fixtures: ReturnType<typeof createTestFixtures>
}> {
  const engine = createMemoryLocalEngine()
  const fixtures = createTestFixtures()

  await engine.syncPort.registerAccount(fixtures.accountA)
  await engine.syncPort.applyCollectionSync({
    kind: 'mailbox',
    mode: 'replace',
    expectedCursor: { kind: 'absent' },
    nextCursor: fixtures.mailboxCursorA,
    snapshot: [fixtures.inboxA, fixtures.archiveA],
  })
  await engine.syncPort.applyCollectionSync({
    kind: 'identity',
    mode: 'replace',
    expectedCursor: { kind: 'absent' },
    nextCursor: fixtures.identityCursorA,
    snapshot: [fixtures.identityA],
  })
  await engine.syncPort.applyCollectionSync({
    kind: 'email',
    mode: 'replace',
    expectedCursor: { kind: 'absent' },
    nextCursor: fixtures.emailCursorA,
    snapshot: [
      { email: fixtures.emailA1, memberships: [fixtures.membershipsA[0]] },
      { email: fixtures.emailA2, memberships: [fixtures.membershipsA[1]] },
    ],
  })
  await engine.syncPort.replaceMailboxView(fixtures.partialInboxViewA)
  await engine.syncPort.cacheEmailBody(fixtures.standardBodyA1)

  return { engine, fixtures }
}
