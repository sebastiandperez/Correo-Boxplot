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

export function extractEmailBody(
  emailId: string,
  bodyStructure: RawJmapEmailBodyPart,
  bodyValues: Record<string, RawJmapEmailBodyValue>,
): JmapEmailBody | null {
  const htmlPartIds = findPartIdsByType(bodyStructure, 'text/html')
  const textPartIds = findPartIdsByType(bodyStructure, 'text/plain')

  let html: string | null = null
  let text: string | null = null

  // Helper to extract text from a part, respecting truncation/encoding constraints
  const extractFromPartId = (partId: string): string | null => {
    const valueData = bodyValues[partId]
    if (!valueData) return null
    if (valueData.isEncodingProblem || valueData.isTruncated) return null
    return valueData.value
  }

  // JMAP structures might have multiple text/html or text/plain parts.
  // We simply extract the first valid one we find, or join them (typically just one for simple emails)
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

  if (html === null && text === null) {
    return null
  }

  return Object.freeze({
    emailId,
    html,
    text,
  })
}
