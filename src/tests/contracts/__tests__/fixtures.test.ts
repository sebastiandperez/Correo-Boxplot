import { describe, expect, it } from 'vitest'

import { sameScopedBlobId, sameScopedEmailId } from '../../../domain/ids'
import { sameMailboxViewSpec } from '../../../domain/mailbox-view'
import {
  createTestAccount,
  createTestEmail,
  createTestFixtures,
} from '../fixtures'

describe('TEST-01 fixtures', () => {
  it('constructs the complete deterministic fixture set through Domain factories', () => {
    const fixtures = createTestFixtures()

    expect(fixtures.inboxA.id.accountKey).toBe(fixtures.accountA.key)
    expect(fixtures.archiveA.id.accountKey).toBe(fixtures.accountA.key)
    expect(fixtures.inboxB.id.accountKey).toBe(fixtures.accountB.key)
    expect(fixtures.identityA.id.accountKey).toBe(fixtures.accountA.key)
    expect(fixtures.membershipsA).toHaveLength(2)
    expect(fixtures.standardBodyA1).toMatchObject({
      text: 'body-text-A1',
      html: '<p>body-html-A1</p>',
    })
    expect(fixtures.nullBodyA1).toMatchObject({ text: null, html: null })
    expect(fixtures.emptyBodyA1).toMatchObject({ text: '', html: '' })
    expect(fixtures.sendMutationA).toMatchObject({
      kind: 'send',
      lifecycle: { status: 'pending' },
    })
    expect(fixtures.keywordMutationA).toMatchObject({
      kind: 'keyword',
      lifecycle: { status: 'pending' },
    })
    expect(fixtures.membershipMutationA).toMatchObject({
      kind: 'mailboxMembership',
      lifecycle: { status: 'pending' },
    })
  })

  it('keeps the same remote-like Email token distinct across Accounts', () => {
    const { accountA, accountB, emailA1, emailB1 } = createTestFixtures()

    expect(accountA.key).not.toBe(accountB.key)
    expect(emailA1.id.jmapId).toBe(emailB1.id.jmapId)
    expect(sameScopedEmailId(emailA1.id, emailB1.id)).toBe(false)
  })

  it('supports attachment, view coverage, and opaque cursor edge cases', () => {
    const fixtures = createTestFixtures()
    const [firstAttachment, secondAttachment] = fixtures.attachmentsA1

    expect(firstAttachment.partId).not.toBe(secondAttachment.partId)
    expect(
      sameScopedBlobId(firstAttachment.blobId, secondAttachment.blobId),
    ).toBe(true)
    expect(secondAttachment).toMatchObject({
      name: null,
      disposition: '',
      cid: '',
    })
    expect(fixtures.emptyInboxViewA.coverage).toEqual([])
    expect(fixtures.partialInboxViewA.coverage).toEqual([
      { start: 0, endExclusive: 2 },
    ])
    expect(fixtures.disjointInboxViewA.coverage).toEqual([
      { start: 0, endExclusive: 1 },
      { start: 3, endExclusive: 4 },
    ])
    expect(
      sameMailboxViewSpec(
        fixtures.inboxViewSpecA,
        fixtures.alternativeViewSpecA,
      ),
    ).toBe(false)
    expect(fixtures.emptyStateEmailCursorA.state).toBe('')
    expect([
      fixtures.emailCursorA.dataType,
      fixtures.mailboxCursorA.dataType,
      fixtures.identityCursorA.dataType,
    ]).toEqual(['email', 'mailbox', 'identity'])
  })

  it('returns fresh objects while preserving deterministic semantic values', () => {
    const firstAccount = createTestAccount('repeatable')
    const secondAccount = createTestAccount('repeatable')
    const firstEmail = createTestEmail(firstAccount, 'repeatable')
    const secondEmail = createTestEmail(secondAccount, 'repeatable')

    expect(firstAccount).not.toBe(secondAccount)
    expect(firstAccount).toEqual(secondAccount)
    expect(firstEmail).not.toBe(secondEmail)
    expect(firstEmail).toEqual(secondEmail)
  })
})
