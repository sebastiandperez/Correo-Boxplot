import { describe, expect, it, vi } from 'vitest'

import { createMemoryLocalEngine } from '../../adapters/memory'
import { emailAddress } from '../../domain/address'
import { emailBody } from '../../domain/email-body'
import { email } from '../../domain/email'
import { identity } from '../../domain/identity'
import type { E2eePort } from '../../e2ee/port'
import type { E2eeErrorKind, E2eeResult } from '../../e2ee/types'
import type {
  CollectionCursorPrecondition,
  SyncPort,
} from '../../ports/sync-port'
import type { RemoteBody } from '../../remote/body'
import {
  RemoteBodySourceError,
  type RemoteBodyFetch,
  type RemoteBodySource,
} from '../../remote/body-source'
import type { RemoteEmailId } from '../../remote/types'
import {
  createTestCollectionSyncCursor,
  createTestEmail,
  createTestEmailMailbox,
  createTestIdentity,
  createTestMailbox,
  createTestAccount,
} from '../../tests/contracts/fixtures'
import { BodyMaterializationError } from '../body-materialization-errors'
import { DefaultBodyMaterializer } from '../body-materializer'

const envelope = {
  version: 1,
  algorithm: 'boxplot-crypto-box-v1',
  sender: 'envelope-sender@boxplot.test',
  recipient: 'envelope-recipient@boxplot.test',
  senderPublicKey: 'sender-key',
  recipientPublicKey: 'recipient-key',
  nonce: 'nonce',
  ciphertext: 'BODY_E2EE_CIPHERTEXT_CANARY_8527',
} as const

class FakeBodySource implements RemoteBodySource {
  readonly calls: Array<Readonly<{ accountKey: string; emailId: string }>> = []
  readonly assertCurrent = vi.fn()

  constructor(
    private readonly response:
      RemoteBody | Promise<RemoteBody> | RemoteBodySourceError,
  ) {}

  async fetchBody(
    accountKey: Parameters<RemoteBodySource['fetchBody']>[0],
    emailId: RemoteEmailId,
  ): Promise<RemoteBodyFetch> {
    this.calls.push({ accountKey, emailId })
    if (this.response instanceof RemoteBodySourceError) throw this.response
    return { body: await this.response, assertCurrent: this.assertCurrent }
  }
}

function e2eePort(
  decryptResult: E2eeResult<{
    version: 1
    sender: string
    recipient: string
    subject: string
    text: string
    html: string | null
  }> = {
    ok: true,
    value: {
      version: 1,
      sender: 'alice@boxplot.test',
      recipient: 'bob@boxplot.test',
      subject: 'Outer Subject',
      text: 'decrypted text',
      html: '<script>alert(1)</script><img src="https://example.test/x">',
    },
  },
): E2eePort {
  return {
    ensureLocalIdentity: vi.fn(async () => ({
      ok: false as const,
      error: { kind: 'unexpected' as const },
    })),
    trustPeerPublicKey: vi.fn(async () => ({
      ok: false as const,
      error: { kind: 'unexpected' as const },
    })),
    peerKeyStatus: vi.fn(async () => ({
      ok: true as const,
      value: { kind: 'missing' as const },
    })),
    encryptFor: vi.fn(async () => ({
      ok: false as const,
      error: { kind: 'unexpected' as const },
    })),
    decryptFrom: vi.fn(async () => decryptResult),
  }
}

