import { describe, expect, it } from 'vitest'

import { emailAddress } from '../address'
import { identity } from '../identity'
import {
  accountKeyFromString,
  jmapEmailIdFromString,
  jmapIdentityIdFromString,
  jmapMailboxIdFromString,
  mutationIdFromString,
  scopedEmailId,
  scopedIdentityId,
  scopedMailboxId,
  type AccountKey,
} from '../ids'
import {
  confirmEmailUpdateMutation,
  confirmSendMutation,
  failMutationTerminal,
  keywordChange,
  keywordMutation,
  mailboxMembershipChange,
  mailboxMembershipMutation,
  mutationInstantFromString,
  samePendingMutationIdentity,
  scheduleMutationRetry,
  sendConfirmation,
  sendMutation,
  startMutationAttempt,
  type KeywordMutation,
  type MailboxMembershipMutation,
  type SendMutation,
} from '../pending-mutation'
import { sendIntent } from '../send-intent'

const accountA = accountKeyFromString('account-a')
const accountB = accountKeyFromString('account-b')

function intentFor(accountKey: AccountKey) {
  const selectedIdentity = identity({
    id: scopedIdentityId(accountKey, jmapIdentityIdFromString('identity')),
    name: 'Sender',
    email: 'sender@example.test',
    replyTo: null,
    bcc: null,
  })

  return sendIntent({
    securityMode: 'plain',
    identity: selectedIdentity,
    to: [emailAddress(null, 'recipient@example.test')],
    cc: [],
    bcc: [],
    subject: 'Subject',
    body: { text: 'Body', html: null },
  })
}

function newSend(
  accountKey: AccountKey = accountA,
  mutationIdValue = 'send-mutation',
): SendMutation {
  return sendMutation({
    mutationId: mutationIdFromString(mutationIdValue),
    accountKey,
    createdAt: mutationInstantFromString('created-at'),
    intent: intentFor(accountKey),
  })
}

function newKeyword(
  accountKey: AccountKey = accountA,
  mutationIdValue = 'keyword-mutation',
): KeywordMutation {
  return keywordMutation({
    mutationId: mutationIdFromString(mutationIdValue),
    accountKey,
    createdAt: mutationInstantFromString('created-at'),
    emailId: scopedEmailId(accountKey, jmapEmailIdFromString('email')),
    change: keywordChange({ add: new Set(['$seen']), remove: new Set() }),
  })
}

function newMembership(
  accountKey: AccountKey = accountA,
  mutationIdValue = 'membership-mutation',
): MailboxMembershipMutation {
  return mailboxMembershipMutation({
    mutationId: mutationIdFromString(mutationIdValue),
    accountKey,
    createdAt: mutationInstantFromString('created-at'),
    emailId: scopedEmailId(accountKey, jmapEmailIdFromString('email')),
    change: mailboxMembershipChange({
      add: [scopedMailboxId(accountKey, jmapMailboxIdFromString('mailbox'))],
      remove: [],
    }),
  })
}

describe('MutationInstant', () => {
  it.each(['created-at', '  Mixed CASE  ', '0', ' '])(
    'preserves %j exactly',
    (value) => {
      expect(mutationInstantFromString(value)).toBe(value)
    },
  )

  it('rejects an empty value', () => {
    expect(() => mutationInstantFromString('')).toThrowError(TypeError)
  })
})

