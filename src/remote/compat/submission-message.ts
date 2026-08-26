import type { SendIntent } from '../../domain/send-intent'
import type { SubmissionMessage } from '../submission-message'
import type { RemoteAccountId } from '../types'
import { remoteIdentityId } from './domain-ids'

export function submissionMessageFromSendIntent(
  remoteAccountId: RemoteAccountId,
  intent: SendIntent,
): SubmissionMessage {
  return {
    remoteAccountId,
    remoteIdentityId: remoteIdentityId(intent.identityId),
    from: { ...intent.from },
    to: intent.to.map((address) => ({ ...address })),
    cc: intent.cc.map((address) => ({ ...address })),
    bcc: intent.bcc.map((address) => ({ ...address })),
    replyTo: intent.replyTo.map((address) => ({ ...address })),
    subject: intent.subject,
    body: {
      kind: 'plain',
      text: intent.body.text,
      html: intent.body.html,
    },
  }
}