async function seeded(
  options: {
    from?: ReturnType<typeof emailAddress>[] | null
    to?: ReturnType<typeof emailAddress>[] | null
    cc?: ReturnType<typeof emailAddress>[] | null
    bcc?: ReturnType<typeof emailAddress>[] | null
    subject?: string | null
    identityEmails?: readonly string[]
  } = {},
  engine = createMemoryLocalEngine(),
) {
  const owner = createTestAccount(`body-${Math.random()}`)
  const mailbox = createTestMailbox(owner, 'inbox', { role: 'inbox' })
  const base = createTestEmail(owner, 'message')
  const message = email({
    ...base,
    from:
      options.from === undefined
        ? [emailAddress(null, 'alice@boxplot.test')]
        : options.from,
    to:
      options.to === undefined
        ? [emailAddress(null, 'bob@boxplot.test')]
        : options.to,
    cc: options.cc === undefined ? [] : options.cc,
    bcc: options.bcc === undefined ? null : options.bcc,
    subject: options.subject === undefined ? 'Outer Subject' : options.subject,
  })
  const identities = (options.identityEmails ?? ['bob@boxplot.test']).map(
    (address, index) => {
      const baseIdentity = createTestIdentity(owner, `identity-${index}`)
      return identity({ ...baseIdentity, email: address })
    },
  )
  expect(await engine.syncPort.registerAccount(owner)).toMatchObject({
    ok: true,
  })
  expect(
    await engine.syncPort.applyCollectionSync({
      kind: 'mailbox',
      mode: 'replace',
      expectedCursor: { kind: 'absent' },
      nextCursor: createTestCollectionSyncCursor(owner, 'mailbox', 'm1'),
      snapshot: [mailbox],
    }),
  ).toMatchObject({ ok: true })
  expect(
    await engine.syncPort.applyCollectionSync({
      kind: 'identity',
      mode: 'replace',
      expectedCursor: { kind: 'absent' },
      nextCursor: createTestCollectionSyncCursor(owner, 'identity', 'i1'),
      snapshot: identities,
    }),
  ).toMatchObject({ ok: true })
  expect(
    await engine.syncPort.applyCollectionSync({
      kind: 'email',
      mode: 'replace',
      expectedCursor: { kind: 'absent' },
      nextCursor: createTestCollectionSyncCursor(owner, 'email', 'e1'),
      snapshot: [
        {
          email: message,
          memberships: [createTestEmailMailbox(message, mailbox)],
        },
      ],
    }),
  ).toMatchObject({ ok: true })
  return { engine, owner, mailbox, message, identities }
}

function materializer(
  setup: Awaited<ReturnType<typeof seeded>>,
  source: RemoteBodySource,
  e2ee: E2eePort = e2eePort(),
  syncPort: SyncPort = setup.engine.syncPort,
) {
  return new DefaultBodyMaterializer({
    readRepository: setup.engine.readRepository,
    syncPort,
    remoteBodySource: source,
    e2eePort: e2ee,
  })
}

async function expectKind(operation: Promise<unknown>, kind: string) {
  await expect(operation).rejects.toMatchObject({
    name: 'BodyMaterializationError',
    kind,
  })
}

describe('BodyMaterializer local cache and plain bodies', () => {
  it('B01 returns alreadyCached with zero remote, E2EE or write work', async () => {
    const setup = await seeded()
    await setup.engine.syncPort.cacheEmailBody(
      emailBody({ emailId: setup.message.id, text: null, html: null }),
    )
    const source = new FakeBodySource({ kind: 'plain', text: 'x', html: null })
    const crypto = e2eePort()
    const write = vi.spyOn(setup.engine.syncPort, 'cacheEmailBody')

    await expect(
      materializer(setup, source, crypto).materialize(setup.message.id),
    ).resolves.toBe('alreadyCached')
    expect(source.calls).toHaveLength(0)
    expect(crypto.decryptFrom).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
  })

  it('B02 fails ownerAbsent before remote work', async () => {
    const setup = await seeded()
    const absent = createTestEmail(createTestAccount('absent-owner'), 'absent')
    const source = new FakeBodySource({ kind: 'plain', text: null, html: null })
    await expectKind(
      materializer(setup, source).materialize(absent.id),
      'emailAbsent',
    )
    expect(source.calls).toHaveLength(0)
  })

  it.each([
    ['text', 'hello', null],
    ['html', null, ' <DIV>raw</DIV> '],
    ['null-null', null, null],
    ['empty', '', ''],
  ])('B03-B06 caches plain %s exactly', async (_label, text, html) => {
    const setup = await seeded()
    const source = new FakeBodySource({ kind: 'plain', text, html })
    await expect(
      materializer(setup, source).materialize(setup.message.id),
    ).resolves.toBe('materialized')
    await expect(
      setup.engine.readRepository.readEmailBody(setup.message.id),
    ).resolves.toEqual({
      ok: true,
      value: {
        kind: 'cached',
        value: { emailId: setup.message.id, text, html },
      },
    })
  })
})

