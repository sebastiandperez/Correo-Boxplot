import { describe, expect, it } from 'vitest'

import type { LocalChangeHint } from '../../../ports/local-change-source'
import type { PortResult } from '../../../ports/port-result'
import {
  expectErrorKind,
  expectHintCoverage,
  sameLocalChangeHint,
  unwrapOk,
} from '../assertions'
import { createTestFixtures, createTestMailboxViewSpec } from '../fixtures'

type TestError =
  Readonly<{ kind: 'conflict' }> | Readonly<{ kind: 'unavailable' }>

describe('TEST-01 PortResult assertions', () => {
  it('unwraps success and reports only the stable error kind on failure', () => {
    const success: PortResult<string, TestError> = {
      ok: true,
      value: 'value',
    }
    const failure: PortResult<string, TestError> = {
      ok: false,
      error: { kind: 'conflict' },
    }

    expect(unwrapOk(success)).toBe('value')
    expect(() => unwrapOk(failure)).toThrowError(
      'Expected successful PortResult, received error kind: conflict',
    )
  })

  it('requires failure with the exact semantic error kind', () => {
    const conflict: PortResult<void, TestError> = {
      ok: false,
      error: { kind: 'conflict' },
    }
    const success: PortResult<void, TestError> = {
      ok: true,
      value: undefined,
    }

    expect(() => expectErrorKind(conflict, 'conflict')).not.toThrow()
    expect(() => expectErrorKind(conflict, 'unavailable')).toThrowError(
      'Expected error kind unavailable, received conflict',
    )
    expect(() => expectErrorKind(success, 'conflict')).toThrowError(
      'Expected error kind conflict, received success',
    )
  })
})

describe('TEST-01 LocalChangeHint assertions', () => {
  it('matches semantic identities and rejects a different Account', () => {
    const { accountA, accountB, emailA1 } = createTestFixtures()
    const accountAHint: LocalChangeHint = {
      kind: 'emails',
      accountKey: accountA.key,
    }
    const equivalentAccountAHint: LocalChangeHint = {
      kind: 'emails',
      accountKey: accountA.key,
    }
    const accountBHint: LocalChangeHint = {
      kind: 'emails',
      accountKey: accountB.key,
    }
    const emailBodyHint: LocalChangeHint = {
      kind: 'emailBody',
      emailId: emailA1.id,
    }

    expect(sameLocalChangeHint(accountAHint, equivalentAccountAHint)).toBe(true)
    expect(sameLocalChangeHint(accountAHint, accountBHint)).toBe(false)
    expect(sameLocalChangeHint(accountAHint, emailBodyHint)).toBe(false)
  })

  it('matches separately constructed MailboxView specs structurally', () => {
    const { inboxA, inboxViewSpecA, alternativeViewSpecA } =
      createTestFixtures()
    const equivalentSpec = createTestMailboxViewSpec(inboxA)

    expect(
      sameLocalChangeHint(
        { kind: 'mailboxView', spec: inboxViewSpecA },
        { kind: 'mailboxView', spec: equivalentSpec },
      ),
    ).toBe(true)
    expect(
      sameLocalChangeHint(
        { kind: 'mailboxView', spec: inboxViewSpecA },
        { kind: 'mailboxView', spec: alternativeViewSpecA },
      ),
    ).toBe(false)
  })

  it('checks subset coverage without depending on order, duplicates, or extras', () => {
    const { accountA, emailA1 } = createTestFixtures()
    const accountsHint: LocalChangeHint = { kind: 'accounts' }
    const emailsHint: LocalChangeHint = {
      kind: 'emails',
      accountKey: accountA.key,
    }
    const bodyHint: LocalChangeHint = {
      kind: 'emailBody',
      emailId: emailA1.id,
    }

    expect(() =>
      expectHintCoverage(
        [bodyHint, emailsHint, accountsHint, emailsHint],
        [accountsHint, bodyHint],
      ),
    ).not.toThrow()
    expect(() =>
      expectHintCoverage([accountsHint, accountsHint], [emailsHint]),
    ).toThrowError('Missing required LocalChangeHint coverage: emails')
  })
})
