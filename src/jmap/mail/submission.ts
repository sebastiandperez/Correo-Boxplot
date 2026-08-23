import type { JamClient } from 'jmap-jam'
import { JmapMethodError } from '../errors'
import type { SendIntent } from '../../domain/send-intent'
import type { EmailAddress } from '../../domain/address'

function formatAddresses(addresses: readonly EmailAddress[]) {
  return addresses.map(addr => ({
    name: addr.name || '',
    email: addr.email,
  }))
}

export async function submitEmail(
  jam: JamClient,
  accountId: string,
  intent: SendIntent,
  rawIdentityId: string
): Promise<{ emailId: string; submissionId: string }> {
  // 1. We must find the Drafts mailbox to place the created email.
  let mailboxResponse
  try {
    const mbxResult = await jam.request(['Mailbox/query', {
      accountId,
      filter: { role: 'drafts' },
      limit: 1
    } as any])
    mailboxResponse = mbxResult[0]
  } catch (err: unknown) {
    throw new JmapMethodError('Mailbox/query', 'networkOrServerFail', err instanceof Error ? err.message : String(err))
  }

  const mailboxIdsArray = (mailboxResponse as any).ids || []
  if (mailboxIdsArray.length === 0) {
    throw new JmapMethodError('Mailbox/query', 'notFound', 'Drafts mailbox not found')
  }
  const draftsMailboxId = mailboxIdsArray[0]

  // 2. Build the Email object
  const bodyValues: Record<string, any> = {}
  const textBody: any[] = []
  const htmlBody: any[] = []

  if (intent.body.text) {
    bodyValues['t1'] = { value: intent.body.text }
    textBody.push({ partId: 't1' })
  }
  if (intent.body.html) {
    bodyValues['h1'] = { value: intent.body.html }
    htmlBody.push({ partId: 'h1' })
  }

  // If both are missing, JMAP typically requires at least one, but we pass what intent has.
  // Actually, Domain SendIntent requires at least text or html, but usually both might exist.

  const emailCreateObj = {
    mailboxIds: { [draftsMailboxId]: true },
    from: [formatAddresses([intent.from])[0]],
    to: formatAddresses(intent.to),
    cc: formatAddresses(intent.cc),
    bcc: formatAddresses(intent.bcc),
    replyTo: formatAddresses(intent.replyTo),
    subject: intent.subject,
    bodyValues,
    textBody,
    htmlBody,
  }

  // 3. Batch Email/set (create) and EmailSubmission/set
  const methodCalls = [
    ['Email/set', {
      accountId,
      create: {
        'draft1': emailCreateObj
      }
    }, 'e1'],
    ['EmailSubmission/set', {
      accountId,
      create: {
        'sub1': {
          emailId: '#draft1',
          identityId: rawIdentityId,
        }
      }
    }, 's1']
  ]

  let batchResponse
  try {
    const requestResult = await jam.request(methodCalls as any)
    batchResponse = requestResult
  } catch (err: unknown) {
    throw new JmapMethodError('Email/set+EmailSubmission/set', 'networkOrServerFail', err instanceof Error ? err.message : String(err))
  }

  const emailSetResponse = (batchResponse as any[]).find(r => r[2] === 'e1')?.[1] || {}
  const subSetResponse = (batchResponse as any[]).find(r => r[2] === 's1')?.[1] || {}

  const emailNotCreated = emailSetResponse.notCreated?.['draft1']
  if (emailNotCreated) {
    if (emailNotCreated.type === 'tooLarge') {
      throw new JmapMethodError('Email/set', 'tooLarge', emailNotCreated.description || 'Email is too large')
    }
    throw new JmapMethodError('Email/set', emailNotCreated.type || 'unknown', emailNotCreated.description || 'Failed to create email draft')
  }

  const subNotCreated = subSetResponse.notCreated?.['sub1']
  if (subNotCreated) {
    throw new JmapMethodError('EmailSubmission/set', subNotCreated.type || 'unknown', subNotCreated.description || 'Failed to submit email')
  }

  const createdEmailId = emailSetResponse.created?.['draft1']?.id
  const createdSubId = subSetResponse.created?.['sub1']?.id

  if (!createdEmailId || !createdSubId) {
    throw new JmapMethodError('EmailSubmission/set', 'unknown', 'Server returned success but missing IDs')
  }

  return {
    emailId: createdEmailId,
    submissionId: createdSubId,
  }
}
