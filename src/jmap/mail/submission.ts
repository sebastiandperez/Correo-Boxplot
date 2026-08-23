import type { AuthConfig } from '../transport/http'
import { fetchJmapRaw } from '../transport/http'
import { JmapMethodError } from '../errors'
import type { JmapEmailDraft, JmapEmailAddress } from '../types'
import type { RawJmapSetResponse } from './types-raw'

function formatAddresses(addresses: readonly JmapEmailAddress[]) {
  return addresses.map((addr) => ({
    name: addr.name || '',
    email: addr.email,
  }))
}

export async function submitEmail(
  apiUrl: string,
  auth: AuthConfig,
  accountId: string,
  draft: JmapEmailDraft,
  rawIdentityId: string,
): Promise<{ emailId: string; submissionId: string }> {
  // 1. We must find the Drafts mailbox to place the created email.
  let mailboxResponse
  try {
    const mbxResult = await fetchJmapRaw(apiUrl, auth, [
      [
        'Mailbox/query',
        {
          accountId,
          filter: { role: 'drafts' },
          limit: 1,
        },
        'm1',
      ],
    ])
    mailboxResponse = mbxResult[0][1] as { ids?: string[] }
  } catch (err: unknown) {
    throw new JmapMethodError(
      'Mailbox/query',
      'networkOrServerFail',
      err instanceof Error ? err.message : String(err),
    )
  }

  const mailboxIdsArray = mailboxResponse.ids || []
  if (mailboxIdsArray.length === 0) {
    throw new JmapMethodError(
      'Mailbox/query',
      'notFound',
      'Drafts mailbox not found',
    )
  }
  const draftsMailboxId = mailboxIdsArray[0]

  // 2. Build the Email object
  const bodyValues: Record<string, { value: string }> = {}
  const textBody: Array<{ partId: string }> = []
  const htmlBody: Array<{ partId: string }> = []

  if (draft.textBody) {
    bodyValues['t1'] = { value: draft.textBody }
    textBody.push({ partId: 't1' })
  }
  if (draft.htmlBody) {
    bodyValues['h1'] = { value: draft.htmlBody }
    htmlBody.push({ partId: 'h1' })
  }

  const emailCreateObj = {
    mailboxIds: { [draftsMailboxId]: true },
    from: formatAddresses(draft.from),
    to: formatAddresses(draft.to),
    cc: formatAddresses(draft.cc),
    bcc: formatAddresses(draft.bcc),
    replyTo: formatAddresses(draft.replyTo),
    subject: draft.subject,
    bodyValues,
    textBody,
    htmlBody,
  }

  // 3. Batch Email/set (create) and EmailSubmission/set
  const methodCalls = [
    [
      'Email/set',
      {
        accountId,
        create: {
          draft1: emailCreateObj,
        },
      },
      'e1',
    ],
    [
      'EmailSubmission/set',
      {
        accountId,
        create: {
          sub1: {
            emailId: '#draft1',
            identityId: rawIdentityId,
          },
        },
      },
      's1',
    ],
  ] as const

  let batchResponse
  try {
    batchResponse = await fetchJmapRaw(apiUrl, auth, methodCalls)
  } catch (err: unknown) {
    throw new JmapMethodError(
      'Email/set+EmailSubmission/set',
      'networkOrServerFail',
      err instanceof Error ? err.message : String(err),
    )
  }

  const emailSetResponse =
    (batchResponse.find(
      (entry) => entry[2] === 'e1',
    )?.[1] as RawJmapSetResponse) || {}
  const subSetResponse =
    (batchResponse.find(
      (entry) => entry[2] === 's1',
    )?.[1] as RawJmapSetResponse) || {}

  const emailNotCreated = emailSetResponse.notCreated?.['draft1']
  if (emailNotCreated) {
    if (emailNotCreated.type === 'tooLarge') {
      throw new JmapMethodError(
        'Email/set',
        'tooLarge',
        emailNotCreated.description || 'Email is too large',
      )
    }
    throw new JmapMethodError(
      'Email/set',
      emailNotCreated.type || 'unknown',
      emailNotCreated.description || 'Failed to create email draft',
    )
  }

  const subNotCreated = subSetResponse.notCreated?.['sub1']
  if (subNotCreated) {
    throw new JmapMethodError(
      'EmailSubmission/set',
      subNotCreated.type || 'unknown',
      subNotCreated.description || 'Failed to submit email',
    )
  }

  const createdEmailId = emailSetResponse.created?.['draft1']?.id
  const createdSubId = subSetResponse.created?.['sub1']?.id

  if (!createdEmailId || !createdSubId) {
    throw new JmapMethodError(
      'EmailSubmission/set',
      'unknown',
      'Server returned success but missing IDs',
    )
  }

  return {
    emailId: createdEmailId,
    submissionId: createdSubId,
  }
}