describe('KeywordChange', () => {
  it('supports add-only, remove-only and disjoint changes', () => {
    expect(
      keywordChange({ add: new Set(['$seen']), remove: new Set() }),
    ).toEqual({ add: new Set(['$seen']), remove: new Set() })
    expect(
      keywordChange({ add: new Set(), remove: new Set(['$flagged']) }),
    ).toEqual({ add: new Set(), remove: new Set(['$flagged']) })
    expect(
      keywordChange({
        add: new Set(['$seen']),
        remove: new Set(['$flagged']),
      }),
    ).toEqual({ add: new Set(['$seen']), remove: new Set(['$flagged']) })
  })

  it('preserves custom keyword text and snapshots source sets', () => {
    const add = new Set(['  Custom-Keyword  '])
    const remove = new Set(['Other-Custom'])
    const result = keywordChange({ add, remove })

    add.add('$seen')
    remove.add('$flagged')

    expect([...result.add]).toEqual(['  Custom-Keyword  '])
    expect([...result.remove]).toEqual(['Other-Custom'])
  })

  it('rejects an empty change', () => {
    expect(() =>
      keywordChange({ add: new Set(), remove: new Set() }),
    ).toThrowError(TypeError)
  })

  it('rejects an exact add/remove intersection', () => {
    expect(() =>
      keywordChange({
        add: new Set(['Custom']),
        remove: new Set(['Custom']),
      }),
    ).toThrowError(TypeError)
  })
})

describe('MailboxMembershipChange', () => {
  const mailboxA = scopedMailboxId(
    accountA,
    jmapMailboxIdFromString('mailbox-a'),
  )
  const mailboxB = scopedMailboxId(
    accountA,
    jmapMailboxIdFromString('mailbox-b'),
  )
  const mailboxC = scopedMailboxId(
    accountA,
    jmapMailboxIdFromString('mailbox-c'),
  )

  it('supports add-only, remove-only and multi-mailbox changes', () => {
    expect(mailboxMembershipChange({ add: [mailboxA], remove: [] })).toEqual({
      add: [mailboxA],
      remove: [],
    })
    expect(mailboxMembershipChange({ add: [], remove: [mailboxA] })).toEqual({
      add: [],
      remove: [mailboxA],
    })
    expect(
      mailboxMembershipChange({
        add: [mailboxA, mailboxB],
        remove: [mailboxC],
      }),
    ).toEqual({ add: [mailboxA, mailboxB], remove: [mailboxC] })
  })

  it('snapshots source arrays while preserving their order', () => {
    const add = [mailboxA, mailboxB]
    const remove = [mailboxC]
    const result = mailboxMembershipChange({ add, remove })

    add.reverse()
    remove.push(mailboxA)

    expect(result.add).toEqual([mailboxA, mailboxB])
    expect(result.remove).toEqual([mailboxC])
  })

  it('rejects an empty change', () => {
    expect(() => mailboxMembershipChange({ add: [], remove: [] })).toThrowError(
      TypeError,
    )
  })

  it('rejects semantic duplicates within either side', () => {
    const equivalentA = scopedMailboxId(
      accountA,
      jmapMailboxIdFromString('mailbox-a'),
    )

    expect(() =>
      mailboxMembershipChange({
        add: [mailboxA, equivalentA],
        remove: [],
      }),
    ).toThrowError(TypeError)
    expect(() =>
      mailboxMembershipChange({
        add: [],
        remove: [mailboxA, equivalentA],
      }),
    ).toThrowError(TypeError)
  })

  it('rejects a semantic add/remove intersection', () => {
    const equivalentA = scopedMailboxId(
      accountA,
      jmapMailboxIdFromString('mailbox-a'),
    )

    expect(() =>
      mailboxMembershipChange({ add: [mailboxA], remove: [equivalentA] }),
    ).toThrowError(TypeError)
  })
})

