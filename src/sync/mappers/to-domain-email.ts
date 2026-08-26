import type { AccountKey } from '../../domain/ids'
import { emailAddress, type EmailAddress } from '../../domain/address'
import { email, keywordSet } from '../../domain/email'
import { emailMailbox } from '../../domain/mailbox'
import type { EmailSyncRecord } from '../../ports/sync-port'
import type { RemoteAddressList, RemoteEmail } from '../../remote/types'
import {
  localBlobId,
  localEmailId,
  localMailboxId,
  localThreadId,
} from '../../remote/compat/domain-ids'

function toDomainAddressList(
  raw: RemoteAddressList,
): readonly EmailAddress[] | null {
  if (raw === null) return null
  return raw.map((addr) => emailAddress(addr.name, addr.email))
}

/**
 * Maps normalized protocol-neutral remote mail metadata into an
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
  raw: RemoteEmail,
): EmailSyncRecord | null {
  try {
    const id = localEmailId(accountKey, raw.id)

    const domainEmail = email({
      id,
      blobId: localBlobId(accountKey, raw.blobId),
      threadId: localThreadId(accountKey, raw.threadId),
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
      keywords: keywordSet(raw.keywords),
    })

    const memberships = raw.mailboxIds.map((mailboxId) =>
      emailMailbox(id, localMailboxId(accountKey, mailboxId)),
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
