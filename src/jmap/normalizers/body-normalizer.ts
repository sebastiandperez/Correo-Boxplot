import type { JmapEmailBody } from '../types'
import type {
  RawJmapEmailBodyPart,
  RawJmapEmailBodyValue,
} from '../mail/types-raw'

function findPartIdsByType(part: RawJmapEmailBodyPart, type: string): string[] {
  const ids: string[] = []
  if (part.type === type && part.partId) {
    ids.push(part.partId)
  }
  if (part.subParts) {
    for (const subPart of part.subParts) {
      ids.push(...findPartIdsByType(subPart, type))
    }
  }
  return ids
}

/**
 * Extracts a normalized EmailBody from a JMAP bodyStructure + bodyValues.
 *
 * D-09 compliance: A truncated or encoding-problem body part is NEVER
 * silently returned as valid content. If the only available parts have
 * isEncodingProblem or isTruncated, this function returns null and the
 * caller MUST NOT produce an EmailBody entity from it.
 *
 * D-10 compliance: Attachment metadata extraction is handled separately
 * in attachment-normalizer.ts; this function only produces text/html bodies.
 */
export function extractEmailBody(
  emailId: string,
  bodyStructure: RawJmapEmailBodyPart,
  bodyValues: Record<string, RawJmapEmailBodyValue>,
): JmapEmailBody | null {
  const htmlPartIds = findPartIdsByType(bodyStructure, 'text/html')
  const textPartIds = findPartIdsByType(bodyStructure, 'text/plain')

  let html: string | null = null
  let text: string | null = null
  let hasEncodingProblem = false
  let hasTruncation = false

  const extractFromPartId = (partId: string): string | null => {
    const valueData = bodyValues[partId]
    if (!valueData) return null

    // D-09: Track encoding/truncation problems explicitly
    if (valueData.isEncodingProblem) {
      hasEncodingProblem = true
      return null
    }
    if (valueData.isTruncated) {
      hasTruncation = true
      return null
    }

    // Reject empty string bodies as non-content
    if (typeof valueData.value !== 'string' || valueData.value.length === 0) {
      return null
    }

    return valueData.value
  }

  for (const pid of htmlPartIds) {
    const val = extractFromPartId(pid)
    if (val !== null) {
      html = val
      break
    }
  }

  for (const pid of textPartIds) {
    const val = extractFromPartId(pid)
    if (val !== null) {
      text = val
      break
    }
  }

  // D-09: If we found NO usable body parts at all, return null.
  // A truncated or encoding-problem result MUST NOT produce an EmailBody.
  if (html === null && text === null) {
    if (hasEncodingProblem || hasTruncation) {
      // Log for diagnostics but do not fabricate partial content
      console.warn(
        `[body-normalizer] Email ${emailId}: body extraction failed ` +
          `(encodingProblem=${hasEncodingProblem}, truncated=${hasTruncation}). ` +
          `No EmailBody produced per D-09.`,
      )
    }
    return null
  }

  return Object.freeze({
    emailId,
    html,
    text,
  })
}
