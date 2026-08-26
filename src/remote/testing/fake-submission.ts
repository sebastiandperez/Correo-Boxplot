import type { Submission, SubmissionResult } from '../submission'
import type { SubmissionMessage } from '../submission-message'

export type SubmissionCall = Readonly<{
  message: SubmissionMessage
  idempotencyKey: string
}>

export class FakeSubmission implements Submission {
  readonly calls: SubmissionCall[] = []

  constructor(
    private readonly handler: (
      message: SubmissionMessage,
      idempotencyKey: string,
    ) => Promise<SubmissionResult>,
  ) {}

  async submit(
    message: SubmissionMessage,
    idempotencyKey: string,
  ): Promise<SubmissionResult> {
    this.calls.push({ message, idempotencyKey })
    return this.handler(message, idempotencyKey)
  }
}
