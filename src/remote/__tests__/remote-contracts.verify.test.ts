import { describe, it, expect } from 'vitest'
import type {
  RemoteCollectionSync,
  RemoteKeywordChange,
  RemoteMail,
  RemoteMailboxQuery,
  RemoteMembershipChange,
  RemoteQueryOptions,
} from '../mail'
import { validateRemoteCollectionSync } from '../mail'
import type { RemoteBody } from '../body'
import type {
  RemoteAccountId,
  RemoteAttachment,
  RemoteEmail,
  RemoteEmailId,
  RemoteIdentity,
  RemoteIdentityId,
  RemoteMailbox,
  RemoteMailboxId,
  RemoteSyncState,
} from '../types'
import {
  remoteAccountIdFromString,
  remoteBlobIdFromString,
  remoteEmailIdFromString,
  remoteIdentityIdFromString,
  remoteMailboxIdFromString,
  remoteSyncStateFromString,
  remoteThreadIdFromString,
} from '../types'

/** Independent Fake Adapter created specifically for verification tests */
class IndependentFakeRemoteMail implements RemoteMail {
  identitiesState: RemoteSyncState = remoteSyncStateFromString('id-state-1')
  identities: RemoteIdentity[] = []

  mailboxesState: RemoteSyncState = remoteSyncStateFromString('mbx-state-1')
  mailboxes: RemoteMailbox[] = []

  emailsState: RemoteSyncState = remoteSyncStateFromString('email-state-1')
  emails: RemoteEmail[] = []

  bodies = new Map<string, RemoteBody>()
  attachments = new Map<string, RemoteAttachment[]>()

  async syncIdentities(
    accountId: RemoteAccountId,
    previousState: RemoteSyncState | null,
  ): Promise<RemoteCollectionSync<RemoteIdentity, RemoteIdentityId>> {
    void accountId
    void previousState
    return validateRemoteCollectionSync(
      {
        mode: 'replace',
        state: this.identitiesState,
        snapshot: this.identities,
      },
      (i) => i.id,
    )
  }

  async syncMailboxes(
    accountId: RemoteAccountId,
    previousState: RemoteSyncState | null,
  ): Promise<RemoteCollectionSync<RemoteMailbox, RemoteMailboxId>> {
    void accountId
    void previousState
    return validateRemoteCollectionSync(
      {
        mode: 'replace',
        state: this.mailboxesState,
        snapshot: this.mailboxes,
      },
      (m) => m.id,
    )
  }

  async syncEmails(
    accountId: RemoteAccountId,
    previousState: RemoteSyncState | null,
  ): Promise<RemoteCollectionSync<RemoteEmail, RemoteEmailId>> {
    void accountId
    void previousState
    return validateRemoteCollectionSync(
      {
        mode: 'replace',
        state: this.emailsState,
        snapshot: this.emails,
      },
      (e) => e.id,
    )
  }

  async queryMailbox(
    accountId: RemoteAccountId,
    mailboxId: RemoteMailboxId,
    filter?: unknown,
    options?: RemoteQueryOptions,
  ): Promise<RemoteMailboxQuery> {
    void accountId
    void mailboxId
    void filter
    void options
    return {
      ids: this.emails.map((e) => e.id),
      queryState: this.emailsState,
      total: this.emails.length,
      position: 0,
      canCalculateChanges: true,
    }
  }

  async fetchBody(
    accountId: RemoteAccountId,
    emailId: RemoteEmailId,
  ): Promise<RemoteBody> {
    void accountId
    const body = this.bodies.get(emailId)
    if (!body) throw new Error(`Body for ${emailId} not found`)
    return body
  }

  async fetchAttachments(
    accountId: RemoteAccountId,
    emailId: RemoteEmailId,
  ): Promise<readonly RemoteAttachment[]> {
    void accountId
    return this.attachments.get(emailId) ?? []
  }

  async applyKeywordChange(
    accountId: RemoteAccountId,
    emailId: RemoteEmailId,
    change: RemoteKeywordChange,
  ): Promise<void> {
    void accountId
    void emailId
    void change
  }

  async applyMembershipChange(
    accountId: RemoteAccountId,
    emailId: RemoteEmailId,
    change: RemoteMembershipChange,
  ): Promise<void> {
    void accountId
    void emailId
    void change
  }
}

const ACCOUNT_ID = remoteAccountIdFromString('acct-1')

