/**
 * 03-email-query-get.ts — Email reading and body retrieval (Vectors JM-02 + JM-04)
 *
 * Objective: Filter emails with Email/query and retrieve content with Email/get.
 * Validation: Evaluate how jmap-jam delivers bodyValues, htmlBody and textBody.
 *             Verify no truncated content and no raw unprocessed MIME trees.
 *
 * Run: pnpm spike:jmap src/jmap/spike/03-email-query-get.ts
 */

import { createClient, report } from './_config.ts'

async function main(): Promise<void> {
  const jam = createClient()
  const accountId = await jam.getPrimaryAccount()

  // 1. Find Inbox
  const [mailboxes] = await jam.api.Mailbox.get({ accountId })
  const inbox = mailboxes.list.find((mb) => mb.role?.toLowerCase() === 'inbox')

  if (!inbox) {
    report('JM-02/JM-04', 'FAIL', 'Inbox mailbox not found.')
    return
  }

  // 2. Query first 5 emails in Inbox
  const [queryResult] = await jam.api.Email.query({
    accountId,
    filter: { inMailbox: inbox.id },
    sort: [{ property: 'receivedAt', isAscending: false }],
    limit: 5,
  })

  const emailIds = queryResult.ids
  console.log(`Email/query returned ${emailIds.length} ID(s).`)

  if (emailIds.length === 0) {
    report(
      'JM-02/JM-04',
      'BLOCKED',
      'No emails in Inbox to test body retrieval. Send a test email first.',
    )
    return
  }

  // 3. Fetch full email content
  const [emailResult] = await jam.api.Email.get({
    accountId,
    ids: emailIds,
    properties: [
      'id',
      'subject',
      'from',
      'receivedAt',
      'bodyValues',
      'htmlBody',
      'textBody',
    ],
    fetchAllBodyValues: true,
  })

  const emails = emailResult.list
  console.log(`Email/get returned ${emails.length} email(s).\n`)

  let allBodiesValid = true
  const details: string[] = []

  for (const email of emails) {
    const subject = email.subject ?? '(no subject)'
    const from = email.from?.[0]?.email ?? '(unknown)'

    details.push(`--- ${subject} (from: ${from}) ---`)

    // Check bodyValues
    const bodyValues = email.bodyValues ?? {}
    const bodyValueKeys = Object.keys(bodyValues)
    details.push(`  bodyValues keys: ${bodyValueKeys.length}`)

    if (bodyValueKeys.length === 0) {
      details.push('  ⚠️  bodyValues is empty!')
      allBodiesValid = false
    }

    for (const [partId, bv] of Object.entries(bodyValues)) {
      const value = (bv as { value?: string; isTruncated?: boolean }).value
      const isTruncated = (bv as { value?: string; isTruncated?: boolean })
        .isTruncated
      const preview = value
        ? value.substring(0, 80).replace(/\n/g, '\\n')
        : '(empty)'
      details.push(
        `  [${partId}] length=${value?.length ?? 0} truncated=${isTruncated ?? false} preview="${preview}"`,
      )

      if (isTruncated) {
        details.push('  ⚠️  Content is truncated!')
        allBodiesValid = false
      }
    }

    // Check htmlBody / textBody structure
    const htmlParts = email.htmlBody ?? []
    const textParts = email.textBody ?? []
    details.push(
      `  htmlBody parts: ${htmlParts.length}, textBody parts: ${textParts.length}`,
    )

    // Detect raw MIME (a body part referencing sub-parts without value)
    for (const part of [...htmlParts, ...textParts]) {
      const partValue = bodyValues[part.partId as string] as
        { value?: string } | undefined
      if (!partValue?.value && bodyValueKeys.length > 0) {
        details.push(
          `  ⚠️  Part ${part.partId} has no corresponding bodyValue — possible raw MIME leak`,
        )
      }
    }

    details.push('')
  }

  console.log(details.join('\n'))

  report(
    'JM-02/JM-04',
    allBodiesValid ? 'PASS' : 'FAIL',
    [
      `Emails inspected: ${emails.length}`,
      `All body values present and complete: ${allBodiesValid}`,
      '',
      ...details,
    ].join('\n'),
  )
}

main().catch((err: unknown) => {
  console.error('Unhandled error:', err)
  process.exit(1)
})