describe('BodyMaterializer E2EE authority and failures', () => {
  const encrypted: RemoteBody = {
    kind: 'boxplotE2ee',
    contentType: 'application/vnd.boxplot.e2ee+json',
    payload: JSON.stringify(envelope),
  }

  it('B07-B10 derives all expectations from committed metadata and caches only plaintext', async () => {
    const setup = await seeded()
    const source = new FakeBodySource(encrypted)
    const crypto = e2eePort()
    await materializer(setup, source, crypto).materialize(setup.message.id)

    expect(crypto.decryptFrom).toHaveBeenCalledWith({
      localIdentity: 'bob@boxplot.test',
      expectedSender: 'alice@boxplot.test',
      expectedRecipient: 'bob@boxplot.test',
      expectedSubject: 'Outer Subject',
      envelope,
    })
    const cached = await setup.engine.readRepository.readEmailBody(
      setup.message.id,
    )
    expect(cached).toMatchObject({
      ok: true,
      value: {
        kind: 'cached',
        value: {
          text: 'decrypted text',
          html: '<script>alert(1)</script><img src="https://example.test/x">',
        },
      },
    })
    expect(JSON.stringify(cached)).not.toContain(envelope.ciphertext)
  })

  it.each([
    [{ from: null }, 'sender'],
    [{ from: [] }, 'sender'],
    [
      {
        from: [
          emailAddress(null, 'alice@boxplot.test'),
          emailAddress(null, 'mallory@boxplot.test'),
        ],
      },
      'sender',
    ],
    [{ to: null }, 'recipient'],
    [{ to: [] }, 'recipient'],
    [
      {
        to: [
          emailAddress(null, 'bob@boxplot.test'),
          emailAddress(null, 'carol@boxplot.test'),
        ],
      },
      'recipient',
    ],
    [{ cc: [emailAddress(null, 'copy@boxplot.test')] }, 'cc'],
    [{ bcc: [emailAddress(null, 'blind@boxplot.test')] }, 'bcc'],
    [{ subject: null }, 'subject'],
    [{ identityEmails: ['Bob@boxplot.test'] }, 'identity-case'],
    [{ identityEmails: [' bob@boxplot.test '] }, 'identity-space'],
  ])(
    'B13-B17 rejects unavailable exact metadata: %s',
    async (options, label) => {
      expect(label).toBeTypeOf('string')
      const setup = await seeded(options)
      const crypto = e2eePort()
      await expectKind(
        materializer(setup, new FakeBodySource(encrypted), crypto).materialize(
          setup.message.id,
        ),
        'metadataUnavailable',
      )
      expect(crypto.decryptFrom).not.toHaveBeenCalled()
      await expect(
        setup.engine.readRepository.readEmailBody(setup.message.id),
      ).resolves.toMatchObject({
        value: { kind: 'notCached' },
      })
    },
  )

  it.each([
    'peerKeyUnavailable',
    'keyUnavailable',
    'authenticationFailed',
    'metadataMismatch',
    'unavailable',
  ] satisfies readonly E2eeErrorKind[])(
    'B18-B22 preserves safe E2EE failure %s without caching',
    async (kind) => {
      const setup = await seeded()
      const crypto = e2eePort({ ok: false, error: { kind } })
      await expect(
        materializer(setup, new FakeBodySource(encrypted), crypto).materialize(
          setup.message.id,
        ),
      ).rejects.toMatchObject({
        name: 'BodyMaterializationError',
        kind: 'e2ee',
        e2eeKind: kind,
      })
      expect(crypto.trustPeerPublicKey).not.toHaveBeenCalled()
      expect(crypto.ensureLocalIdentity).not.toHaveBeenCalled()
      await expect(
        setup.engine.readRepository.readEmailBody(setup.message.id),
      ).resolves.toMatchObject({
        value: { kind: 'notCached' },
      })
    },
  )

  it.each(['', 'not json', '{"version":1'])(
    'B11 rejects malformed payload before decrypt',
    async (payload) => {
      const setup = await seeded()
      const crypto = e2eePort()
      const source = new FakeBodySource({ ...encrypted, payload })
      await expectKind(
        materializer(setup, source, crypto).materialize(setup.message.id),
        'invalidEnvelope',
      )
      expect(crypto.decryptFrom).not.toHaveBeenCalled()
    },
  )
})

