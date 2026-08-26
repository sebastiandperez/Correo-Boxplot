import type { AccountKey } from '../../domain/ids'
import { mailbox, mailboxRights, type Mailbox } from '../../domain/mailbox'
import type { RemoteMailbox } from '../../remote/types'
import { localMailboxId } from '../../remote/compat/domain-ids'

/**
 * Maps a JmapMailbox into a Domain Mailbox. Returns null instead of
 * throwing so one malformed record cannot abort an entire sync batch —
 * see to-domain-email.ts for the same discipline.
 */
export function toDomainMailbox(
  accountKey: AccountKey,
  raw: RemoteMailbox,
): Mailbox | null {
  try {
    return mailbox({
      id: localMailboxId(accountKey, raw.id),
      name: raw.name,
      parent:
        raw.parent === null ? null : localMailboxId(accountKey, raw.parent),
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
