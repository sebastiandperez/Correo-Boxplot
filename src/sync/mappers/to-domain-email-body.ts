import { emailBody, type EmailBody } from '../../domain/email-body'
import type { ScopedEmailId } from '../../domain/ids'
import type { JmapEmailBody } from '../../jmap/types'

/**
 * Translates an already-normalized JmapEmailBody into a Domain EmailBody.
 * D-09 filtering (isEncodingProblem/isTruncated/empty content rejection)
 * already happened in normalizers/body-normalizer.ts::extractEmailBody —
 * by the time a JmapEmailBody reaches this function it is either a
 * complete representation or the caller never got one at all.
 */
export function toDomainEmailBody(
  emailId: ScopedEmailId,
  raw: JmapEmailBody,
): EmailBody {
  return emailBody({ emailId, text: raw.text, html: raw.html })
}
