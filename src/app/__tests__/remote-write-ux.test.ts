import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestAccount } from '../../tests/contracts/fixtures'
import { DefaultMutationRunner, type MutationRunner } from '../../outbox'
import type { E2eePort } from '../../e2ee/port'
import type {
  RemoteMutationSource,
  RemoteSubmissionDraft,
} from '../../remote/mutation-source'
import type { RemoteEmailId } from '../../remote/types'
import { remoteEmailIdFromString } from '../../remote/types'
import {
  createApplicationContext,
  createMailApplicationController,
} from '../application'
import { executeSend } from '../services/send-service'
import { useComposerStore } from '../stores/composer'
import { useMailStore } from '../stores/mail'
import { useMutationStatusStore } from '../stores/mutation-status'
import { useRuntimeStore } from '../stores/runtime'
import { createSeededMemoryApplication } from './application-fixture'

class RecordingMutationSource implements RemoteMutationSource {
  connected = true
  readonly submissions: RemoteSubmissionDraft[] = []
  readonly idempotencyKeys: string[] = []
  readonly keywordCalls: RemoteEmailId[] = []
  readonly membershipCalls: RemoteEmailId[] = []

  isConnected(): boolean {
    return this.connected
  }

  async submit(
    _accountKey: string,
    message: RemoteSubmissionDraft,
    _idempotencyKey: string,
  ) {
    this.submissions.push(message)
    this.idempotencyKeys.push(_idempotencyKey)
    return {
      kind: 'accepted' as const,
      remoteEmailId: remoteEmailIdFromString('remote-send-confirmed'),
      receiptId: 'receipt',
    }
  }

  async applyKeywordChange(
    _accountKey: string,
    emailId: RemoteEmailId,
  ): Promise<void> {
    this.keywordCalls.push(emailId)
  }

  async applyMembershipChange(
    _accountKey: string,
    emailId: RemoteEmailId,
  ): Promise<void> {
    this.membershipCalls.push(emailId)
  }
}

function e2eePort(): E2eePort {
  return {
    encryptFor: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        version: 1,
        algorithm: 'boxplot-crypto-box-v1',
        sender: 'sender-A@example.test',
        recipient: 'recipient@example.test',
        senderPublicKey: 'sender-key',
        recipientPublicKey: 'recipient-key',
        nonce: 'nonce',
        ciphertext: 'ciphertext',
      },
    }),
  } as unknown as E2eePort
}

function realRunner(
  engine: Awaited<ReturnType<typeof createSeededMemoryApplication>>['engine'],
  remote: RecordingMutationSource,
  crypto: E2eePort = e2eePort(),
) {
  return new DefaultMutationRunner({
    readRepository: engine.readRepository,
    syncPort: engine.syncPort,
    remoteMutationSource: remote,
    e2eePort: crypto,
  })
}

