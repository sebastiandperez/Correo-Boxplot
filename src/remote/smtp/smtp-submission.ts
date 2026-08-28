import type { Submission, SubmissionResult } from '../submission'
import type { SubmissionMessage } from '../submission-message'
import { toNativeRemoteError } from '../native/error-mapper'
import type { NativeAddressDto, NativeMailIpcPort } from '../native/ipc'
import type { RemoteAccountId } from '../types'

export class SmtpSubmission implements Submission {
  constructor(
    private readonly ipc: NativeMailIpcPort,
    private readonly sessionId: string,
    private readonly accountId: RemoteAccountId,
  ) {}

  async submit(
    message: SubmissionMessage,
    idempotencyKey: string,
  ): Promise<SubmissionResult> {
    if (message.remoteAccountId !== this.accountId) {
      throw toNativeRemoteError({
        kind: 'stateInvalid',
        retry: 'never',
        session: 'keep',
        outcome: 'knownNotApplied',
        code: 'remote_account_mismatch',
      })
    }
    try {
      const response = await this.ipc.smtpSubmit({
        sessionId: this.sessionId,
        from: address(message.from),
        to: message.to.map(address),
        cc: message.cc.map(address),
        bcc: message.bcc.map(address),
        replyTo: message.replyTo.map(address),
        subject: message.subject,
        body: message.body,
        idempotencyKey,
      })
      return {
        kind: 'accepted',
        remoteEmailId: null,
        receiptId: response.receiptId,
      }
    } catch (error: unknown) {
      throw toNativeRemoteError(error)
    }
  }
}

function address(value: NativeAddressDto): NativeAddressDto {
  return { name: value.name, email: value.email }
}