describe('V4 — Remote Mail Contract & Validation', () => {
  it('V4-01: complete replace snapshot produces validated collections', async () => {
    const fake = new IndependentFakeRemoteMail()
    fake.identities = [
      {
        id: remoteIdentityIdFromString('id-1'),
        name: 'Alice',
        email: 'alice@example.com',
        replyTo: null,
        bcc: null,
      },
    ]
    fake.mailboxes = [
      {
        id: remoteMailboxIdFromString('mbx-inbox'),
        name: 'Inbox',
        parent: null,
        role: 'inbox',
        sortOrder: 1,
        totalEmails: 1,
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
    ]

    const idSync = await fake.syncIdentities(ACCOUNT_ID, null)
    expect(idSync.mode).toBe('replace')
    if (idSync.mode === 'replace') {
      expect(idSync.snapshot).toHaveLength(1)
      expect(idSync.snapshot[0].email).toBe('alice@example.com')
    }

    const mbxSync = await fake.syncMailboxes(ACCOUNT_ID, null)
    expect(mbxSync.mode).toBe('replace')
    if (mbxSync.mode === 'replace') {
      expect(mbxSync.snapshot).toHaveLength(1)
      expect(mbxSync.snapshot[0].name).toBe('Inbox')
    }
  })

  it('V4-02: empty replace returns exact empty collection and state', async () => {
    const fake = new IndependentFakeRemoteMail()
    fake.emailsState = remoteSyncStateFromString('server-empty-state-42')
    fake.emails = []

    const sync = await fake.syncEmails(ACCOUNT_ID, null)
    expect(sync.mode).toBe('replace')
    if (sync.mode === 'replace') {
      expect(sync.snapshot).toHaveLength(0)
      expect(sync.state).toBe('server-empty-state-42')
    }
  })

  it('V4-03: delta sync transition validation', () => {
    const e2: RemoteEmail = {
      id: remoteEmailIdFromString('E2'),
      blobId: remoteBlobIdFromString('b2'),
      threadId: remoteThreadIdFromString('t2'),
      sender: null,
      from: null,
      replyTo: null,
      to: null,
      cc: null,
      bcc: null,
      subject: 'E2 updated',
      sentAt: null,
      receivedAt: '2026-01-01T00:00:00Z',
      size: 10,
      preview: 'p2',
      hasAttachment: false,
      keywords: new Set(['$seen']),
      mailboxIds: [remoteMailboxIdFromString('inbox')],
    }
    const e4: RemoteEmail = {
      id: remoteEmailIdFromString('E4'),
      blobId: remoteBlobIdFromString('b4'),
      threadId: remoteThreadIdFromString('t4'),
      sender: null,
      from: null,
      replyTo: null,
      to: null,
      cc: null,
      bcc: null,
      subject: 'E4 new',
      sentAt: null,
      receivedAt: '2026-01-01T00:00:00Z',
      size: 20,
      preview: 'p4',
      hasAttachment: false,
      keywords: new Set(),
      mailboxIds: [remoteMailboxIdFromString('inbox')],
    }

    const transition: RemoteCollectionSync<RemoteEmail, RemoteEmailId> = {
      mode: 'delta',
      state: remoteSyncStateFromString('state-delta-1'),
      changed: [e2, e4],
      destroyed: [remoteEmailIdFromString('E1')],
    }

    const validated = validateRemoteCollectionSync(transition, (e) => e.id)
    expect(validated.mode).toBe('delta')
    if (validated.mode === 'delta') {
      expect(validated.changed).toHaveLength(2)
      expect(validated.destroyed).toHaveLength(1)
      expect(validated.destroyed[0]).toBe('E1')
    }
  })

  it('V4-04: duplicate changed IDs in RemoteCollectionSync throw TypeError', () => {
    const e1: RemoteEmail = {
      id: remoteEmailIdFromString('E1'),
      blobId: remoteBlobIdFromString('b1'),
      threadId: remoteThreadIdFromString('t1'),
      sender: null,
      from: null,
      replyTo: null,
      to: null,
      cc: null,
      bcc: null,
      subject: 'E1',
      sentAt: null,
      receivedAt: '2026-01-01T00:00:00Z',
      size: 10,
      preview: 'p1',
      hasAttachment: false,
      keywords: new Set(),
      mailboxIds: [remoteMailboxIdFromString('inbox')],
    }

    const transition: RemoteCollectionSync<RemoteEmail, RemoteEmailId> = {
      mode: 'replace',
      state: remoteSyncStateFromString('s1'),
      snapshot: [e1, e1], // Duplicate E1
    }

    expect(() => validateRemoteCollectionSync(transition, (e) => e.id)).toThrow(
      TypeError,
    )
  })

  it('V4-05: changed and destroyed overlap in delta throws TypeError', () => {
    const e1: RemoteEmail = {
      id: remoteEmailIdFromString('E1'),
      blobId: remoteBlobIdFromString('b1'),
      threadId: remoteThreadIdFromString('t1'),
      sender: null,
      from: null,
      replyTo: null,
      to: null,
      cc: null,
      bcc: null,
      subject: 'E1',
      sentAt: null,
      receivedAt: '2026-01-01T00:00:00Z',
      size: 10,
      preview: 'p1',
      hasAttachment: false,
      keywords: new Set(),
      mailboxIds: [remoteMailboxIdFromString('inbox')],
    }

    const transition: RemoteCollectionSync<RemoteEmail, RemoteEmailId> = {
      mode: 'delta',
      state: remoteSyncStateFromString('s1'),
      changed: [e1],
      destroyed: [remoteEmailIdFromString('E1')], // Overlap E1
    }

    expect(() => validateRemoteCollectionSync(transition, (e) => e.id)).toThrow(
      TypeError,
    )
  })

  it('V4-06: multiple mailbox memberships survive on single RemoteEmail', () => {
    const mbx1 = remoteMailboxIdFromString('Inbox')
    const mbx2 = remoteMailboxIdFromString('Important')

    const email: RemoteEmail = {
      id: remoteEmailIdFromString('E-multi'),
      blobId: remoteBlobIdFromString('b-multi'),
      threadId: remoteThreadIdFromString('t-multi'),
      sender: null,
      from: null,
      replyTo: null,
      to: null,
      cc: null,
      bcc: null,
      subject: 'Multi-membership',
      sentAt: null,
      receivedAt: '2026-01-01T00:00:00Z',
      size: 100,
      preview: 'multi',
      hasAttachment: false,
      keywords: new Set(['$seen']),
      mailboxIds: [mbx1, mbx2],
    }

    expect(email.mailboxIds).toHaveLength(2)
    expect(email.mailboxIds).toContain(mbx1)
    expect(email.mailboxIds).toContain(mbx2)
  })

  it('V4-07: custom keywords survive unchanged', () => {
    const keywords = new Set([
      '$seen',
      '$flagged',
      'custom-keyword',
      'weird/custom:keyword',
    ])
    const email: RemoteEmail = {
      id: remoteEmailIdFromString('E-kw'),
      blobId: remoteBlobIdFromString('b-kw'),
      threadId: remoteThreadIdFromString('t-kw'),
      sender: null,
      from: null,
      replyTo: null,
      to: null,
      cc: null,
      bcc: null,
      subject: 'Keywords',
      sentAt: null,
      receivedAt: '2026-01-01T00:00:00Z',
      size: 100,
      preview: 'kw',
      hasAttachment: false,
      keywords,
      mailboxIds: [remoteMailboxIdFromString('inbox')],
    }

    expect(email.keywords.has('$seen')).toBe(true)
    expect(email.keywords.has('$flagged')).toBe(true)
    expect(email.keywords.has('custom-keyword')).toBe(true)
    expect(email.keywords.has('weird/custom:keyword')).toBe(true)
  })

  it('V4-08: RemoteBody plain variants (text only, html only, text+html, null/null)', () => {
    const plainTextOnly: RemoteBody = {
      kind: 'plain',
      text: 'Hello',
      html: null,
    }
    const plainHtmlOnly: RemoteBody = {
      kind: 'plain',
      text: null,
      html: '<p>Hello</p>',
    }
    const plainBoth: RemoteBody = {
      kind: 'plain',
      text: 'Hello',
      html: '<p>Hello</p>',
    }
    const plainNeither: RemoteBody = { kind: 'plain', text: null, html: null }

    expect(plainTextOnly.kind).toBe('plain')
    expect(plainHtmlOnly.kind).toBe('plain')
    expect(plainBoth.kind).toBe('plain')
    expect(plainNeither.kind).toBe('plain')
  })

  it('V4-09: RemoteBody E2EE transport payload remains opaque without decryption', () => {
    const rawPayload = '{"encryptedData":"xyz123","nonce":"abc"}'
    const e2eeBody: RemoteBody = {
      kind: 'boxplotE2ee',
      contentType: 'application/vnd.boxplot.e2ee+json',
      payload: rawPayload,
    }

    expect(e2eeBody.kind).toBe('boxplotE2ee')
    expect(e2eeBody.payload).toBe(rawPayload)
  })

  it('V4-10: RemoteAttachment metadata preserves null/empty distinctions', () => {
    const att: RemoteAttachment = {
      blobId: remoteBlobIdFromString('blob-att-1'),
      partId: 'part-1',
      name: 'doc.pdf',
      mediaType: 'application/pdf',
      size: 2048,
      disposition: 'attachment',
      cid: null,
    }

    expect(att.partId).toBe('part-1')
    expect(att.cid).toBeNull()
    expect(att.mediaType).toBe('application/pdf')
    expect(att.size).toBe(2048)
  })
})
