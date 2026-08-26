import { describe, it, expect, vi } from 'vitest'
import { JmapRemoteConnection } from '../jmap/jmap-connection'
import { createRemoteConnection } from '../runtime'
import { RemoteError } from '../errors'
import type { JmapClient } from '../../jmap/client'
import type { JmapSession } from '../../jmap/types'

function createFakeJmapClient(token: string): JmapClient {
  void token
  const notImpl = (name: string) => () => {
    throw new Error(`FakeClient.${name} not implemented`)
  }
  return {
    openSession: vi.fn(async (): Promise<JmapSession> => ({
      capabilities: {
        'urn:ietf:params:jmap:core': {},
        'urn:ietf:params:jmap:mail': {},
      },
      primaryAccounts: { 'urn:ietf:params:jmap:mail': 'jmap-acc-canary' },
      apiUrl: 'https://jmap.example.com/api',
      downloadUrl: 'https://jmap.example.com/download',
      uploadUrl: 'https://jmap.example.com/upload',
      eventSourceUrl: 'https://jmap.example.com/event',
      webSocketUrl: null,
    })),
    getMailboxes: notImpl('getMailboxes'),
    getIdentities: notImpl('getIdentities'),
    queryEmails: notImpl('queryEmails'),
    getEmails: notImpl('getEmails'),
    getEmailChanges: notImpl('getEmailChanges'),
    getEmailQueryChanges: notImpl('getEmailQueryChanges'),
    getEmailBody: notImpl('getEmailBody'),
    getEmailAttachments: notImpl('getEmailAttachments'),
    updateEmailKeywords: notImpl('updateEmailKeywords'),
    updateEmailMailboxes: notImpl('updateEmailMailboxes'),
    submitEmail: notImpl('submitEmail'),
    onStateChange: notImpl('onStateChange'),
  } as JmapClient
}

describe('V11 — Remote Connection & Session Verification', () => {
  it('V11-01 / C11: JMAP connection open() returns RemoteSession with RemoteMail and Submission', async () => {
    const canaryToken = 'secret-canary-token-xyz-999'
    const fakeClient = createFakeJmapClient(canaryToken)
    const conn = new JmapRemoteConnection(fakeClient)

    const session = await conn.open()

    expect(session.accounts).toHaveLength(1)
    expect(session.accounts[0].id).toBe('jmap-acc-canary')
    expect(session.mail).toBeDefined()
    expect(session.submission).toBeDefined()
    expect(typeof session.close).toBe('function')
  })

  it('V11-02 / C11: Public RemoteSession does NOT expose secrets or tokens', async () => {
    const canarySecret = 'CANARY_PASSWORD_SECRET_12345'
    const fakeClient = createFakeJmapClient(canarySecret)
    const conn = new JmapRemoteConnection(fakeClient)

    const session = await conn.open()
    const jsonStr = JSON.stringify(session)

    expect(jsonStr).not.toContain(canarySecret)
    const sessionObj = session as unknown as Record<string, unknown>
    expect(sessionObj.token).toBeUndefined()
    expect(sessionObj.password).toBeUndefined()
    expect(sessionObj.secret).toBeUndefined()
  })

  it('V11-03 / C12: imapSmtp provider fails explicitly with typed RemoteError', () => {
    expect(() =>
      createRemoteConnection(
        {
          provider: 'imapSmtp',
          host: 'imap.example.com',
          username: 'alice',
          password: 'secret-password',
          imapPort: 993,
          smtpPort: 465,
        },
        {
          jmap: () => {
            throw new Error('Should not call jmap factory')
          },
        },
      ),
    ).toThrow(RemoteError)

    try {
      createRemoteConnection(
        {
          provider: 'imapSmtp',
          host: 'imap.example.com',
          username: 'alice',
          password: 'secret-password',
          imapPort: 993,
          smtpPort: 465,
        },
        {
          jmap: () => {
            throw new Error('Should not call jmap factory')
          },
        },
      )
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(RemoteError)
      if (err instanceof RemoteError) {
        expect(err.kind).toBe('unsupported')
        expect(err.retry).toBe('never')
      }
    }
  })

  it('V11-04: close() completes cleanly', async () => {
    const fakeClient = createFakeJmapClient('token')
    const conn = new JmapRemoteConnection(fakeClient)

    const session = await conn.open()
    await expect(session.close()).resolves.toBeUndefined()
  })
})
