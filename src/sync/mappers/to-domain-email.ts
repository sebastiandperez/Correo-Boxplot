import {
  jmapBlobIdFromString,
  jmapEmailIdFromString,
  jmapMailboxIdFromString,
  jmapThreadIdFromString,
  scopedBlobId,
  scopedEmailId,
  scopedMailboxId,
  scopedThreadId,
  type AccountKey,
} from '../../domain/ids'
import { emailAddress, type EmailAddress } from '../../domain/address'
import { email, keywordSet } from '../../domain/email'
import { emailMailbox } from '../../domain/mailbox'
import type { EmailSyncRecord } from '../../ports/sync-port'
import type { JmapEmail, JmapEmailAddressList } from '../../jmap/types'

function toDomainAddressList(
  raw: JmapEmailAddressList,
): readonly EmailAddress[] | null {
  if (raw === null) return null
  return raw.map((addr) => emailAddress(addr.name, addr.email))
}

/**
 * Maps a normalized JmapEmail (already D-02/D-03 validated at the JMAP
 * layer — see mail/email-get.ts::validateAndMapEmail) into an
 * EmailSyncRecord ready for SyncPort.applyCollectionSync.
 *
 * Returns null instead of throwing so one malformed record cannot abort
 * an entire sync batch. This function never re-implements Domain
 * validation — it attempts construction through the real factories and
 * treats any TypeError from them as "reject, don't fabricate", the same
 * discipline already used throughout the JMAP layer.
 */
export function toDomainEmailRecord(
  accountKey: AccountKey,
  raw: JmapEmail,
): EmailSyncRecord | null {
  try {
    const id = scopedEmailId(accountKey, jmapEmailIdFromString(raw.id))

    const domainEmail = email({
      id,
      blobId: scopedBlobId(accountKey, jmapBlobIdFromString(raw.blobId)),
      threadId: scopedThreadId(
        accountKey,
        jmapThreadIdFromString(raw.threadId),
      ),
      sender: toDomainAddressList(raw.sender),
      from: toDomainAddressList(raw.from),
      replyTo: toDomainAddressList(raw.replyTo),
      to: toDomainAddressList(raw.to),
      cc: toDomainAddressList(raw.cc),
      bcc: toDomainAddressList(raw.bcc),
      subject: raw.subject,
      sentAt: raw.sentAt,
      receivedAt: raw.receivedAt,
      size: raw.size,
      preview: raw.preview,
      hasAttachment: raw.hasAttachment,
      keywords: keywordSet(
        Object.keys(raw.keywords).filter((k) => raw.keywords[k] === true),
      ),
    })

    const memberships = raw.mailboxIds.map((mailboxId) =>
      emailMailbox(
        id,
        scopedMailboxId(accountKey, jmapMailboxIdFromString(mailboxId)),
      ),
    )

    return { email: domainEmail, memberships }
  } catch (err: unknown) {
    console.warn(
      `[mappers] Skipping email ${raw.id}: failed Domain validation`,
      err,
    )
    return null
  }
}