describe('BodyMaterializer concurrency and local authority', () => {
  it('B24 maps remote failure without caching', async () => {
    const setup = await seeded()
    const source = new FakeBodySource(new RemoteBodySourceError('remote'))
    await expectKind(
      materializer(setup, source).materialize(setup.message.id),
      'remote',
    )
    await expect(
      setup.engine.readRepository.readEmailBody(setup.message.id),
    ).resolves.toMatchObject({
      value: { kind: 'notCached' },
    })
  })

  it('B32 deduplicates concurrent work and B35 makes the cache authoritative', async () => {
    const setup = await seeded()
    let resolve!: (body: RemoteBody) => void
    const pending = new Promise<RemoteBody>((done) => (resolve = done))
    const source = new FakeBodySource(pending)
    const target = materializer(setup, source)
    const first = target.materialize(setup.message.id)
    const second = target.materialize(setup.message.id)
    resolve({ kind: 'plain', text: 'once', html: null })
    await expect(Promise.all([first, second])).resolves.toEqual([
      'materialized',
      'materialized',
    ])
    expect(source.calls).toHaveLength(1)
    await expect(target.materialize(setup.message.id)).resolves.toBe(
      'alreadyCached',
    )
    expect(source.calls).toHaveLength(1)
  })

  it('B34 maps owner disappearance during fetch and never resurrects the Email', async () => {
    const setup = await seeded()
    let resolve!: (body: RemoteBody) => void
    const source = new FakeBodySource(
      new Promise<RemoteBody>((done) => (resolve = done)),
    )
    const operation = materializer(setup, source).materialize(setup.message.id)
    await vi.waitFor(() => expect(source.calls).toHaveLength(1))
    const expectedCursor: CollectionCursorPrecondition = {
      kind: 'matches',
      cursor: createTestCollectionSyncCursor(setup.owner, 'email', 'e1'),
    }
    await setup.engine.syncPort.applyCollectionSync({
      kind: 'email',
      mode: 'replace',
      expectedCursor,
      nextCursor: createTestCollectionSyncCursor(setup.owner, 'email', 'e2'),
      snapshot: [],
    })
    resolve({ kind: 'plain', text: 'late', html: null })
    await expectKind(operation, 'emailAbsent')
    await expect(
      setup.engine.readRepository.readEmail(setup.message.id),
    ).resolves.toMatchObject({
      value: { kind: 'absent' },
    })
  })

  it('B31 uses account-scoped in-flight keys for identical remote ID text', async () => {
    const engine = createMemoryLocalEngine()
    const setupA = await seeded({}, engine)
    const setupB = await seeded({}, engine)
    const source = new FakeBodySource({
      kind: 'plain',
      text: 'isolated',
      html: null,
    })
    const target = materializer(setupA, source)
    await Promise.all([
      target.materialize(setupA.message.id),
      target.materialize(setupB.message.id),
    ])
    expect(source.calls.map((call) => call.accountKey)).toEqual([
      setupA.owner.key,
      setupB.owner.key,
    ])
  })

  it('B33 keeps concurrent different-email results isolated', async () => {
    const setup = await seeded()
    const second = createTestEmail(setup.owner, 'second')
    await setup.engine.syncPort.applyCollectionSync({
      kind: 'email',
      mode: 'replace',
      expectedCursor: {
        kind: 'matches',
        cursor: createTestCollectionSyncCursor(setup.owner, 'email', 'e1'),
      },
      nextCursor: createTestCollectionSyncCursor(setup.owner, 'email', 'e2'),
      snapshot: [
        {
          email: setup.message,
          memberships: [createTestEmailMailbox(setup.message, setup.mailbox)],
        },
        {
          email: second,
          memberships: [createTestEmailMailbox(second, setup.mailbox)],
        },
      ],
    })
    const source: RemoteBodySource = {
      fetchBody: vi.fn(async (_accountKey, id) => ({
        body: { kind: 'plain' as const, text: `body:${id}`, html: null },
        assertCurrent: vi.fn(),
      })),
    }
    const target = materializer(setup, source)
    await Promise.all([
      target.materialize(setup.message.id),
      target.materialize(second.id),
    ])
    const [firstBody, secondBody] = await Promise.all([
      setup.engine.readRepository.readEmailBody(setup.message.id),
      setup.engine.readRepository.readEmailBody(second.id),
    ])
    expect(firstBody).toMatchObject({
      value: { value: { text: `body:${setup.message.id.jmapId}` } },
    })
    expect(secondBody).toMatchObject({
      value: { value: { text: `body:${second.id.jmapId}` } },
    })
  })

  it('never leaks canaries through public errors', () => {
    const error = new BodyMaterializationError('e2ee', 'authenticationFailed')
    expect(String(error)).not.toContain('BODY_E2EE_CIPHERTEXT_CANARY_8527')
    expect(String(error)).not.toContain('BODY_REMOTE_PASSWORD_CANARY_7419')
  })
})
