import { describe, it, expect, vi } from 'vitest'
import { toDomainIdentity } from '../to-domain-identity'
import { accountKeyFromString } from '../../../domain/ids'
import type { JmapIdentity } from '../../../jmap/types'
import { mapJmapIdentity } from '../../../remote/jmap/mappers'

const accountKey = accountKeyFromString('acc-1')

function makeRawIdentity(overrides: Partial<JmapIdentity> = {}): JmapIdentity {
  return {
    id: 'identity-1',
    name: 'Alice',
    email: 'alice@example.test',
    replyTo: null,
    bcc: null,
    htmlSignature: '',
    textSignature: '',
    ...overrides,
  }
}

describe('toDomainIdentity', () => {
  it('maps a well-formed JmapIdentity into a Domain Identity', () => {
    const identity = toDomainIdentity(
      accountKey,
      mapJmapIdentity(makeRawIdentity()),
    )

    expect(identity).not.toBeNull()
    expect(identity?.id).toEqual({ accountKey, jmapId: 'identity-1' })
    expect(identity?.name).toBe('Alice')
    expect(identity?.email).toBe('alice@example.test')
  })

  it('maps a non-null replyTo/bcc list', () => {
    const identity = toDomainIdentity(
      accountKey,
      mapJmapIdentity(
        makeRawIdentity({
          replyTo: [{ name: 'Reply', email: 'reply@example.test' }],
          bcc: [{ name: null, email: 'bcc@example.test' }],
        }),
      ),
    )

    expect(identity?.replyTo).toEqual([
      { name: 'Reply', email: 'reply@example.test' },
    ])
    expect(identity?.bcc).toEqual([{ name: null, email: 'bcc@example.test' }])
  })

  it('returns null when email is empty (Domain rejects it)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const identity = toDomainIdentity(
      accountKey,
      mapJmapIdentity(makeRawIdentity({ email: '' })),
    )

    expect(identity).toBeNull()
    expect(warnSpy).toHaveBeenCalled()
  })
})
