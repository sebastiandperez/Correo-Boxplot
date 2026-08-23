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
import { patchEmailKeywords, patchEmailMailboxes } from './mail/mutations'
import { submitEmail } from './mail/submission'
import type { SendIntent } from '../domain/send-intent'

import { connectSSE } from './transport/sse'

export class JamClientAdapter implements JmapClient {
  private readonly jam: JamClient
  private readonly auth: AuthConfig
  private eventSourceUrl: string | null = null

  constructor(sessionUrl: string, auth: AuthConfig) {
    this.jam = createJamClient(sessionUrl, auth)
    this.auth = auth
  }

  async openSession(): Promise<JmapSession> {
    const session = await discoverSession(this.jam)
    // Extract eventSourceUrl from jmap-jam's session
    this.eventSourceUrl = (await this.jam.session)?.eventSourceUrl || null
    return session
  }

  async getMailboxes(accountId: string): Promise<JmapMailbox[]> {
    return getMailboxes(this.jam, accountId)
  }

  async queryEmails(
    accountId: string,
    mailboxId: string,
    filter?: unknown,
  ): Promise<string[]> {
    return queryEmails(this.jam, accountId, mailboxId, filter)
  }

  async getEmails(accountId: string, emailIds: string[]): Promise<JmapEmail[]> {
    return getEmails(this.jam, accountId, emailIds)
  }

  async getEmailChanges(
    accountId: string,
    sinceState: string,
  ): Promise<JmapDelta> {
    return getEmailChanges(this.jam, accountId, sinceState)
  }

  // --- The following methods are stubs to satisfy JmapClient, to be implemented in C-05 through C-07 ---

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
      throw new JmapMethodError(
        'Email/get (body)',
        'networkOrServerFail',
        err instanceof Error ? err.message : String(err),
      )
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

    // Since our interface JmapClient currently only returns JmapEmailBody,
    // we extract the body. Attachments can be extracted by consumers if we expand the interface,
    // or we can attach them to a compound type if needed. For now, we fulfill the JmapEmailBody interface.
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

  async updateEmailKeywords(
    accountId: string,
    emailId: string,
    keywords: Record<string, boolean>,
  ): Promise<void> {
    return patchEmailKeywords(this.jam, accountId, emailId, keywords)
  }

  async updateEmailMailboxes(
    accountId: string,
    emailId: string,
    mailboxIds: Record<string, boolean>,
  ): Promise<void> {
    return patchEmailMailboxes(this.jam, accountId, emailId, mailboxIds)
  }

  async submitEmail(
    accountId: string,
    intent: SendIntent,
    rawIdentityId: string,
  ): Promise<{ emailId: string; submissionId: string }> {
    return submitEmail(this.jam, accountId, intent, rawIdentityId)
  }

  onStateChange(callback: (change: JmapStateChange) => void): void {
    if (!this.eventSourceUrl) {
      throw new Error(
        'Session has not been opened yet, eventSourceUrl is missing',
      )
    }
    connectSSE({
      eventSourceUrl: this.eventSourceUrl,
      auth: this.auth,
      onStateChange: callback,
    })
  }
}
