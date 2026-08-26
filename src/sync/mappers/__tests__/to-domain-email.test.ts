import { describe, it, expect, vi } from 'vitest'
import { toDomainEmailRecord } from '../to-domain-email'
import { accountKeyFromString } from '../../../domain/ids'
import type { JmapEmail } from '../../../jmap/types'
import { mapJmapEmail } from '../../../remote/jmap/mappers'

const accountKey = accountKeyFromString('acc-1')

function makeRawEmail(overrides: Partial<JmapEmail> = {}): JmapEmail {
  return {
    id: 'email-1',
    blobId: 'blob-1',
    threadId: 'thread-1',
    sender: [{ name: 'Sender', email: 'sender@example.test' }],
    from: [{ name: 'Sender', email: 'sender@example.test' }],
    replyTo: null,
    to: [{ name: null, email: 'to@example.test' }],
    cc: [],
    bcc: null,
    subject: 'Hello',
    sentAt: '2026-01-01T00:00:00Z',
    receivedAt: '2026-01-01T00:01:00Z',
    size: 1024,
    preview: 'preview text',
    hasAttachment: false,
    keywords: { $seen: true, $flagged: false },
    mailboxIds: ['mailbox-1'],
    ...overrides,
  }
}

describe('toDomainEmailRecord', () => {
  it('maps a well-formed JmapEmail into an EmailSyncRecord with matching memberships', () => {
    const record = toDomainEmailRecord(accountKey, mapJmapEmail(makeRawEmail()))

    expect(record).not.toBeNull()
    expect(record?.email.id).toEqual({
      accountKey,
      jmapId: 'email-1',
    })
    expect(record?.email.subject).toBe('Hello')
    expect(record?.email.keywords.has('$seen')).toBe(true)
    // D-03: cc:[] is a non-null empty list here in JMAP terms, but the
    // Domain factory snapshots whatever was passed — cc:[] stays [].
    expect(record?.email.cc).toEqual([])
    expect(record?.email.replyTo).toBeNull()
    expect(record?.memberships).toHaveLength(1)
    expect(record?.memberships[0]).toEqual({
      emailId: { accountKey, jmapId: 'email-1' },
      mailboxId: { accountKey, jmapId: 'mailbox-1' },
    })
  })

  it('only includes keywords whose value is true', () => {
    const record = toDomainEmailRecord(
      accountKey,
      mapJmapEmail(
        makeRawEmail({ keywords: { $seen: true, $flagged: false } }),
      ),
    )

    expect(record?.email.keywords.has('$seen')).toBe(true)
    expect(record?.email.keywords.has('$flagged')).toBe(false)
  })

  it('maps one membership per mailboxId', () => {
    const record = toDomainEmailRecord(
      accountKey,
      mapJmapEmail(makeRawEmail({ mailboxIds: ['mailbox-1', 'mailbox-2'] })),
    )

    expect(record?.memberships).toHaveLength(2)
    expect(record?.memberships.map((m) => m.mailboxId.jmapId)).toEqual([
      'mailbox-1',
      'mailbox-2',
    ])
  })

  it('returns null and logs a warning when the Domain factory rejects the data (e.g. negative size)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const record = toDomainEmailRecord(
      accountKey,
      mapJmapEmail(makeRawEmail({ size: -1 })),
    )

    expect(record).toBeNull()
    expect(warnSpy).toHaveBeenCalled()
  })

  it('returns null when receivedAt is empty', () => {
    const record = toDomainEmailRecord(
      accountKey,
      mapJmapEmail(makeRawEmail({ receivedAt: '' })),
    )

    expect(record).toBeNull()
  })
})