describe('PendingMutation creation', () => {
  it('creates a same-account SendMutation as pending/0', () => {
    const result = newSend()

    expect(result.kind).toBe('send')
    expect(result.lifecycle).toEqual({ status: 'pending', attemptCount: 0 })
    expect(result.intent.identityId.accountKey).toBe(result.accountKey)
  })

  it('rejects a cross-account SendIntent', () => {
    expect(() =>
      sendMutation({
        mutationId: mutationIdFromString('mutation'),
        accountKey: accountA,
        createdAt: mutationInstantFromString('created-at'),
        intent: intentFor(accountB),
      }),
    ).toThrowError(TypeError)
  })

  it('creates a same-account KeywordMutation as pending/0', () => {
    const result = newKeyword()

    expect(result.kind).toBe('keyword')
    expect(result.lifecycle).toEqual({ status: 'pending', attemptCount: 0 })
    expect(result.emailId.accountKey).toBe(result.accountKey)
  })

  it('rejects a cross-account Keyword target', () => {
    expect(() =>
      keywordMutation({
        mutationId: mutationIdFromString('mutation'),
        accountKey: accountA,
        createdAt: mutationInstantFromString('created-at'),
        emailId: scopedEmailId(accountB, jmapEmailIdFromString('email')),
        change: keywordChange({ add: new Set(['$seen']), remove: new Set() }),
      }),
    ).toThrowError(TypeError)
  })

  it('creates a same-account MembershipMutation as pending/0', () => {
    const result = newMembership()

    expect(result.kind).toBe('mailboxMembership')
    expect(result.lifecycle).toEqual({ status: 'pending', attemptCount: 0 })
    expect(result.emailId.accountKey).toBe(result.accountKey)
  })

  it('rejects a cross-account Membership Email', () => {
    expect(() =>
      mailboxMembershipMutation({
        mutationId: mutationIdFromString('mutation'),
        accountKey: accountA,
        createdAt: mutationInstantFromString('created-at'),
        emailId: scopedEmailId(accountB, jmapEmailIdFromString('email')),
        change: mailboxMembershipChange({
          add: [scopedMailboxId(accountA, jmapMailboxIdFromString('mailbox'))],
          remove: [],
        }),
      }),
    ).toThrowError(TypeError)
  })

  it('rejects any cross-account Membership Mailbox', () => {
    expect(() =>
      mailboxMembershipMutation({
        mutationId: mutationIdFromString('mutation'),
        accountKey: accountA,
        createdAt: mutationInstantFromString('created-at'),
        emailId: scopedEmailId(accountA, jmapEmailIdFromString('email')),
        change: mailboxMembershipChange({
          add: [
            scopedMailboxId(accountA, jmapMailboxIdFromString('mailbox-a')),
          ],
          remove: [
            scopedMailboxId(accountB, jmapMailboxIdFromString('mailbox-b')),
          ],
        }),
      }),
    ).toThrowError(TypeError)
  })

  it('allows a removal-only Membership change without catalog lookup', () => {
    const result = mailboxMembershipMutation({
      mutationId: mutationIdFromString('mutation'),
      accountKey: accountA,
      createdAt: mutationInstantFromString('created-at'),
      emailId: scopedEmailId(accountA, jmapEmailIdFromString('email')),
      change: mailboxMembershipChange({
        add: [],
        remove: [scopedMailboxId(accountA, jmapMailboxIdFromString('inbox'))],
      }),
    })

    expect(result.change.add).toEqual([])
    expect(result.change.remove).toHaveLength(1)
  })

  it('snapshots mutable semantic-change inputs at mutation creation', () => {
    const keywordAdd = new Set(['$seen'])
    const mailboxAdd = [
      scopedMailboxId(accountA, jmapMailboxIdFromString('mailbox')),
    ]
    const keyword = keywordMutation({
      mutationId: mutationIdFromString('keyword-snapshot'),
      accountKey: accountA,
      createdAt: mutationInstantFromString('created-at'),
      emailId: scopedEmailId(accountA, jmapEmailIdFromString('email')),
      change: { add: keywordAdd, remove: new Set() },
    })
    const membership = mailboxMembershipMutation({
      mutationId: mutationIdFromString('membership-snapshot'),
      accountKey: accountA,
      createdAt: mutationInstantFromString('created-at'),
      emailId: scopedEmailId(accountA, jmapEmailIdFromString('email')),
      change: { add: mailboxAdd, remove: [] },
    })

    keywordAdd.add('$flagged')
    mailboxAdd.push(
      scopedMailboxId(accountA, jmapMailboxIdFromString('later-mailbox')),
    )

    expect([...keyword.change.add]).toEqual(['$seen'])
    expect(membership.change.add).toHaveLength(1)
  })
})

