/* eslint-disable @typescript-eslint/no-unused-vars */
import type { JmapClient } from './client'
import type { JmapSession, JmapMailbox, JmapEmail, JmapDelta, JmapEmailBody, JmapAttachment, JmapQueryResult, JmapQueryChanges, JmapIdentity, JmapEmailDraft, JmapStateChange } from './types'

export class MockJmapClient implements JmapClient {
  async openSession(): Promise<JmapSession> { throw new Error('Mock'); }
  async getMailboxes(_accountId: string): Promise<JmapMailbox[]> { return []; }
  async getIdentities(_accountId: string): Promise<JmapIdentity[]> { return []; }
  async queryEmails(_accountId: string, _mailboxId: string, _filter?: unknown): Promise<JmapQueryResult> { throw new Error('Mock'); }
  async getEmails(_accountId: string, _emailIds: string[]): Promise<JmapEmail[]> { return []; }
  async getEmailChanges(accountId: string, sinceState: string): Promise<JmapDelta> { return { accountId, oldState: sinceState, newState: 'new', hasMoreChanges: false, created: [], updated: [], destroyed: [] }; }
  async getEmailQueryChanges(_accountId: string, _mailboxId: string, _sinceQueryState: string): Promise<JmapQueryChanges> { throw new Error('Mock'); }
  async getEmailBody(_accountId: string, _emailId: string): Promise<JmapEmailBody> { throw new Error('Mock'); }
  async getEmailAttachments(_accountId: string, _emailId: string): Promise<JmapAttachment[]> { return []; }
  async updateEmailKeywords(_accountId: string, _emailId: string, _keywords: Record<string, boolean>): Promise<void> {}
  async updateEmailMailboxes(_accountId: string, _emailId: string, _mailboxIds: Record<string, boolean>): Promise<void> {}
  async submitEmail(_accountId: string, _draft: JmapEmailDraft, _rawIdentityId: string): Promise<{ emailId: string; submissionId: string }> {
    return { emailId: 'mock-email', submissionId: 'mock-sub' };
  }
  onStateChange(_callback: (change: JmapStateChange) => void): () => void { return () => {}; }
}

