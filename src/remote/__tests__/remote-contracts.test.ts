import { describe, expect, it } from 'vitest'
import {
  remoteAccountIdFromString,
  remoteBlobIdFromString,
  remoteEmailIdFromString,
  remoteIdentityIdFromString,
  remoteMailboxIdFromString,
  remoteSyncStateFromString,
  remoteThreadIdFromString,
} from '../types'
import { RemoteError } from '../errors'
import { localEmailId } from '../compat/domain-ids'
import { accountKeyFromString } from '../../domain/ids'
import { FakeRemoteMail, FakeSubmission } from '../testing'
import { createRemoteConnection } from '../runtime'

describe('REMOTE-BOUNDARY remote contracts', () => {
  it('constructs opaque protocol-neutral IDs and rejects empty entity IDs', () => {
    expect(remoteAccountIdFromString('opaque/42')).toBe('opaque/42')
    expect(remoteMailboxIdFromString('x:y:z')).toBe('x:y:z')
    expect(remoteEmailIdFromString('remote-email-α')).toBe('remote-email-α')
    expect(remoteIdentityIdFromString('identity')).toBe('identity')
    expect(remoteThreadIdFromString('thread')).toBe('thread')
    expect(remoteBlobIdFromString('blob')).toBe('blob')
    expect(() => remoteEmailIdFromString('')).toThrow(TypeError)
  })

  it('preserves opaque sync state including empty, JSON-looking, and colon-delimited values', () => {
    expect(remoteSyncStateFromString('')).toBe('')
    expect(remoteSyncStateFromString('{"uid":42}')).toBe('{"uid":42}')
    expect(remoteSyncStateFromString('1:2:3')).toBe('1:2:3')
  })

  it('central compatibility mapping preserves text and account scope', () => {
    const remote = remoteEmailIdFromString('opaque/42')
    const first = localEmailId(accountKeyFromString('A'), remote)
    const second = localEmailId(accountKeyFromString('B'), remote)
    expect(first.jmapId).toBe('opaque/42')
    expect(second.jmapId).toBe('opaque/42')
    expect(first.accountKey).not.toBe(second.accountKey)
  })

  it('represents auth expiration and ambiguous submission without protocol errors', () => {
    const auth = new RemoteError('auth', {
      kind: 'auth',
      retry: 'never',
      session: 'expire',
      outcome: 'knownNotApplied',
    })
    const ambiguous = new RemoteError('lost response', {
      kind: 'network',
      retry: 'reconcile',
      session: 'keep',
      outcome: 'unknown',
    })
    expect(auth.session).toBe('expire')
    expect(ambiguous.retry).toBe('reconcile')
    expect(ambiguous.outcome).toBe('unknown')
  })

  it('FakeRemoteMail supports complete replace, delta, empty snapshots, and destroyed IDs', async () => {
    const state = remoteSyncStateFromString('opaque-state')
    const emailId = remoteEmailIdFromString('remote-email-α')
    const fake = new FakeRemoteMail({
      syncEmails: async (_account, previous) =>
        previous === null
          ? { mode: 'replace', state, snapshot: [] }
          : { mode: 'delta', state, changed: [], destroyed: [emailId] },
    })
    const account = remoteAccountIdFromString('account')
    await expect(fake.syncEmails(account, null)).resolves.toEqual({
      mode: 'replace',
      state,
      snapshot: [],
    })
    await expect(fake.syncEmails(account, state)).resolves.toEqual({
      mode: 'delta',
      state,
      changed: [],
      destroyed: [emailId],
    })
  })

  it('FakeRemoteMail rejects duplicate semantic IDs in a transition', async () => {
    const identity = {
      id: remoteIdentityIdFromString('duplicate'),
      name: 'A',
      email: 'a@example.test',
      replyTo: null,
      bcc: null,
    }
    const fake = new FakeRemoteMail({
      syncIdentities: async () => ({
        mode: 'replace',
        state: remoteSyncStateFromString('state'),
        snapshot: [identity, identity],
      }),
    })
    await expect(
      fake.syncIdentities(remoteAccountIdFromString('account'), null),
    ).rejects.toThrow(/duplicate ID/)
  })

  it('Submission accepts results both with and without an immediate remote Email ID', async () => {
    const withId = new FakeSubmission(async () => ({
      kind: 'accepted',
      remoteEmailId: remoteEmailIdFromString('sent'),
      receiptId: 'receipt',
    }))
    const withoutId = new FakeSubmission(async () => ({
      kind: 'accepted',
      remoteEmailId: null,
      receiptId: 'smtp-receipt',
    }))
    const message = {
      remoteAccountId: remoteAccountIdFromString('account'),
      remoteIdentityId: null,
      from: { name: null, email: 'from@example.test' },
      to: [{ name: null, email: 'to@example.test' }],
      cc: [],
      bcc: [],
      replyTo: [],
      subject: '',
      body: { kind: 'plain' as const, text: '', html: null },
    }
    await expect(withId.submit(message, 'm1')).resolves.toMatchObject({
      remoteEmailId: 'sent',
    })
    await expect(withoutId.submit(message, 'm2')).resolves.toMatchObject({
      remoteEmailId: null,
    })
  })

  it('Remote body carries plain and Boxplot E2EE representations without decryption', () => {
    const plain = { kind: 'plain' as const, text: null, html: '<p>x</p>' }
    const encrypted = {
      kind: 'boxplotE2ee' as const,
      contentType: 'application/vnd.boxplot.e2ee+json' as const,
      payload: '{"ciphertext":"opaque"}',
    }
    expect(plain.html).toBe('<p>x</p>')
    expect(encrypted.payload).toContain('ciphertext')
  })

  it('keeps protocol selection at the runtime boundary and reports IMAP/SMTP as unsupported', () => {
    expect(() =>
      createRemoteConnection(
        {
          provider: 'imapSmtp',
          host: 'mail.example.test',
          username: 'alice',
          password: 'secret',
          imapPort: 993,
          smtpPort: 465,
        },
        { jmap: () => ({ open: async () => Promise.reject(new Error()) }) },
      ),
    ).toThrow(RemoteError)
  })
})
