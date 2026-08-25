import type {
  JmapSession,
  JmapMailboxesResult,
  JmapEmailsResult,
  JmapDelta,
  JmapEmailBody,
  JmapAttachment,
  JmapQueryResult,
  JmapQueryChanges,
  JmapIdentity,
  JmapEmailDraft,
  JmapStateChange,
  QueryOptions,
} from './types'

export interface JmapClient {
  /**
   * Retrieves the JMAP Session, validating endpoints and capabilities.
   * Throws JmapAuthError if authentication fails.
   */
  openSession(): Promise<JmapSession>

  /**
   * Retrieves all mailboxes for the given account, plus the opaque
   * collection state token Coordinator commits as CollectionSyncCursor.
   */
  getMailboxes(accountId: string): Promise<JmapMailboxesResult>

  /**
   * Retrieves all identities for the given account.
   */
  getIdentities(accountId: string): Promise<JmapIdentity[]>

  /**
   * Queries emails in a specific mailbox, returning IDs + query metadata.
   * `options` covers pagination (position/limit/anchor/anchorOffset) —
   * without it, JMAP's own pagination is unreachable through this port.
   */
  queryEmails(
    accountId: string,
    mailboxId: string,
    filter?: unknown,
    options?: QueryOptions,
  ): Promise<JmapQueryResult>

  /**
   * Retrieves the metadata for the requested email IDs, plus the opaque
   * Email collection state token (used to bootstrap a cursor when there
   * is no prior Email/changes state — see Coordinator.performHardReset).
   */
  getEmails(accountId: string, emailIds: string[]): Promise<JmapEmailsResult>

  /**
   * Retrieves changes to emails since a specific state.
   */
  getEmailChanges(accountId: string, sinceState: string): Promise<JmapDelta>

  /**
   * Retrieves changes to an email query since a specific query state.
   */
  getEmailQueryChanges(
    accountId: string,
    mailboxId: string,
    sinceQueryState: string,
  ): Promise<JmapQueryChanges>

  /**
   * Retrieves the full structural body of an email.
   */
  getEmailBody(accountId: string, emailId: string): Promise<JmapEmailBody>

  /**
   * Retrieves attachments metadata for an email.
   */
  getEmailAttachments(
    accountId: string,
    emailId: string,
  ): Promise<JmapAttachment[]>

  /**
   * Updates keywords (e.g. read, flagged) for a specific email.
   */
  updateEmailKeywords(
    accountId: string,
    emailId: string,
    keywords: Record<string, boolean>,
  ): Promise<void>

  /**
   * Updates the mailboxes (folders) an email belongs to.
   */
  updateEmailMailboxes(
    accountId: string,
    emailId: string,
    mailboxIds: Record<string, boolean>,
  ): Promise<void>

  /**
   * Submits a draft email for sending.
   * Receives a JmapEmailDraft (JMAP-layer DTO, not Domain SendIntent).
   * The Coordinator is responsible for converting SendIntent → JmapEmailDraft.
   * @returns an object containing the new emailId and submissionId.
   */
  submitEmail(
    accountId: string,
    draft: JmapEmailDraft,
    rawIdentityId: string,
  ): Promise<{ emailId: string; submissionId: string }>

  /**
   * Registers a callback to receive push notifications via JMAP WebSocket.
   * Returns a disconnect function.
   */
  onStateChange(callback: (change: JmapStateChange) => void): () => void
}
