import {
  jmapMailboxIdFromString,
  scopedMailboxId,
  type AccountKey,
} from '../../domain/ids'
import { mailbox, mailboxRights, type Mailbox } from '../../domain/mailbox'
import type { JmapMailbox } from '../../jmap/types'

/**
 * Maps a JmapMailbox into a Domain Mailbox. Returns null instead of
 * throwing so one malformed record cannot abort an entire sync batch —
 * see to-domain-email.ts for the same discipline.
 */
export function toDomainMailbox(
  accountKey: AccountKey,
  raw: JmapMailbox,
): Mailbox | null {
  try {
    return mailbox({
      id: scopedMailboxId(accountKey, jmapMailboxIdFromString(raw.id)),
      name: raw.name,
      parent:
        raw.parent === null
          ? null
          : scopedMailboxId(accountKey, jmapMailboxIdFromString(raw.parent)),
      role: raw.role,
      sortOrder: raw.sortOrder,
      totalEmails: raw.totalEmails,
      unreadEmails: raw.unreadEmails,
      rights: mailboxRights(raw.rights),
    })
  } catch (err: unknown) {
    console.warn(
      `[mappers] Skipping mailbox ${raw.id}: failed Domain validation`,
      err,
    )
    return null
  }
}
