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

export class JamClientAdapter implements JmapClient {
  private readonly jam: JamClient

  constructor(sessionUrl: string, auth: AuthConfig) {
    this.jam = createJamClient(sessionUrl, auth)
  }

  async openSession(): Promise<JmapSession> {
    return discoverSession(this.jam)
  }

  // --- The following methods are stubs to satisfy JmapClient, to be implemented in C-04 through C-07 ---

  async getMailboxes(_accountId: string): Promise<JmapMailbox[]> {
    throw new Error('Method not implemented yet.')
  }

  async queryEmails(_accountId: string, _mailboxId: string, _filter?: unknown): Promise<string[]> {
    throw new Error('Method not implemented yet.')
  }

  async getEmails(_accountId: string, _emailIds: string[]): Promise<JmapEmail[]> {
    throw new Error('Method not implemented yet.')
  }

  async getEmailChanges(_accountId: string, _sinceState: string): Promise<JmapDelta> {
    throw new Error('Method not implemented yet.')
  }

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
