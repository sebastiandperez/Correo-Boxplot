import type { JmapClient } from '../../jmap/client'
import {
  JmapNetworkError,
  JmapSubmissionAmbiguousError,
} from '../../jmap/errors'
import type { JmapEmailAddress, JmapEmailDraft } from '../../jmap/types'
import type { Submission, SubmissionResult } from '../submission'
import type { SubmissionMessage } from '../submission-message'
import { remoteEmailIdFromString } from '../types'
import { RemoteError } from '../errors'
import { toRemoteError } from './error-mapper'

function address(value: JmapEmailAddress): JmapEmailAddress {
  return { name: value.name, email: value.email }
}

export class JmapSubmission implements Submission {
  constructor(private readonly client: JmapClient) {}

  async submit(
    message: SubmissionMessage,
    idempotencyKey: string,
  ): Promise<SubmissionResult> {
    void idempotencyKey
    if (message.remoteIdentityId === null) {
      throw new RemoteError('JMAP submission requires a remote Identity', {
        kind: 'unsupported',
        retry: 'never',
        session: 'keep',
        outcome: 'knownNotApplied',
      })
    }
    if (message.body.kind !== 'plain') {
      throw new RemoteError('Encrypted submission is not integrated yet', {
        kind: 'unsupported',
        retry: 'never',
        session: 'keep',
        outcome: 'knownNotApplied',
      })
    }
    const draft: JmapEmailDraft = {
      from: [address(message.from)],
      to: message.to.map(address),
      cc: message.cc.map(address),
      bcc: message.bcc.map(address),
      replyTo: message.replyTo.map(address),
      subject: message.subject,
      textBody: message.body.text,
      htmlBody: message.body.html,
    }
    try {
      const result = await this.client.submitEmail(
        message.remoteAccountId,
        draft,
        message.remoteIdentityId,
      )
      return {
        kind: 'accepted',
        remoteEmailId: remoteEmailIdFromString(result.emailId),
        receiptId: result.submissionId,
      }
    } catch (error: unknown) {
      throw toRemoteError(
        error,
        error instanceof JmapNetworkError ||
          error instanceof JmapSubmissionAmbiguousError
          ? 'unknown'
          : 'knownNotApplied',
      )
    }
  }
}
