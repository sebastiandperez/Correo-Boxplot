import { describe, expect, it } from 'vitest'

import { account, remoteAccountRef, type Account } from '../account'
import {
  accountKeyFromString,
  jmapAccountIdFromString,
  jmapBlobIdFromString,
  jmapEmailIdFromString,
  jmapIdentityIdFromString,
  jmapMailboxIdFromString,
  jmapThreadIdFromString,
  mutationIdFromString,
  scopedEmailId,
  scopedIdentityId,
  scopedMailboxId,
  serviceKeyFromString,
  type AccountKey,
  type JmapAccountId,
  type JmapBlobId,
  type JmapEmailId,
  type JmapIdentityId,
  type JmapMailboxId,
  type JmapThreadId,
  type MutationId,
  type ScopedEmailId,
  type ScopedIdentityId,
  type ScopedMailboxId,
  type ServiceKey,
} from '../ids'

describe('D-01 compile-time invariants', () => {
  it('keeps raw strings and atomic ID categories incompatible', () => {
    const raw = 'raw-id'
    const accountKey = accountKeyFromString('account')
    const serviceKey = serviceKeyFromString('service')
    const mutationId = mutationIdFromString('mutation')
    const jmapAccountId = jmapAccountIdFromString('jmap-account')
    const jmapMailboxId = jmapMailboxIdFromString('mailbox')
    const jmapEmailId = jmapEmailIdFromString('email')
    const jmapIdentityId = jmapIdentityIdFromString('identity')
    const jmapThreadId = jmapThreadIdFromString('thread')
    const jmapBlobId = jmapBlobIdFromString('blob')

    // @ts-expect-error A raw string must not be assignable to AccountKey.
    const rawAccountKey: AccountKey = raw
    // @ts-expect-error A raw string must not be assignable to ServiceKey.
    const rawServiceKey: ServiceKey = raw
    // @ts-expect-error A raw string must not be assignable to MutationId.
    const rawMutationId: MutationId = raw
    // @ts-expect-error A raw string must not be assignable to JmapAccountId.
    const rawJmapAccountId: JmapAccountId = raw
    // @ts-expect-error A raw string must not be assignable to JmapMailboxId.
    const rawJmapMailboxId: JmapMailboxId = raw
    // @ts-expect-error A raw string must not be assignable to JmapEmailId.
    const rawJmapEmailId: JmapEmailId = raw
    // @ts-expect-error A raw string must not be assignable to JmapIdentityId.
    const rawJmapIdentityId: JmapIdentityId = raw
    // @ts-expect-error A raw string must not be assignable to JmapThreadId.
    const rawJmapThreadId: JmapThreadId = raw
    // @ts-expect-error A raw string must not be assignable to JmapBlobId.
    const rawJmapBlobId: JmapBlobId = raw

    // @ts-expect-error AccountKey must not be assignable to ServiceKey.
    const accountAsService: ServiceKey = accountKey
    // @ts-expect-error ServiceKey must not be assignable to AccountKey.
    const serviceAsAccount: AccountKey = serviceKey
    // @ts-expect-error MutationId must not be assignable to JmapEmailId.
    const mutationAsEmail: JmapEmailId = mutationId
    // @ts-expect-error JmapEmailId must not be assignable to JmapMailboxId.
    const emailAsMailbox: JmapMailboxId = jmapEmailId
    // @ts-expect-error JmapMailboxId must not be assignable to JmapEmailId.
    const mailboxAsEmail: JmapEmailId = jmapMailboxId
    // @ts-expect-error JmapAccountId must not be assignable to JmapEmailId.
    const accountAsEmail: JmapEmailId = jmapAccountId

    expect([
      rawAccountKey,
      rawServiceKey,
      rawMutationId,
      rawJmapAccountId,
      rawJmapMailboxId,
      rawJmapEmailId,
      rawJmapIdentityId,
      rawJmapThreadId,
      rawJmapBlobId,
      accountAsService,
      serviceAsAccount,
      mutationAsEmail,
      emailAsMailbox,
      mailboxAsEmail,
      accountAsEmail,
      jmapIdentityId,
      jmapThreadId,
      jmapBlobId,
    ]).toHaveLength(18)
  })

  it('keeps scoped categories incompatible and readonly', () => {
    const accountKey = accountKeyFromString('account')
    const otherAccountKey = accountKeyFromString('other-account')
    const emailId = scopedEmailId(accountKey, jmapEmailIdFromString('email'))
    const mailboxId = scopedMailboxId(
      accountKey,
      jmapMailboxIdFromString('mailbox'),
    )
    const identityId = scopedIdentityId(
      accountKey,
      jmapIdentityIdFromString('identity'),
    )

    // @ts-expect-error ScopedEmailId must not be assignable to ScopedMailboxId.
    const emailAsMailbox: ScopedMailboxId = emailId
    // @ts-expect-error ScopedMailboxId must not be assignable to ScopedIdentityId.
    const mailboxAsIdentity: ScopedIdentityId = mailboxId
    // @ts-expect-error ScopedIdentityId must not be assignable to ScopedEmailId.
    const identityAsEmail: ScopedEmailId = identityId

    if (false) {
      // @ts-expect-error Scoped ID AccountKey is readonly.
      emailId.accountKey = otherAccountKey
      // @ts-expect-error Scoped ID JMAP component is readonly.
      emailId.jmapId = jmapEmailIdFromString('other-email')
    }

    expect([emailAsMailbox, mailboxAsIdentity, identityAsEmail]).toHaveLength(3)
  })

  it('requires readonly Account and RemoteAccountRef fields', () => {
    const key = accountKeyFromString('account')
    const otherKey = accountKeyFromString('other-account')
    const serviceKey = serviceKeyFromString('service')
    const otherServiceKey = serviceKeyFromString('other-service')
    const jmapAccountId = jmapAccountIdFromString('jmap-account')
    const otherJmapAccountId = jmapAccountIdFromString('other-jmap-account')
    const remoteRef = remoteAccountRef(serviceKey, jmapAccountId)
    const domainAccount = account(key, remoteRef)

    if (false) {
      // @ts-expect-error RemoteAccountRef ServiceKey is readonly.
      remoteRef.serviceKey = otherServiceKey
      // @ts-expect-error RemoteAccountRef JmapAccountId is readonly.
      remoteRef.jmapAccountId = otherJmapAccountId
      // @ts-expect-error Account key is readonly.
      domainAccount.key = otherKey
      // @ts-expect-error Account remoteRef is readonly.
      domainAccount.remoteRef = remoteAccountRef(
        otherServiceKey,
        otherJmapAccountId,
      )
    }

    // @ts-expect-error Account requires a RemoteAccountRef.
    const missingRemoteRef: Account = { key }
    // @ts-expect-error Account requires an AccountKey.
    const missingKey: Account = { remoteRef }

    expect([missingRemoteRef, missingKey]).toHaveLength(2)
  })
})
