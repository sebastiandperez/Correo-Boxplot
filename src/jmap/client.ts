import type {
  JmapSession,
  JmapMailbox,
  JmapEmail,
  JmapDelta,
  JmapEmailBody,
  JmapStateChange,
} from './types'

export interface JmapClient {
  /**
   * Retrieves the JMAP Session, validating endpoints and capabilities.
   * Throws JmapAuthError if authentication fails.
   */
  openSession(): Promise<JmapSession>

  /**
   * Retrieves all mailboxes for the given account.
   */
  getMailboxes(accountId: string): Promise<JmapMailbox[]>

  /**
   * Queries emails in a specific mailbox, returning an array of email IDs.
   */
  queryEmails(
    accountId: string,
    mailboxId: string,
    filter?: unknown,
  ): Promise<string[]>

  /**
   * Retrieves the metadata for the requested email IDs.
   */
  getEmails(accountId: string, emailIds: string[]): Promise<JmapEmail[]>

  /**
   * Retrieves changes to emails since a specific state.
   */
  getEmailChanges(accountId: string, sinceState: string): Promise<JmapDelta>

  /**
   * Retrieves the full structural body of an email.
   */
  getEmailBody(accountId: string, emailId: string): Promise<JmapEmailBody>

  /**
   * Submits a draft email for sending.
   * @returns an object containing the new emailId and submissionId.
   */
  submitEmail(
    accountId: string,
    emailDraft: unknown,
  ): Promise<{ emailId: string; submissionId: string }>

  /**
   * Registers a callback to receive push notifications via WebSocket or SSE.
   */
  onStateChange(callback: (change: JmapStateChange) => void): void
}
