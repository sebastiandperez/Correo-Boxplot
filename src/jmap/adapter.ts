import type { JamClient } from 'jmap-jam'
import type { JmapClient } from './client'
import type { AuthConfig } from './transport/http'
import { createJamClient } from './transport/http'
import { discoverSession } from './session'
import type {
  JmapSession,
  JmapMailbox,
  JmapEmail,
  JmapDelta,
  JmapEmailBody,
  JmapStateChange,
} from './types'

import { getMailboxes } from './mail/mailbox'
import { queryEmails } from './mail/email-query'
import { getEmails } from './mail/email-get'
import { getEmailChanges } from './mail/email-changes'

export class JamClientAdapter implements JmapClient {
  private readonly jam: JamClient

  constructor(sessionUrl: string, auth: AuthConfig) {
    this.jam = createJamClient(sessionUrl, auth)
  }

  async openSession(): Promise<JmapSession> {
    return discoverSession(this.jam)
  }

  async getMailboxes(accountId: string): Promise<JmapMailbox[]> {
    return getMailboxes(this.jam, accountId)
  }

  async queryEmails(accountId: string, mailboxId: string, filter?: unknown): Promise<string[]> {
    return queryEmails(this.jam, accountId, mailboxId, filter)
  }

  async getEmails(accountId: string, emailIds: string[]): Promise<JmapEmail[]> {
    return getEmails(this.jam, accountId, emailIds)
  }

  async getEmailChanges(accountId: string, sinceState: string): Promise<JmapDelta> {
    return getEmailChanges(this.jam, accountId, sinceState)
  }

  // --- The following methods are stubs to satisfy JmapClient, to be implemented in C-05 through C-07 ---

  async getEmailBody(_accountId: string, _emailId: string): Promise<JmapEmailBody> {
    throw new Error('Method not implemented yet.')
  }

  async submitEmail(_accountId: string, _emailDraft: unknown): Promise<{ emailId: string; submissionId: string }> {
    throw new Error('Method not implemented yet.')
  }

  onStateChange(_callback: (change: JmapStateChange) => void): void {
    throw new Error('Method not implemented yet.')
  }
}
