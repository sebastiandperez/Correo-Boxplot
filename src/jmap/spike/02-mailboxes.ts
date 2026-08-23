/**
 * 02-mailboxes.ts — Mailbox retrieval
 *
 * Objective: Execute Mailbox/get.
 * Validation: Confirm that standard folders (Inbox, Sent, Trash, Drafts) are
 *             listed with their message counters.
 *
 * Run: pnpm spike:jmap src/jmap/spike/02-mailboxes.ts
 */

import { createClient, report } from './_config.ts'

const EXPECTED_ROLES = ['inbox', 'sent', 'trash', 'drafts'] as const

async function main(): Promise<void> {
  const jam = createClient()
  const accountId = await jam.getPrimaryAccount()

  // 1. Fetch all mailboxes
  const [mailboxes] = await jam.api.Mailbox.get({
    accountId,
  })

  const list = mailboxes.list
  console.log(`Found ${list.length} mailbox(es):\n`)

  // 2. Display mailbox tree
  for (const mb of list) {
    const indent = mb.parentId ? '  └─ ' : ''
    const role = mb.role ? ` [${mb.role}]` : ''
    console.log(
      `${indent}${mb.name}${role} — total: ${mb.totalEmails ?? '?'}, unread: ${mb.unreadEmails ?? '?'}`,
    )
  }

  // 3. Validate expected roles
  const foundRoles = new Set(
    list.map((mb) => mb.role?.toLowerCase()).filter(Boolean),
  )
  const missingRoles = EXPECTED_ROLES.filter((r) => !foundRoles.has(r))

  if (missingRoles.length > 0) {
    report(
      'MAILBOXES',
      'FAIL',
      `Missing standard roles: ${missingRoles.join(', ')}\nFound roles: ${[...foundRoles].join(', ')}`,
    )
    return
  }

  report(
    'MAILBOXES',
    'PASS',
    [
      `Total mailboxes: ${list.length}`,
      `Standard roles found: ${EXPECTED_ROLES.join(', ')}`,
      `All roles: ${[...foundRoles].join(', ')}`,
    ].join('\n'),
  )
}

main().catch((err: unknown) => {
  console.error('Unhandled error:', err)
  process.exit(1)
})
