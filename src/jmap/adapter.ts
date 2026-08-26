import type { JamClient } from 'jmap-jam'
import type { JmapClient } from './client'
import { JmapMethodError, throwJmapRequestError } from './errors'
import type { AuthConfig } from './transport/http'
import { createJamClient } from './transport/http'
import { discoverSession } from './session'
import type {
  JmapSession,
  JmapMailboxesResult,
  JmapEmailsResult,
  JmapDelta,
  JmapEmailBody,
  JmapStateChange,
  JmapQueryResult,
  JmapQueryChanges,
  JmapIdentitiesResult,
  JmapEmailDraft,
  JmapAttachment,
  QueryOptions,
} from './types'

import { getMailboxes } from './mail/mailbox'
import { queryEmails } from './mail/email-query'
import { getEmails } from './mail/email-get'
import { getEmailChanges } from './mail/email-changes'
import { getEmailQueryChanges } from './mail/email-query-changes'
import { extractEmailBody } from './normalizers/body-normalizer'
import { extractAttachments } from './normalizers/attachment-normalizer'
import { patchEmailKeywords, patchEmailMailboxes } from './mail/mutations'
import { submitEmail } from './mail/submission'
import { getIdentities } from './mail/identity'

export class JamClientAdapter implements JmapClient {
  private readonly jam: JamClient
  private readonly sessionUrl: string
  private readonly auth: AuthConfig
  private sessionData: JmapSession | null = null

  constructor(sessionUrl: string, auth: AuthConfig) {
    this.jam = createJamClient(sessionUrl, auth)
    this.sessionUrl = sessionUrl
    this.auth = auth
  }

  async openSession(): Promise<JmapSession> {
    const session = await discoverSession(this.sessionUrl, this.auth)
    this.sessionData = session
    return session
  }

  private get apiUrl(): string {
    if (!this.sessionData?.apiUrl) {
      throw new Error('Session has not been opened or apiUrl is missing')
    }
    return this.sessionData.apiUrl
  }

  async getMailboxes(accountId: string): Promise<JmapMailboxesResult> {
    return getMailboxes(this.jam, accountId)
  }

  async getIdentities(accountId: string): Promise<JmapIdentitiesResult> {
    return getIdentities(this.jam, accountId)
  }

  async queryEmails(
    accountId: string,
    mailboxId: string,
    filter?: unknown,
    options?: QueryOptions,
  ): Promise<JmapQueryResult> {
    return queryEmails(this.jam, accountId, mailboxId, filter, options)
  }

  async getEmails(
    accountId: string,
    emailIds: string[],
  ): Promise<JmapEmailsResult> {
    return getEmails(this.jam, accountId, emailIds)
  }

  async getEmailChanges(
    accountId: string,
    sinceState: string,
  ): Promise<JmapDelta> {
    return getEmailChanges(this.jam, accountId, sinceState)
  }

  async getEmailQueryChanges(
    accountId: string,
    mailboxId: string,
    sinceQueryState: string,
  ): Promise<JmapQueryChanges> {
    return getEmailQueryChanges(
      this.apiUrl,
      this.auth,
      accountId,
      mailboxId,
      sinceQueryState,
    )
  }

  async getEmailBody(
    accountId: string,
    emailId: string,
  ): Promise<JmapEmailBody> {
    let response
    try {
      const [result] = await this.jam.request([
        'Email/get',
        {
          accountId,
          ids: [emailId],
          properties: ['bodyStructure', 'bodyValues'],
        },
      ])
      response = result
    } catch (err: unknown) {
      throwJmapRequestError('Email/get (body)', err)
    }

    const list = response.list
    if (!list || list.length === 0) {
      throw new JmapMethodError(
        'Email/get (body)',
        'notFound',
        'Email not found',
      )
    }

    const rawEmail = list[0]
    const bodyStructure = rawEmail.bodyStructure
    const bodyValues = rawEmail.bodyValues || {}

    if (!bodyStructure) {
      throw new JmapMethodError(
        'Email/get (body)',
        'missingBodyStructure',
        'Email lacks bodyStructure',
      )
    }

    const emailBody = extractEmailBody(emailId, bodyStructure, bodyValues)

    if (!emailBody) {
      throw new JmapMethodError(
        'Email/get (body)',
        'invalidBody',
        'Could not extract a valid HTML or Text body from the email.',
      )
    }

    return emailBody
  }

  async getEmailAttachments(
    accountId: string,
    emailId: string,
  ): Promise<JmapAttachment[]> {
    let response
    try {
      const [result] = await this.jam.request([
        'Email/get',
        {
          accountId,
          ids: [emailId],
          properties: ['bodyStructure'],
        },
      ])
      response = result
    } catch (err: unknown) {
      throwJmapRequestError('Email/get (attachments)', err)
    }

    const list = response.list
    if (!list || list.length === 0) {
      throw new JmapMethodError(
        'Email/get (attachments)',
        'notFound',
        'Email not found',
      )
    }

    const rawEmail = list[0]
    const bodyStructure = rawEmail.bodyStructure

    if (!bodyStructure) {
      throw new JmapMethodError(
        'Email/get (attachments)',
        'missingBodyStructure',
        'Email lacks bodyStructure',
      )
    }

    return extractAttachments(bodyStructure)
  }

  async updateEmailKeywords(
    accountId: string,
    emailId: string,
    keywords: Record<string, boolean>,
  ): Promise<void> {
    return patchEmailKeywords(
      this.apiUrl,
      this.auth,
      accountId,
      emailId,
      keywords,
    )
  }

  async updateEmailMailboxes(
    accountId: string,
    emailId: string,
    mailboxIds: Record<string, boolean>,
  ): Promise<void> {
    return patchEmailMailboxes(
      this.apiUrl,
      this.auth,
      accountId,
      emailId,
      mailboxIds,
    )
  }

  async submitEmail(
    accountId: string,
    draft: JmapEmailDraft,
    rawIdentityId: string,
  ): Promise<{ emailId: string; submissionId: string }> {
    return submitEmail(this.apiUrl, this.auth, accountId, draft, rawIdentityId)
  }

  onStateChange(callback: (change: JmapStateChange) => void): () => void {
    void callback
    // Browser WebSocket cannot attach the required Authorization header.
    // Credential-bearing query parameters are forbidden, so RFC 8887 push
    // remains fail-closed until an authenticated transport exists.
    console.warn('[JamClientAdapter] RFC 8887 push is securely deferred')
    return () => {}
  }
}
