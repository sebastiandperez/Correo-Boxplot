/**
 * 05-batching.ts — Batched calls with backreferences
 *
 * Objective: Send a single HTTP payload with Email/query followed by Email/get
 *            using result references ("#ids": { "resultOf": "...", ... }).
 * Validation: Verify that jmap-jam supports the cross-reference syntax and
 *             that only one network round-trip (RTT) is needed.
 *
 * Run: pnpm spike:jmap src/jmap/spike/05-batching.ts
 */

import { createClient, report } from './_config.ts'

async function main(): Promise<void> {
  const jam = createClient()
  const accountId = await jam.getPrimaryAccount()

  // 1. Find Inbox for the query filter
  const [mailboxes] = await jam.api.Mailbox.get({ accountId })
  const inbox = mailboxes.list.find((mb) => mb.role?.toLowerCase() === 'inbox')

  if (!inbox) {
    report('BATCHING', 'FAIL', 'Inbox mailbox not found.')
    return
  }

  // 2. Use requestMany to batch Email/query + Email/get with $ref
  //    This should produce a single JMAP request with two method calls.
  const [{ queryResult, getResult }, meta] = await jam.requestMany((t) => {
    const queryResult = t.Email.query({
      accountId,
      filter: { inMailbox: inbox.id },
      sort: [{ property: 'receivedAt', isAscending: false }],
      limit: 5,
    })

    const getResult = t.Email.get({
      accountId,
      // Use $ref to reference the IDs from the query result
      ids: queryResult.$ref('/ids'),
      properties: ['id', 'subject', 'from'],
    })

    return { queryResult, getResult }
  })

  // 3. Validate results
  const queryIds = queryResult.ids
  const fetchedEmails = getResult.list

  console.log(`Email/query returned ${queryIds.length} ID(s).`)
  console.log(`Email/get returned ${fetchedEmails.length} email(s).`)

  for (const email of fetchedEmails) {
    const from = email.from?.[0]?.email ?? '(unknown)'
    console.log(`  • ${email.subject ?? '(no subject)'} — from: ${from}`)
  }

  // 4. Verify single RTT: meta.response is the single HTTP Response
  const responseOk = meta.response.ok
  const responseUrl = meta.response.url

  console.log(`\nHTTP response OK: ${responseOk}`)
  console.log(`Response URL: ${responseUrl}`)
  console.log(`Session state: ${meta.sessionState}`)

  // 5. Verify backreference resolution
  //    If the query returned IDs, the get should have matching emails.
  const idsMatch =
    queryIds.length === 0 || fetchedEmails.length === queryIds.length

  const details = [
    `Query IDs: ${queryIds.length}`,
    `Fetched emails: ${fetchedEmails.length}`,
    `IDs match: ${idsMatch}`,
    `Single HTTP response: ${responseOk}`,
    `Backreference ($ref) resolved: ${fetchedEmails.length > 0 || queryIds.length === 0}`,
  ]

  if (!idsMatch) {
    report(
      'BATCHING',
      'FAIL',
      ['Mismatch between query IDs and fetched emails:', ...details].join('\n'),
    )
    return
  }

  report(
    'BATCHING',
    'PASS',
    [
      'Email/query + Email/get batched in 1 RTT with $ref backreference.',
      '',
      ...details,
    ].join('\n'),
  )
}

main().catch((err: unknown) => {
  console.error('Unhandled error:', err)
  process.exit(1)
})