describe('PendingMutation identity', () => {
  it('uses only AccountKey and MutationId across lifecycle changes', () => {
    const pending = newSend(accountA, 'same-mutation')
    const inFlight = startMutationAttempt(pending)

    expect(samePendingMutationIdentity(pending, inFlight)).toBe(true)
    expect(
      samePendingMutationIdentity(pending, newSend(accountB, 'same-mutation')),
    ).toBe(false)
    expect(
      samePendingMutationIdentity(
        pending,
        newSend(accountA, 'different-mutation'),
      ),
    ).toBe(false)
  })
})

describe('PendingMutation lifecycle transitions', () => {
  it('starts pending/0 as inFlight/1 and preserves identity and payload', () => {
    const pending = newKeyword()
    const result = startMutationAttempt(pending)

    expect(result.lifecycle).toEqual({ status: 'inFlight', attemptCount: 1 })
    expect(result.mutationId).toBe(pending.mutationId)
    expect(result.accountKey).toBe(pending.accountKey)
    expect(result.change).toBe(pending.change)
  })

  it('starts retrying/N as inFlight/N+1', () => {
    const inFlight = startMutationAttempt(newKeyword())
    const retrying = scheduleMutationRetry(
      inFlight,
      mutationInstantFromString('next-attempt'),
    )
    const result = startMutationAttempt(retrying)

    expect(result.lifecycle).toEqual({ status: 'inFlight', attemptCount: 2 })
  })

  it('rejects starting another attempt directly from inFlight', () => {
    expect(() =>
      startMutationAttempt(startMutationAttempt(newKeyword())),
    ).toThrowError(TypeError)
  })

  it('rejects malformed started attempt counts during transitions', () => {
    const pending = newKeyword()
    const malformedInFlight: KeywordMutation = {
      ...pending,
      lifecycle: { status: 'inFlight', attemptCount: 0 },
    }
    const malformedRetrying: KeywordMutation = {
      ...pending,
      lifecycle: {
        status: 'retrying',
        attemptCount: 0,
        nextAttemptAt: mutationInstantFromString('next-attempt'),
      },
    }

    expect(() =>
      scheduleMutationRetry(
        malformedInFlight,
        mutationInstantFromString('later'),
      ),
    ).toThrowError(TypeError)
    expect(() => confirmEmailUpdateMutation(malformedInFlight)).toThrowError(
      TypeError,
    )
    expect(() => failMutationTerminal(malformedInFlight)).toThrowError(
      TypeError,
    )
    expect(() => startMutationAttempt(malformedRetrying)).toThrowError(
      TypeError,
    )
  })

  it('schedules retry only from inFlight without incrementing count', () => {
    const inFlight = startMutationAttempt(newKeyword())
    const nextAttemptAt = mutationInstantFromString('next-attempt')
    const result = scheduleMutationRetry(inFlight, nextAttemptAt)

    expect(result.lifecycle).toEqual({
      status: 'retrying',
      attemptCount: 1,
      nextAttemptAt,
    })
  })

  it('rejects retry from pending, retrying, confirmed and failedTerminal', () => {
    const pending = newKeyword()
    const inFlight = startMutationAttempt(pending)
    const retrying = scheduleMutationRetry(
      inFlight,
      mutationInstantFromString('next-attempt'),
    )
    const confirmed = confirmEmailUpdateMutation(inFlight)
    const failed = failMutationTerminal(inFlight)
    const nextAttemptAt = mutationInstantFromString('later')

    for (const mutation of [pending, retrying, confirmed, failed]) {
      expect(() => scheduleMutationRetry(mutation, nextAttemptAt)).toThrowError(
        TypeError,
      )
    }
  })

  it('confirms Keyword and Membership updates only from inFlight', () => {
    const keyword = startMutationAttempt(newKeyword())
    const membership = startMutationAttempt(newMembership())

    expect(confirmEmailUpdateMutation(keyword).lifecycle).toEqual({
      status: 'confirmed',
      attemptCount: 1,
    })
    expect(confirmEmailUpdateMutation(membership).lifecycle).toEqual({
      status: 'confirmed',
      attemptCount: 1,
    })
  })

  it('rejects update confirmation from non-inFlight states', () => {
    const pending = newKeyword()
    const inFlight = startMutationAttempt(pending)
    const retrying = scheduleMutationRetry(
      inFlight,
      mutationInstantFromString('next-attempt'),
    )
    const confirmed = confirmEmailUpdateMutation(inFlight)
    const failed = failMutationTerminal(inFlight)

    for (const mutation of [pending, retrying, confirmed, failed]) {
      expect(() => confirmEmailUpdateMutation(mutation)).toThrowError(TypeError)
    }
  })

  it('confirms inFlight Send with same-account Email evidence', () => {
    const inFlight = startMutationAttempt(newSend())
    const emailId = scopedEmailId(
      accountA,
      jmapEmailIdFromString('confirmed-email'),
    )
    const source = { emailId }
    const result = confirmSendMutation(inFlight, source)

    source.emailId = scopedEmailId(
      accountA,
      jmapEmailIdFromString('later-email'),
    )

    expect(result.lifecycle.status).toBe('confirmed')
    if (result.lifecycle.status === 'confirmed') {
      expect(result.lifecycle.attemptCount).toBe(1)
      expect(result.lifecycle.confirmation.emailId).toBe(emailId)
      expect(result.lifecycle.confirmation).not.toBe(source)
    }
  })

  it('rejects cross-account Send confirmation', () => {
    const inFlight = startMutationAttempt(newSend())
    const confirmation = sendConfirmation(
      scopedEmailId(accountB, jmapEmailIdFromString('confirmed-email')),
    )

    expect(() => confirmSendMutation(inFlight, confirmation)).toThrowError(
      TypeError,
    )
  })

  it('rejects Send confirmation from non-inFlight states', () => {
    const pending = newSend()
    const inFlight = startMutationAttempt(pending)
    const retrying = scheduleMutationRetry(
      inFlight,
      mutationInstantFromString('next-attempt'),
    )
    const confirmation = sendConfirmation(
      scopedEmailId(accountA, jmapEmailIdFromString('confirmed-email')),
    )
    const confirmed = confirmSendMutation(inFlight, confirmation)
    const failed = failMutationTerminal(inFlight)

    for (const mutation of [pending, retrying, confirmed, failed]) {
      expect(() => confirmSendMutation(mutation, confirmation)).toThrowError(
        TypeError,
      )
    }
  })

  it('fails terminally only from inFlight without changing attemptCount', () => {
    const inFlight = startMutationAttempt(newMembership())
    const result = failMutationTerminal(inFlight)

    expect(result.lifecycle).toEqual({
      status: 'failedTerminal',
      attemptCount: 1,
    })
  })

  it('rejects terminal failure from every non-inFlight state', () => {
    const pending = newKeyword()
    const inFlight = startMutationAttempt(pending)
    const retrying = scheduleMutationRetry(
      inFlight,
      mutationInstantFromString('next-attempt'),
    )
    const confirmed = confirmEmailUpdateMutation(inFlight)
    const failed = failMutationTerminal(inFlight)

    for (const mutation of [pending, retrying, confirmed, failed]) {
      expect(() => failMutationTerminal(mutation)).toThrowError(TypeError)
    }
  })

  it('does not reactivate confirmed or failedTerminal mutations', () => {
    const inFlight = startMutationAttempt(newSend())
    const confirmation = sendConfirmation(
      scopedEmailId(accountA, jmapEmailIdFromString('confirmed-email')),
    )
    const confirmed = confirmSendMutation(inFlight, confirmation)
    const failed = failMutationTerminal(inFlight)
    const nextAttemptAt = mutationInstantFromString('next-attempt')

    for (const terminal of [confirmed, failed]) {
      expect(() => startMutationAttempt(terminal)).toThrowError(TypeError)
      expect(() => scheduleMutationRetry(terminal, nextAttemptAt)).toThrowError(
        TypeError,
      )
      expect(() => failMutationTerminal(terminal)).toThrowError(TypeError)
    }

    expect(() => confirmSendMutation(confirmed, confirmation)).toThrowError(
      TypeError,
    )
    expect(() => confirmSendMutation(failed, confirmation)).toThrowError(
      TypeError,
    )
  })
})
