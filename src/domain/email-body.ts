import { sameScopedEmailId, type ScopedEmailId } from './ids'

export type EmailBody = Readonly<{
  emailId: ScopedEmailId
  text: string | null
  html: string | null
}>

// Callers must supply a complete normalized body; strings cannot prove transport completeness.
export function emailBody(input: EmailBody): EmailBody {
  return {
    emailId: input.emailId,
    text: input.text,
    html: input.html,
  }
}

export function sameEmailBodyIdentity(
  left: EmailBody,
  right: EmailBody,
): boolean {
  return sameScopedEmailId(left.emailId, right.emailId)
}
