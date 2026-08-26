import {
  mailboxView,
  mailboxViewCoverageRange,
  mailboxViewItem,
  mailboxViewQueryStateFromString,
  type MailboxView,
  type MailboxViewSpec,
} from '../../domain/mailbox-view'
import type { AccountKey } from '../../domain/ids'
import type { RemoteMailboxQuery } from '../../remote/mail'
import { localEmailId } from '../../remote/compat/domain-ids'

/**
 * Builds a single-page MailboxView snapshot from a JMAP query result: one
 * coverage range starting at `result.position`, matching item positions.
 * Returns null instead of throwing if the server's position/total/ids are
 * inconsistent (e.g. a concurrent change made position + ids.length exceed
 * total) — Domain's mailboxView() validates that exactly, and the caller
 * decides whether to re-query rather than crash on a race.
 */
export function toMailboxView(
  spec: MailboxViewSpec,
  accountKey: AccountKey,
  result: RemoteMailboxQuery,
): MailboxView | null {
  try {
    const items = result.ids.map((id, index) =>
      mailboxViewItem(result.position + index, localEmailId(accountKey, id)),
    )

    const coverage =
      items.length === 0
        ? []
        : [
            mailboxViewCoverageRange(
              result.position,
              result.position + items.length,
            ),
          ]

    return mailboxView({
      spec,
      queryState: mailboxViewQueryStateFromString(result.queryState),
      total: result.total,
      coverage,
      items,
    })
  } catch (err: unknown) {
    console.warn(
      '[mappers] Discarding MailboxView snapshot: failed Domain validation',
      err,
    )
    return null
  }
}
