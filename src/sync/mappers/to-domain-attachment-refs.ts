import {
  attachmentPartIdFromString,
  attachmentRef,
  type AttachmentRef,
} from '../../domain/attachment-ref'
import type { AccountKey, ScopedEmailId } from '../../domain/ids'
import type { RemoteAttachment } from '../../remote/types'
import { localBlobId } from '../../remote/compat/domain-ids'

/**
 * Maps JmapAttachment[] (already normalized in
 * normalizers/attachment-normalizer.ts) into AttachmentRef[] for
 * SyncPort.replaceAttachmentRefs. An attachment missing a required
 * identity field (partId, blobId) is skipped rather than fabricated —
 * same discipline as to-domain-email.ts.
 */
export function toDomainAttachmentRefs(
  accountKey: AccountKey,
  emailId: ScopedEmailId,
  raw: readonly RemoteAttachment[],
): readonly AttachmentRef[] {
  const result: AttachmentRef[] = []

  for (const attachment of raw) {
    if (attachment.partId === null || attachment.blobId.length === 0) {
      console.warn(
        `[mappers] Skipping attachment on ${emailId.jmapId}: missing partId/blobId`,
      )
      continue
    }

    try {
      result.push(
        attachmentRef({
          emailId,
          partId: attachmentPartIdFromString(attachment.partId),
          blobId: localBlobId(accountKey, attachment.blobId),
          name: attachment.name,
          mediaType: attachment.mediaType,
          size: attachment.size,
          disposition: attachment.disposition,
          cid: attachment.cid,
        }),
      )
    } catch (err: unknown) {
      console.warn(
        `[mappers] Skipping attachment on ${emailId.jmapId}: failed Domain validation`,
        err,
      )
    }
  }

  return result
}