describe('A2-07/A2-08 remote write UX', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('MUT-01/02/03 keeps optimistic local mutations pending while offline and runs their exact IDs', async () => {
    const { engine, fixtures } = await createSeededMemoryApplication()
    const remote = new RecordingMutationSource()
    remote.connected = false
    const controller = createMailApplicationController(
      createApplicationContext({
        ...engine,
        mutationRunner: realRunner(engine, remote),
      }),
      useMailStore(),
      useRuntimeStore(),
    )
    await controller.initialize()

    await controller.toggleKeyword(fixtures.emailA1, '$seen')
    await vi.waitFor(() =>
      expect(
        useMutationStatusStore().statusesForAccount(fixtures.accountA.key),
      ).toMatchObject([{ kind: 'keyword', lifecycle: 'pending' }]),
    )
    expect(
      useMailStore()
        .emails.find((value) => value.id.jmapId === fixtures.emailA1.id.jmapId)
        ?.keywords.has('$seen'),
    ).toBe(false)
    expect(remote.keywordCalls).toHaveLength(0)

    await controller.moveEmail(fixtures.emailA2.id, 'archive')
    await vi.waitFor(() =>
      expect(
        useMutationStatusStore().statusesForAccount(fixtures.accountA.key),
      ).toHaveLength(2),
    )
    expect(remote.membershipCalls).toHaveLength(0)
    expect(useRuntimeStore().local).toBe('ready')
    controller.dispose()
  })

  it('MUT-04 confirms only after P-01 sees the exact mutation absent', async () => {
    const { engine, fixtures } = await createSeededMemoryApplication()
    const remote = new RecordingMutationSource()
    const controller = createMailApplicationController(
      createApplicationContext({
        ...engine,
        mutationRunner: realRunner(engine, remote),
      }),
      useMailStore(),
      useRuntimeStore(),
    )
    await controller.initialize()
    await controller.toggleKeyword(fixtures.emailA1, '$seen')

    await vi.waitFor(() => expect(remote.keywordCalls).toHaveLength(1))
    await vi.waitFor(() =>
      expect(
        useMutationStatusStore().recentConfirmationForEmail(
          fixtures.emailA1.id,
        ),
      ).toMatchObject({ kind: 'keyword' }),
    )
    expect(
      await engine.readRepository.listPendingMutations(fixtures.accountA.key),
    ).toMatchObject({ ok: true, value: { kind: 'present', value: [] } })
    controller.dispose()
  })

  it('ADV-01 does not report an ambiguous Send as sent', async () => {
    const { engine, fixtures } = await createSeededMemoryApplication()
    const runner: MutationRunner = {
      runAccount: async () => ({
        attempted: 0,
        confirmed: 0,
        retrying: 0,
        terminal: 0,
        reconciliation: 0,
        skipped: 0,
      }),
      runMutation: async () => ({ kind: 'needsReconciliation' }),
    }
    const context = createApplicationContext({
      ...engine,
      mutationRunner: runner,
    })
    const controller = createMailApplicationController(
      context,
      useMailStore(),
      useRuntimeStore(),
    )
    await controller.initialize()
    const composer = useComposerStore()
    composer.open({
      to: 'recipient@example.test',
      subject: 'Ambiguous',
      body: 'body',
    })
    const staged = await executeSend(context)
    if (!staged.ok) throw new Error('expected durable staged send')

    await controller.runMutation(staged.accountKey, staged.mutationId)
    await vi.waitFor(() =>
      expect(
        useMutationStatusStore().latestSendForAccount(fixtures.accountA.key),
      ).toMatchObject({
        kind: 'status',
        value: { lifecycle: 'pending', needsReconciliation: true },
      }),
    )
    expect(
      useMutationStatusStore().latestSendForAccount(fixtures.accountA.key),
    ).not.toMatchObject({ kind: 'confirmed' })
    controller.dispose()
  })

  it('SEND-01/04 and E2EE-03/11 stage the selected mode, reset Composer, and use the real encrypted runner path', async () => {
    const { engine, fixtures } = await createSeededMemoryApplication()
    const remote = new RecordingMutationSource()
    const context = createApplicationContext({
      ...engine,
      mutationRunner: realRunner(engine, remote),
    })
    const controller = createMailApplicationController(
      context,
      useMailStore(),
      useRuntimeStore(),
    )
    await controller.initialize()
    const composer = useComposerStore()
    composer.open({
      to: 'recipient@example.test',
      subject: 'Encrypted',
      body: 'secret body',
    })
    composer.securityMode = 'boxplotE2eeV1'

    const staged = await executeSend(context)
    if (!staged.ok) throw new Error('expected durable staged send')
    expect(composer.isOpen).toBe(false)
    expect(composer.securityMode).toBe('plain')
    await controller.runMutation(staged.accountKey, staged.mutationId)

    expect(remote.submissions).toHaveLength(1)
    expect(remote.submissions[0].body.kind).toBe('boxplotE2ee')
    expect(JSON.stringify(remote.submissions[0])).not.toContain('secret body')
    await vi.waitFor(() =>
      expect(
        useMutationStatusStore().latestSendForAccount(fixtures.accountA.key),
      ).toMatchObject({ kind: 'confirmed' }),
    )
    expect(
      await engine.readRepository.readPendingMutation(
        staged.accountKey,
        staged.mutationId,
      ),
    ).toMatchObject({ ok: true, value: { kind: 'absent' } })
    controller.dispose()
  })

  it('SEND-04 uses the real plaintext runner path only when plain was explicitly selected', async () => {
    const { engine, fixtures } = await createSeededMemoryApplication()
    const remote = new RecordingMutationSource()
    const context = createApplicationContext({
      ...engine,
      mutationRunner: realRunner(engine, remote),
    })
    const controller = createMailApplicationController(
      context,
      useMailStore(),
      useRuntimeStore(),
    )
    await controller.initialize()
    const composer = useComposerStore()
    composer.open({
      to: 'recipient@example.test',
      subject: 'Plain',
      body: 'plain body',
    })
    expect(composer.securityMode).toBe('plain')
    const staged = await executeSend(context)
    if (!staged.ok) throw new Error('expected durable staged send')

    await controller.runMutation(staged.accountKey, staged.mutationId)
    expect(remote.submissions).toHaveLength(1)
    expect(remote.submissions[0].body).toEqual({
      kind: 'plain',
      text: 'plain body',
      html: null,
    })
    expect(
      useMutationStatusStore().latestSendForAccount(fixtures.accountA.key),
    ).toMatchObject({ kind: 'confirmed' })
    controller.dispose()
  })

  it('ADV-02 does not claim confirmation when C confirms but Application cannot verify absence through P-01', async () => {
    const { engine, fixtures } = await createSeededMemoryApplication()
    let failMutationLists = false
    const readRepository = Object.assign(Object.create(engine.readRepository), {
      listPendingMutations: async (accountKey: typeof fixtures.accountA.key) =>
        failMutationLists
          ? { ok: false as const, error: { kind: 'unexpected' as const } }
          : engine.readRepository.listPendingMutations(accountKey),
    })
    const remote = new RecordingMutationSource()
    const frozenRunner = realRunner(engine, remote)
    const mutationRunner: MutationRunner = {
      runAccount: (accountKey) => frozenRunner.runAccount(accountKey),
      runMutation: async (accountKey, mutationId) => {
        const outcome = await frozenRunner.runMutation(accountKey, mutationId)
        failMutationLists = true
        return outcome
      },
    }
    const context = createApplicationContext({
      ...engine,
      readRepository,
      mutationRunner,
    })
    const controller = createMailApplicationController(
      context,
      useMailStore(),
      useRuntimeStore(),
    )
    await controller.initialize()
    const composer = useComposerStore()
    composer.open({
      to: 'recipient@example.test',
      subject: 'No false success',
      body: 'body',
    })
    const staged = await executeSend(context)
    if (!staged.ok) throw new Error('expected durable staged send')

    await controller.runMutation(staged.accountKey, staged.mutationId)
    expect(remote.submissions).toHaveLength(1)
    expect(
      useMutationStatusStore().latestSendForAccount(fixtures.accountA.key),
    ).not.toMatchObject({ kind: 'confirmed' })
    expect(useRuntimeStore().local).toBe('ready')
    controller.dispose()
  })

  it('SEND-09/E2EE-08 reconstructs a durable offline E2EE send after restart without a downgrade', async () => {
    const { engine, fixtures } = await createSeededMemoryApplication()
    useMailStore().selectAccount(fixtures.accountA.key)
    const composer = useComposerStore()
    composer.open({
      to: 'recipient@example.test',
      subject: 'Restart',
      body: 'body',
    })
    composer.securityMode = 'boxplotE2eeV1'
    const staged = await executeSend(createApplicationContext(engine))
    if (!staged.ok) throw new Error('expected staged send')

    setActivePinia(createPinia())
    const reopened = createMailApplicationController(
      createApplicationContext(engine),
      useMailStore(),
      useRuntimeStore(),
    )
    await reopened.initialize()
    expect(
      useMutationStatusStore().latestSendForAccount(fixtures.accountA.key),
    ).toMatchObject({
      kind: 'status',
      value: { lifecycle: 'pending', securityMode: 'boxplotE2eeV1' },
    })
    expect(useComposerStore().securityMode).toBe('plain')
    reopened.dispose()
  })

  it('E2EE-10 keeps the selected durable mode when frozen encryption reports unavailable', async () => {
    const { engine, fixtures } = await createSeededMemoryApplication()
    const remote = new RecordingMutationSource()
    const unavailableCrypto = {
      encryptFor: vi.fn().mockResolvedValue({
        ok: false,
        error: { kind: 'unavailable' },
      }),
    } as unknown as E2eePort
    const context = createApplicationContext({
      ...engine,
      mutationRunner: realRunner(engine, remote, unavailableCrypto),
    })
    const controller = createMailApplicationController(
      context,
      useMailStore(),
      useRuntimeStore(),
    )
    await controller.initialize()
    const composer = useComposerStore()
    composer.open({
      to: 'recipient@example.test',
      subject: 'No downgrade',
      body: 'body',
    })
    composer.securityMode = 'boxplotE2eeV1'
    const staged = await executeSend(context)
    if (!staged.ok) throw new Error('expected durable staged send')

    await controller.runMutation(staged.accountKey, staged.mutationId)
    expect(remote.submissions).toHaveLength(0)
    expect(
      await engine.readRepository.readPendingMutation(
        staged.accountKey,
        staged.mutationId,
      ),
    ).toMatchObject({
      ok: true,
      value: {
        kind: 'present',
        value: {
          lifecycle: { status: 'retrying' },
          intent: { securityMode: 'boxplotE2eeV1' },
        },
      },
    })
    expect(
      useMutationStatusStore().latestSendForAccount(fixtures.accountA.key),
    ).toMatchObject({ kind: 'status', value: { lifecycle: 'retrying' } })
    controller.dispose()
  })

  it('MUT-11 keeps A mutation feedback out of B after account selection changes', async () => {
    const { engine, fixtures } = await createSeededMemoryApplication()
    const accountB = createTestAccount('write-status-B')
    await engine.syncPort.registerAccount(accountB)
    const remote = new RecordingMutationSource()
    remote.connected = false
    const controller = createMailApplicationController(
      createApplicationContext({
        ...engine,
        mutationRunner: realRunner(engine, remote),
      }),
      useMailStore(),
      useRuntimeStore(),
    )
    await controller.initialize()
    await controller.toggleKeyword(fixtures.emailA1, '$seen')
    await vi.waitFor(() =>
      expect(
        useMutationStatusStore().statusesForAccount(fixtures.accountA.key),
      ).toHaveLength(1),
    )

    await controller.selectAccount(accountB.key)
    expect(useMutationStatusStore().statusesForAccount(accountB.key)).toEqual(
      [],
    )
    expect(
      useMutationStatusStore().statusesForAccount(fixtures.accountA.key),
    ).toHaveLength(1)
    controller.dispose()
  })

  it('MUT-12/13 and ADV-07 rereads P-03 mutation invalidations without losing a later staged send', async () => {
    const { engine, fixtures } = await createSeededMemoryApplication()
    const context = createApplicationContext(engine)
    const controller = createMailApplicationController(
      context,
      useMailStore(),
      useRuntimeStore(),
    )
    await controller.initialize()
    const composer = useComposerStore()
    composer.open({ to: 'one@example.test', subject: 'one', body: 'one' })
    const first = await executeSend(context)
    composer.open({ to: 'two@example.test', subject: 'two', body: 'two' })
    const second = await executeSend(context)
    if (!first.ok || !second.ok) throw new Error('expected two staged sends')

    await vi.waitFor(() =>
      expect(
        useMutationStatusStore().statusesForAccount(fixtures.accountA.key),
      ).toMatchObject([
        { mutationId: first.mutationId, kind: 'send', lifecycle: 'pending' },
        { mutationId: second.mutationId, kind: 'send', lifecycle: 'pending' },
      ]),
    )
    controller.dispose()
  })
})
