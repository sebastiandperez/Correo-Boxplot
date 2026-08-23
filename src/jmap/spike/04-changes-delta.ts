/**
 * 04-changes-delta.ts — Delta synchronization (Vector JM-03)
 *
 * Objective: Save an initial state and execute Email/changes.
 * Validation: Verify the response contains discriminated lists (created,
 *             updated, destroyed), newState and hasMoreChanges flag.
 *
 * Run: pnpm spike:jmap src/jmap/spike/04-changes-delta.ts
 */

import { createClient, report } from './_config.ts'

async function main(): Promise<void> {
  const jam = createClient()
  const accountId = await jam.getPrimaryAccount()

  // 1. Get current state by fetching Email/get with no IDs
  //    This returns the current state token without any email data.
  const [initialGet] = await jam.api.Email.get({
    accountId,
    ids: [],
  })

  const currentState = initialGet.state
  console.log(`Current Email state: ${currentState}`)

  if (!currentState) {
    report('JM-03', 'FAIL', 'Could not obtain initial Email state.')
    return
  }

  // 2. Request Email/changes from the current state
  const [changes] = await jam.api.Email.changes({
    accountId,
    sinceState: currentState,
  })

  console.log('\nEmail/changes response:')
  console.log(JSON.stringify(changes, null, 2))

  // 3. Validate response structure
  const hasCreated = Array.isArray(changes.created)
  const hasUpdated = Array.isArray(changes.updated)
  const hasDestroyed = Array.isArray(changes.destroyed)
  const hasNewState = typeof changes.newState === 'string'
  const hasHasMoreChanges = typeof changes.hasMoreChanges === 'boolean'

  const structureValid =
    hasCreated && hasUpdated && hasDestroyed && hasNewState && hasHasMoreChanges

  const details = [
    `sinceState: ${currentState}`,
    `newState: ${changes.newState}`,
    `created: ${changes.created?.length ?? 'missing'} items (array: ${hasCreated})`,
    `updated: ${changes.updated?.length ?? 'missing'} items (array: ${hasUpdated})`,
    `destroyed: ${changes.destroyed?.length ?? 'missing'} items (array: ${hasDestroyed})`,
    `hasMoreChanges: ${changes.hasMoreChanges} (boolean: ${hasHasMoreChanges})`,
    `oldState === newState: ${currentState === changes.newState} (expected true for no-change delta)`,
  ]

  if (!structureValid) {
    report(
      'JM-03',
      'FAIL',
      ['Missing required fields in Email/changes response:', ...details].join(
        '\n',
      ),
    )
    return
  }

  // If requesting changes from current state, we expect empty arrays
  const isEmpty =
    changes.created!.length === 0 &&
    changes.updated!.length === 0 &&
    changes.destroyed!.length === 0

  report(
    'JM-03',
    'PASS',
    [
      isEmpty
        ? 'Empty delta (no changes since current state — expected)'
        : 'Delta contains changes (concurrent modification detected)',
      '',
      ...details,
    ].join('\n'),
  )
}

main().catch((err: unknown) => {
  console.error('Unhandled error:', err)
  process.exit(1)
})
