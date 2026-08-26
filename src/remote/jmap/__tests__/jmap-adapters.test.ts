import { describe, expect, it, vi } from 'vitest'
import type { JmapClient } from '../../../jmap/client'
import {
  JmapAuthError,
  JmapSubmissionAmbiguousError,
} from '../../../jmap/errors'
import type { JmapEmail, JmapSession } from '../../../jmap/types'
import { RemoteError } from '../../errors'
import {
  remoteAccountIdFromString,
  remoteEmailIdFromString,
  remoteIdentityIdFromString,
  remoteMailboxIdFromString,
  remoteSyncStateFromString,
} from '../../types'
import type { SubmissionMessage } from '../../submission-message'
import { JmapRemoteConnection } from '../jmap-connection'
import { JmapRemoteMail } from '../jmap-remote-mail'
import { JmapSubmission } from '../jmap-submission'

function rawEmail(id: string): JmapEmail {
  return {
    id,
    blobId: `blob-${id}`,
    threadId: `thread-${id}`,
    sender: null,
    from: [{ name: 'Sender', email: 'sender@example.test' }],
    replyTo: null,
    to: [{ name: null, email: 'to@example.test' }],
    cc: [],
    bcc: null,
    subject: id,
    sentAt: null,
    receivedAt: '2026-01-01T00:00:00Z',
    size: 1,
    preview: '',
    hasAttachment: false,
    keywords: { custom: true },
    mailboxIds: ['inbox'],
  }
}

function client(overrides: Partial<JmapClient> = {}): JmapClient {
  const unsupported = (name: string) => () => {
    throw new Error(`Unexpected JMAP call: ${name}`)
  }
  return {
    openSession: unsupported('openSession'),
    getMailboxes: unsupported('getMailboxes'),
    getIdentities: unsupported('getIdentities'),
    queryEmails: unsupported('queryEmails'),
    getEmails: unsupported('getEmails'),
    getEmailChanges: unsupported('getEmailChanges'),
    getEmailQueryChanges: unsupported('getEmailQueryChanges'),
    getEmailBody: unsupported('getEmailBody'),
    getEmailAttachments: unsupported('getEmailAttachments'),
    updateEmailKeywords: unsupported('updateEmailKeywords'),
    updateEmailMailboxes: unsupported('updateEmailMailboxes'),
    submitEmail: unsupported('submitEmail'),
    onStateChange: unsupported('onStateChange'),
    ...overrides,
  } as JmapClient
}

const account = remoteAccountIdFromString('account')

