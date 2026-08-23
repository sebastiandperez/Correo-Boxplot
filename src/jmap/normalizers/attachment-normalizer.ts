import type { JmapAttachment } from '../types'
import type { RawJmapEmailBodyPart } from '../mail/types-raw'

export function extractAttachments(bodyStructure: RawJmapEmailBodyPart): JmapAttachment[] {
  const attachments: JmapAttachment[] = []

  function traverse(part: RawJmapEmailBodyPart) {
    const isAttachmentDisposition = part.disposition === 'attachment'
    const isInlineDisposition = part.disposition === 'inline' || !!part.cid
    const isMainBody = part.type === 'text/html' || part.type === 'text/plain'
    
    // We consider it an attachment if it has a blobId AND 
    // it's explicitly marked as attachment/inline OR it's not a main body part.
    if (part.blobId && (isAttachmentDisposition || isInlineDisposition || !isMainBody)) {
      attachments.push(Object.freeze({
        blobId: part.blobId,
        name: part.name ?? null,
        type: part.type,
        size: part.size ?? 0,
        cid: part.cid ?? null,
        isInline: isInlineDisposition,
      }))
    }

    if (part.subParts) {
      for (const subPart of part.subParts) {
        traverse(subPart)
      }
    }
  }

  traverse(bodyStructure)
  return attachments
}
