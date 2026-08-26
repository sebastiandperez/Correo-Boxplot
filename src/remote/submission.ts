import type { RemoteEmailId } from './types'
import type { SubmissionMessage } from './submission-message'

export type SubmissionResult = Readonly<{
  kind: 'accepted'
  remoteEmailId: RemoteEmailId | null
  receiptId: string | null
}>

export interface Submission {
  submit(
    message: SubmissionMessage,
    idempotencyKey: string,
  ): Promise<SubmissionResult>
}
