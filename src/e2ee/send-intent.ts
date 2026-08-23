import type { SendIntent } from '../domain/send-intent'

import type { E2eePort } from './port'
import type { BoxplotE2eeEnvelope, E2eeResult } from './types'

/** Resolves the deliberately smaller one-recipient E2EE V1 subset. */
export function encryptSendIntent(
  port: E2eePort,
  intent: SendIntent,
): Promise<E2eeResult<BoxplotE2eeEnvelope>> {
  const [recipient] = intent.to
  if (
    recipient === undefined ||
    intent.to.length !== 1 ||
    intent.cc.length !== 0 ||
    intent.bcc.length !== 0
  ) {
    return Promise.resolve({
      ok: false,
      error: { kind: 'multipleRecipientsUnsupported' },
    })
  }
  return port.encryptFor({
    localIdentity: intent.from.email,
    recipientIdentity: recipient.email,
    subject: intent.subject,
    text: intent.body.text,
    html: intent.body.html,
  })
}