describe('JMAP remote adapters', () => {
  it('maps Identity and Mailbox snapshots to protocol-neutral replace transitions', async () => {
    const adapter = new JmapRemoteMail(
      client({
        getIdentities: vi.fn(async () => ({
          state: 'identity-state',
          identities: [
            {
              id: 'identity',
              name: 'Alice',
              email: 'alice@example.test',
              replyTo: null,
              bcc: [],
              htmlSignature: '',
              textSignature: '',
            },
          ],
        })),
        getMailboxes: vi.fn(async () => ({
          state: 'mailbox-state',
          mailboxes: [
            {
              id: 'inbox',
              name: 'Inbox',
              parent: null,
              role: 'inbox',
              sortOrder: 0,
              totalEmails: 0,
              unreadEmails: 0,
              rights: {
                mayReadItems: true,
                mayAddItems: true,
                mayRemoveItems: true,
                maySetSeen: true,
                maySetKeywords: true,
                maySubmit: true,
              },
            },
          ],
        })),
      }),
    )
    await expect(adapter.syncIdentities(account, null)).resolves.toMatchObject({
      mode: 'replace',
      state: 'identity-state',
      snapshot: [{ id: 'identity' }],
    })
    await expect(adapter.syncMailboxes(account, null)).resolves.toMatchObject({
      mode: 'replace',
      state: 'mailbox-state',
      snapshot: [{ id: 'inbox' }],
    })
  })

  it('owns exhaustive 1201-email pagination and returns one complete replacement', async () => {
    const ids = Array.from({ length: 1201 }, (_, index) => `email-${index}`)
    const queryEmails = vi.fn<JmapClient['queryEmails']>(
      async (_account, _mailbox, _filter, options) => {
        const position = options?.position ?? 0
        return {
          ids: ids.slice(position, position + (options?.limit ?? 500)),
          queryState: 'query-stable',
          total: ids.length,
          position,
          canCalculateChanges: true,
        }
      },
    )
    const getEmails = vi.fn<JmapClient['getEmails']>(
      async (_account, batch) => ({
        emails: batch.map(rawEmail),
        state: 'email-state',
      }),
    )
    const adapter = new JmapRemoteMail(
      client({
        getMailboxes: vi.fn(async () => ({
          state: 'mailbox-state',
          mailboxes: [
            {
              id: 'inbox',
              name: 'Inbox',
              parent: null,
              role: 'inbox',
              sortOrder: 0,
              totalEmails: 1201,
              unreadEmails: 0,
              rights: {
                mayReadItems: true,
                mayAddItems: true,
                mayRemoveItems: true,
                maySetSeen: true,
                maySetKeywords: true,
                maySubmit: true,
              },
            },
          ],
        })),
        queryEmails,
        getEmails,
      }),
    )
    const result = await adapter.syncEmails(account, null)
    expect(result.mode).toBe('replace')
    if (result.mode !== 'replace') throw new Error('expected replacement')
    expect(result.snapshot).toHaveLength(1201)
    expect(queryEmails.mock.calls.map((call) => call[3]?.position)).toEqual([
      0, 500, 1000,
    ])
    expect(getEmails.mock.calls.map((call) => call[1].length)).toEqual([
      500, 500, 201,
    ])
  })

  it('maps an Email delta and preserves its opaque state', async () => {
    const adapter = new JmapRemoteMail(
      client({
        getEmailChanges: vi.fn(async () => ({
          accountId: 'account',
          oldState: '{old}',
          newState: 'next:opaque',
          hasMoreChanges: false,
          created: ['changed'],
          updated: [],
          destroyed: ['destroyed'],
        })),
        getEmails: vi.fn(async () => ({
          emails: [rawEmail('changed')],
          state: 'not-used',
        })),
      }),
    )
    await expect(
      adapter.syncEmails(account, remoteSyncStateFromString('{old}')),
    ).resolves.toMatchObject({
      mode: 'delta',
      state: 'next:opaque',
      changed: [{ id: 'changed' }],
      destroyed: ['destroyed'],
    })
  })

  it('normalizes bodies, attachments, keyword changes, and membership changes', async () => {
    const updateEmailKeywords = vi.fn(async () => {})
    const updateEmailMailboxes = vi.fn(async () => {})
    const adapter = new JmapRemoteMail(
      client({
        getEmailBody: vi.fn(async () => ({
          emailId: 'email',
          text: null,
          html: '<p>body</p>',
        })),
        getEmailAttachments: vi.fn(async () => [
          {
            blobId: 'blob',
            partId: 'part',
            name: null,
            mediaType: 'image/png',
            size: 1,
            disposition: 'inline',
            cid: 'logo',
          },
        ]),
        updateEmailKeywords,
        updateEmailMailboxes,
      }),
    )
    const email = remoteEmailIdFromString('email')
    await expect(adapter.fetchBody(account, email)).resolves.toEqual({
      kind: 'plain',
      text: null,
      html: '<p>body</p>',
    })
    await expect(
      adapter.fetchAttachments(account, email),
    ).resolves.toMatchObject([{ blobId: 'blob', partId: 'part', cid: 'logo' }])
    await adapter.applyKeywordChange(account, email, {
      add: ['$seen'],
      remove: ['$flagged'],
    })
    await adapter.applyMembershipChange(account, email, {
      add: [remoteMailboxIdFromString('archive')],
      remove: [remoteMailboxIdFromString('inbox')],
    })
    expect(updateEmailKeywords).toHaveBeenCalledWith('account', 'email', {
      $seen: true,
      $flagged: false,
    })
    expect(updateEmailMailboxes).toHaveBeenCalledWith('account', 'email', {
      archive: true,
      inbox: false,
    })
  })

  it('maps JMAP submission success and ambiguous transport failure', async () => {
    const message: SubmissionMessage = {
      remoteAccountId: account,
      remoteIdentityId: remoteIdentityIdFromString('identity'),
      from: { name: 'Alice', email: 'alice@example.test' },
      to: [{ name: null, email: 'bob@example.test' }],
      cc: [],
      bcc: [],
      replyTo: [],
      subject: 'Hello',
      body: { kind: 'plain', text: 'body', html: null },
    }
    const ok = new JmapSubmission(
      client({
        submitEmail: vi.fn(async () => ({
          emailId: 'sent-email',
          submissionId: 'receipt',
        })),
      }),
    )
    await expect(ok.submit(message, 'mutation')).resolves.toEqual({
      kind: 'accepted',
      remoteEmailId: 'sent-email',
      receiptId: 'receipt',
    })

    const ambiguous = new JmapSubmission(
      client({
        submitEmail: vi.fn(async () => {
          throw new JmapSubmissionAmbiguousError('lost response')
        }),
      }),
    )
    const failure = await ambiguous
      .submit(message, 'mutation')
      .catch((error) => error)
    expect(failure).toBeInstanceOf(RemoteError)
    expect(failure).toMatchObject({
      kind: 'network',
      retry: 'reconcile',
      outcome: 'unknown',
    })
  })

  it('maps authentication failure to session expiration', async () => {
    const adapter = new JmapRemoteMail(
      client({
        getIdentities: vi.fn(async () => {
          throw new JmapAuthError()
        }),
      }),
    )
    const failure = await adapter
      .syncIdentities(account, null)
      .catch((error) => error)
    expect(failure).toMatchObject({
      kind: 'auth',
      retry: 'never',
      session: 'expire',
      outcome: 'knownNotApplied',
    })
  })

  it('opens a protocol-neutral session without exposing tokens or URLs', async () => {
    const session: JmapSession = {
      apiUrl: 'https://example.test/api',
      downloadUrl: 'https://example.test/download',
      uploadUrl: 'https://example.test/upload',
      eventSourceUrl: 'https://example.test/events',
      webSocketUrl: null,
      primaryAccounts: { 'urn:ietf:params:jmap:mail': 'account' },
      capabilities: {},
    }
    const opened = await new JmapRemoteConnection(
      client({ openSession: vi.fn(async () => session) }),
    ).open()
    expect(opened.accounts).toEqual([
      {
        id: 'account',
        capabilities: ['urn:ietf:params:jmap:mail'],
      },
    ])
    expect(JSON.stringify(opened)).not.toContain('apiUrl')
    expect(JSON.stringify(opened)).not.toContain('token')
  })
})
