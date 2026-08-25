import { describe, it, expect, vi } from 'vitest'
import type { JmapClient } from '../client'
import type {
  JmapSession,
  JmapMailbox,
  JmapEmail,
  JmapDelta,
  JmapEmailBody,
  JmapStateChange,
} from '../types'
import { JmapAuthError, JmapMethodError } from '../errors'

// Implement a Fake JmapClient to satisfy contract tests
class FakeJmapClient implements JmapClient {
  public throwAuthError = false

  async openSession(): Promise<JmapSession> {
    if (this.throwAuthError) {
      throw new JmapAuthError()
    }
    return {
      apiUrl: 'https://example.com/jmap',
      downloadUrl: 'https://example.com/download',
      uploadUrl: 'https://example.com/upload',
      eventSourceUrl: 'https://example.com/events',
      webSocketUrl: null,
      primaryAccounts: { 'urn:ietf:params:jmap:mail': 'account-1' },
      capabilities: {},
    }
  }

  async getMailboxes(accountId: string): Promise<JmapMailbox[]> {
    if (accountId !== 'account-1')
      throw new JmapMethodError('Mailbox/get', 'accountNotFound')
    return [
      {
        id: 'mb-1',
        name: 'Inbox',
        parent: null,
        role: 'inbox',
        sortOrder: 10,
        totalEmails: 5,
        unreadEmails: 2,
        rights: {
          mayReadItems: true,
          mayAddItems: true,
          mayRemoveItems: true,
          maySetSeen: true,
          maySetKeywords: true,
          maySubmit: false,
        },
      },
    ]
  }

  async queryEmails(): Promise<import('../types').JmapQueryResult> {
    return {
      ids: ['email-1', 'email-2'],
      queryState: 'state-1',
      total: 2,
      position: 0,
      canCalculateChanges: true,
    }
  }

  async getEmailQueryChanges(): Promise<import('../types').JmapQueryChanges> {
    throw new Error('Method not implemented.')
  }

  async getIdentities(): Promise<import('../types').JmapIdentity[]> {
    throw new Error('Method not implemented.')
  }

  async getEmailAttachments(): Promise<import('../types').JmapAttachment[]> {
    throw new Error('Method not implemented.')
  }

  async getEmails(accountId: string, emailIds: string[]): Promise<JmapEmail[]> {
    void accountId
    return emailIds.map((id) => ({
      id,
      blobId: `blob-${id}`,
      threadId: `thread-${id}`,
      sender: [{ name: 'Test', email: 'test@example.com' }],
      from: [{ name: 'Test', email: 'test@example.com' }],
      replyTo: null,
      to: [{ name: 'Recipient', email: 'to@example.com' }],
      cc: null,
      bcc: null,
      subject: 'Test email',
      sentAt: '2023-01-01T12:00:00Z',
      receivedAt: '2023-01-01T12:01:00Z',
      size: 1024,
      preview: 'Hello world',
      hasAttachment: false,
      keywords: { $seen: true },
    }))
  }

  async getEmailChanges(
    accountId: string,
    sinceState: string,
  ): Promise<JmapDelta> {
    return {
      accountId,
      oldState: sinceState,
      newState: 'state-2',
      hasMoreChanges: false,
      created: ['email-3'],
      updated: [],
      destroyed: [],
    }
  }

  async getEmailBody(): Promise<JmapEmailBody> {
    throw new Error('Method not implemented.')
  }
  async updateEmailKeywords(): Promise<void> {
    throw new Error('Method not implemented.')
  }
  async updateEmailMailboxes(): Promise<void> {
    throw new Error('Method not implemented.')
  }
  async submitEmail(): Promise<{ emailId: string; submissionId: string }> {
    throw new Error('Method not implemented.')
  }

  onStateChange(callback: (change: JmapStateChange) => void): () => void {
    // Fake implementation that simulates an immediate state change
    const timer = setTimeout(() => {
      callback({
        changed: {
          'account-1': {
            Email: 'state-2',
          },
        },
      })
    }, 10)
    return () => clearTimeout(timer)
  }
}

describe('FakeJmapClient contract tests', () => {
  it('should successfully open session and return typed data', async () => {
    const client = new FakeJmapClient()
    const session = await client.openSession()
    expect(session.primaryAccounts['urn:ietf:params:jmap:mail']).toBe(
      'account-1',
    )
  })

  it('should throw JmapAuthError when authentication fails', async () => {
    const client = new FakeJmapClient()
    client.throwAuthError = true
    await expect(client.openSession()).rejects.toThrow(JmapAuthError)
  })

  it('should fetch and normalize mailboxes', async () => {
    const client = new FakeJmapClient()
    const mailboxes = await client.getMailboxes('account-1')
    expect(mailboxes).toHaveLength(1)
    expect(mailboxes[0].role).toBe('inbox')
    expect(mailboxes[0].rights.mayReadItems).toBe(true)
  })

  it('should get emails with mapped metadata', async () => {
    const client = new FakeJmapClient()
    const emails = await client.getEmails('account-1', ['email-1'])
    expect(emails).toHaveLength(1)
    expect(emails[0].keywords['$seen']).toBe(true)
  })

  it('should trigger state change callback', async () => {
    const client = new FakeJmapClient()
    const callback = vi.fn()

    client.onStateChange(callback)

    // Wait for the simulated setTimeout in FakeJmapClient
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith({
      changed: {
        'account-1': {
          Email: 'state-2',
        },
      },
    })
  })
})
