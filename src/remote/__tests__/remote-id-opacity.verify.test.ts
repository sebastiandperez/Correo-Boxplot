import { describe, it, expect } from 'vitest'
import {
  remoteAccountIdFromString,
  remoteBlobIdFromString,
  remoteEmailIdFromString,
  remoteIdentityIdFromString,
  remoteMailboxIdFromString,
  remoteThreadIdFromString,
} from '../types'
import {
  localEmailId,
  localIdentityId,
  localMailboxId,
} from '../compat/domain-ids'
import { accountKeyFromString } from '../../domain/ids'

describe('V2 — Remote ID Opacity', () => {
  const unusualIds = [
    'remote-email-α',
    'opaque/42',
    'x:y:z',
    'INBOX|7|999',
    '{"uidValidity":7,"uid":42}',
    '🔥-remote-id',
    '000000',
    'a b c',
  ]

  it('V2-01: Empty IDs rejected where contract requires non-empty', () => {
    expect(() => remoteAccountIdFromString('')).toThrow(TypeError)
    expect(() => remoteMailboxIdFromString('')).toThrow(TypeError)
    expect(() => remoteEmailIdFromString('')).toThrow(TypeError)
    expect(() => remoteIdentityIdFromString('')).toThrow(TypeError)
    expect(() => remoteThreadIdFromString('')).toThrow(TypeError)
    expect(() => remoteBlobIdFromString('')).toThrow(TypeError)
  })

  it('V2-02: Exact preservation without trimming, lowercasing, parsing, or prefix interpretation', () => {
    for (const raw of unusualIds) {
      const emailId = remoteEmailIdFromString(raw)
      expect(emailId).toBe(raw)

      const mbxId = remoteMailboxIdFromString(raw)
      expect(mbxId).toBe(raw)

      const identityId = remoteIdentityIdFromString(raw)
      expect(identityId).toBe(raw)
    }

    // Explicit space preservation check
    const padded = '  spaced-id  '
    expect(remoteEmailIdFromString(padded)).toBe(padded)
    const upper = 'UPPER_CASE_ID'
    expect(remoteEmailIdFromString(upper)).toBe(upper)
  })

  it('V2-03: Same textual RemoteEmailId under Account A and Account B becomes two distinct ScopedEmailIds', () => {
    const rawId = 'INBOX|7|999'
    const remoteId = remoteEmailIdFromString(rawId)
    const accountA = accountKeyFromString('account-a')
    const accountB = accountKeyFromString('account-b')

    const scopedA = localEmailId(accountA, remoteId)
    const scopedB = localEmailId(accountB, remoteId)

    expect(scopedA.accountKey).toBe(accountA)
    expect(scopedB.accountKey).toBe(accountB)
    expect(scopedA.jmapId).toBe(rawId)
    expect(scopedB.jmapId).toBe(rawId)
    expect(scopedA).not.toEqual(scopedB)
  })

  it('V2-04: Compatibility mapper preserves "INBOX|7|999" EXACTLY', () => {
    const rawId = 'INBOX|7|999'
    const account = accountKeyFromString('acc-1')

    const emailScoped = localEmailId(account, remoteEmailIdFromString(rawId))
    expect(emailScoped.jmapId).toBe(rawId)

    const mailboxScoped = localMailboxId(
      account,
      remoteMailboxIdFromString(rawId),
    )
    expect(mailboxScoped.jmapId).toBe(rawId)

    const identityScoped = localIdentityId(
      account,
      remoteIdentityIdFromString(rawId),
    )
    expect(identityScoped.jmapId).toBe(rawId)
  })
})
