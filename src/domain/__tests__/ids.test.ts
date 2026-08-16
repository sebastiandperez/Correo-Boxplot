import { describe, expect, it } from 'vitest'

import {
  accountKeyFromString,
  jmapAccountIdFromString,
  jmapBlobIdFromString,
  jmapEmailIdFromString,
  jmapIdentityIdFromString,
  jmapMailboxIdFromString,
  jmapThreadIdFromString,
  mutationIdFromString,
  sameScopedBlobId,
  sameScopedEmailId,
  sameScopedIdentityId,
  sameScopedMailboxId,
  sameScopedThreadId,
  scopedBlobId,
  scopedEmailId,
  scopedIdentityId,
  scopedMailboxId,
  scopedThreadId,
  serviceKeyFromString,
} from '../ids'

const atomicFactories = [
  ['AccountKey', accountKeyFromString],
  ['ServiceKey', serviceKeyFromString],
  ['MutationId', mutationIdFromString],
  ['JmapAccountId', jmapAccountIdFromString],
  ['JmapMailboxId', jmapMailboxIdFromString],
  ['JmapEmailId', jmapEmailIdFromString],
  ['JmapIdentityId', jmapIdentityIdFromString],
  ['JmapThreadId', jmapThreadIdFromString],
  ['JmapBlobId', jmapBlobIdFromString],
] as const

describe('atomic Domain IDs', () => {
  it.each(atomicFactories)(
    '%s preserves non-empty values exactly',
    (_, factory) => {
      expect(factory('  exact value  ')).toBe('  exact value  ')
    },
  )

  it.each(atomicFactories)('%s rejects an empty value', (typeName, factory) => {
    expect(() => factory('')).toThrowError(TypeError)
    expect(() => factory('')).toThrowError(`${typeName} must not be empty`)
  })
})

describe('scoped Domain IDs', () => {
  const accountA = accountKeyFromString('account-a')
  const accountB = accountKeyFromString('account-b')

  it('compares email IDs by both AccountKey and JMAP ID', () => {
    const emailX = jmapEmailIdFromString('email-x')
    const emailY = jmapEmailIdFromString('email-y')

    expect(
      sameScopedEmailId(
        scopedEmailId(accountA, emailX),
        scopedEmailId(accountA, emailX),
      ),
    ).toBe(true)
    expect(
      sameScopedEmailId(
        scopedEmailId(accountA, emailX),
        scopedEmailId(accountA, emailY),
      ),
    ).toBe(false)
    expect(
      sameScopedEmailId(
        scopedEmailId(accountA, emailX),
        scopedEmailId(accountB, emailX),
      ),
    ).toBe(false)
  })

  it('applies value equality to every scoped ID category', () => {
    const mailbox = jmapMailboxIdFromString('mailbox')
    const identity = jmapIdentityIdFromString('identity')
    const thread = jmapThreadIdFromString('thread')
    const blob = jmapBlobIdFromString('blob')

    expect(
      sameScopedMailboxId(
        scopedMailboxId(accountA, mailbox),
        scopedMailboxId(accountA, mailbox),
      ),
    ).toBe(true)
    expect(
      sameScopedMailboxId(
        scopedMailboxId(accountA, mailbox),
        scopedMailboxId(accountB, mailbox),
      ),
    ).toBe(false)

    expect(
      sameScopedIdentityId(
        scopedIdentityId(accountA, identity),
        scopedIdentityId(accountA, identity),
      ),
    ).toBe(true)
    expect(
      sameScopedIdentityId(
        scopedIdentityId(accountA, identity),
        scopedIdentityId(accountB, identity),
      ),
    ).toBe(false)

    expect(
      sameScopedThreadId(
        scopedThreadId(accountA, thread),
        scopedThreadId(accountA, thread),
      ),
    ).toBe(true)
    expect(
      sameScopedThreadId(
        scopedThreadId(accountA, thread),
        scopedThreadId(accountB, thread),
      ),
    ).toBe(false)

    expect(
      sameScopedBlobId(
        scopedBlobId(accountA, blob),
        scopedBlobId(accountA, blob),
      ),
    ).toBe(true)
    expect(
      sameScopedBlobId(
        scopedBlobId(accountA, blob),
        scopedBlobId(accountB, blob),
      ),
    ).toBe(false)
  })
})
