import type { JamClient } from 'jmap-jam'
import type { JmapClient } from './client'
import { JmapMethodError } from './errors'
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
import { extractEmailBody } from './normalizers/body-normalizer'

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

  async getEmailBody(accountId: string, emailId: string): Promise<JmapEmailBody> {
    let response
    try {
      const requestResult = await this.jam.request(['Email/get', {
        accountId,
        ids: [emailId],
        properties: ['bodyStructure', 'bodyValues']
      } as any]) // Bypassing Strict Jmap-jam typings
      response = requestResult[0]
    } catch (err: unknown) {
      throw new JmapMethodError('Email/get (body)', 'networkOrServerFail', err instanceof Error ? err.message : String(err))
    }

    const list = (response as any).list
    if (!list || list.length === 0) {
      throw new JmapMethodError('Email/get (body)', 'notFound', 'Email not found')
    }

    const rawEmail = list[0]
    const bodyStructure = rawEmail.bodyStructure
    const bodyValues = rawEmail.bodyValues || {}

    if (!bodyStructure) {
      throw new JmapMethodError('Email/get (body)', 'missingBodyStructure', 'Email lacks bodyStructure')
    }

    // Since our interface JmapClient currently only returns JmapEmailBody, 
    // we extract the body. Attachments can be extracted by consumers if we expand the interface,
    // or we can attach them to a compound type if needed. For now, we fulfill the JmapEmailBody interface.
    const emailBody = extractEmailBody(emailId, bodyStructure, bodyValues)
    
    if (!emailBody) {
      throw new JmapMethodError('Email/get (body)', 'invalidBody', 'Could not extract a valid HTML or Text body from the email.')
    }

    return emailBody
  }

  async submitEmail(_accountId: string, _emailDraft: unknown): Promise<{ emailId: string; submissionId: string }> {
    throw new Error('Method not implemented yet.')
  }

  onStateChange(_callback: (change: JmapStateChange) => void): void {
    throw new Error('Method not implemented yet.')
  }
}
