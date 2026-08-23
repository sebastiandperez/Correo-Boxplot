import type { SendIntent } from '../../domain/send-intent'
import type { JmapEmailDraft, JmapEmailAddress } from '../types'

/**
 * Maps a domain SendIntent to a JmapEmailDraft DTO.
 *
 * This mapping lives exclusively in the JMAP layer, keeping
 * the Outbox and Domain protocol-agnostic.
 *
 * D-03 compliance: Empty address arrays are preserved as empty arrays
 * in the DTO since JMAP expects arrays (not null) for optional recipient fields.
 */
export function mapSendIntentToJmapDraft(intent: SendIntent): JmapEmailDraft {
  const mapAddress = (addr: { name: string | null; email: string }): JmapEmailAddress => 
    Object.freeze({ name: addr.name, email: addr.email })

  return Object.freeze({
    from: [mapAddress(intent.from)],
    to: intent.to.map(mapAddress),
    cc: intent.cc.map(mapAddress),
    bcc: intent.bcc.map(mapAddress),
    replyTo: intent.replyTo ? intent.replyTo.map(mapAddress) : [],
    subject: intent.subject,
    htmlBody: intent.body.html,
    textBody: intent.body.text,
  })
}