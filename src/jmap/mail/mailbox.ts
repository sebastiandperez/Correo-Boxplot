import type { JamClient } from 'jmap-jam'
import type { JmapMailboxesResult, JmapMailboxRights } from '../types'
import type { RawJmapMailbox } from './types-raw'
import { throwJmapRequestError } from '../errors'

export async function getMailboxes(
  jam: JamClient,
  accountId: string,
): Promise<JmapMailboxesResult> {
  let response
  try {
    const [result] = await jam.request(['Mailbox/get', { accountId }])
    response = result
  } catch (err: unknown) {
    throwJmapRequestError('Mailbox/get', err)
  }

  // JMAP successful responses return an object with "list" and "state"
  // (RFC 8620 §5.1). We need to carefully map these RawJmapMailboxes to
  // our normalized JmapMailboxes.
  const list = (response.list || []) as readonly RawJmapMailbox[]
  const state = (response.state as string | undefined) ?? ''

  const mailboxes = list.map((raw) => {
    // According to RFC 8621, myRights might be missing if we requested specific properties
    // but by default it returns it. We supply defaults just in case.
    const rights: JmapMailboxRights = {
      mayReadItems: raw.myRights?.mayReadItems ?? false,
      mayAddItems: raw.myRights?.mayAddItems ?? false,
      mayRemoveItems: raw.myRights?.mayRemoveItems ?? false,
      maySetSeen: raw.myRights?.maySetSeen ?? false,
      maySetKeywords: raw.myRights?.maySetKeywords ?? false,
      maySubmit: raw.myRights?.maySubmit ?? false,
    }

    return {
      id: raw.id,
      name: raw.name,
      parent: raw.parentId ?? null,
      role: raw.role ?? null,
      sortOrder: raw.sortOrder ?? 0,
      totalEmails: raw.totalEmails ?? 0,
      unreadEmails: raw.unreadEmails ?? 0,
      rights,
    }
  })

  return { mailboxes, state }
}
