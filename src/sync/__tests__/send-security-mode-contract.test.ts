import { readFileSync } from 'node:fs'

import { afterEach, describe, expect, it } from 'vitest'

import {
  decodePendingMutation,
  encodePendingMutation,
} from '../../adapters/tauri/domain-ipc-codecs'
import {
  createMemoryLocalEngine,
  type MemoryLocalEngine,
} from '../../adapters/memory'
import { emailAddress } from '../../domain/address'
import { mutationIdFromString } from '../../domain/ids'
import {
  confirmSendMutation,
  failMutationTerminal,
  mutationInstantFromString,
  scheduleMutationRetry,
  sendConfirmation,
  sendMutation,
  startMutationAttempt,
  type SendMutation,
} from '../../domain/pending-mutation'
import {
  sendIntent,
  type SendIntent,
  type SendSecurityMode,
} from '../../domain/send-intent'
import { submissionMessageFromSendIntent } from '../../remote/compat/submission-message'
import { FakeRemoteMail, FakeSubmission } from '../../remote/testing'
import { remoteAccountIdFromString } from '../../remote/types'
import { unwrapOk } from '../../tests/contracts/assertions'
import {
  createTestAccount,
  createTestEmail,
  createTestIdentity,
} from '../../tests/contracts/fixtures'
import { Outbox } from '../outbox'

const owner = createTestAccount('security-mode')
const selectedIdentity = createTestIdentity(owner, 'security-mode')

function intent(mode: SendSecurityMode): SendIntent {
  return sendIntent({
    securityMode: mode,
    identity: selectedIdentity,
    to: [emailAddress(null, 'recipient@example.test')],
    cc: [],
    bcc: [],
    subject: 'Subject',
    body: { text: 'Text', html: '<p>HTML</p>' },
  })
}

function mutation(mode: SendSecurityMode, token: string): SendMutation {
  return sendMutation({
    mutationId: mutationIdFromString(token),
    accountKey: owner.key,
    createdAt: mutationInstantFromString('2026-08-30T12:00:00Z'),
    intent: intent(mode),
  })
}

describe('SEND-SECURITY-MODE-CONTRACT-01', () => {
  let engine: MemoryLocalEngine | undefined

  afterEach(async () => engine?.dispose())

  it.each(['plain', 'boxplotE2eeV1'] as const)(
    'S01-S02 preserves explicit %s through SendIntent, IPC and Memory',
    async (mode) => {
      const value = mutation(mode, `mutation-${mode}`)
      expect(value.intent.securityMode).toBe(mode)
      expect(decodePendingMutation(encodePendingMutation(value))).toEqual(value)

      engine = createMemoryLocalEngine()
      expect(await engine.syncPort.registerAccount(owner)).toEqual({
        ok: true,
        value: undefined,
      })
      expect(await engine.syncPort.stageSendMutation(value)).toEqual({
        ok: true,
        value: undefined,
      })
      const stored = unwrapOk(
        await engine.readRepository.readPendingMutation(
          owner.key,
          value.mutationId,
        ),
      )
      expect(stored.kind).toBe('present')
      if (stored.kind === 'present' && stored.value.kind === 'send') {
        expect(stored.value.intent.securityMode).toBe(mode)
      }
    },
  )

  it('S03 preserves E2EE mode through retry, confirmation and terminal lifecycles', () => {
    const pending = mutation('boxplotE2eeV1', 'lifecycle')
    const firstAttempt = startMutationAttempt(pending)
    const retrying = scheduleMutationRetry(
      firstAttempt,
      mutationInstantFromString('2026-08-30T12:01:00Z'),
    )
    const secondAttempt = startMutationAttempt(retrying)
    const confirmed = confirmSendMutation(
      secondAttempt,
      sendConfirmation(createTestEmail(owner, 'confirmed').id),
    )
    const failed = failMutationTerminal(firstAttempt)

    for (const snapshot of [
      pending,
      firstAttempt,
      retrying,
      secondAttempt,
      confirmed,
      failed,
    ]) {
      expect(snapshot.intent.securityMode).toBe('boxplotE2eeV1')
    }
  })

  it('S04 rejects CAS that changes the immutable security mode', async () => {
    const plain = mutation('plain', 'cas-mode')
    const invalidNext: SendMutation = {
      ...startMutationAttempt(plain),
      intent: intent('boxplotE2eeV1'),
    }
    engine = createMemoryLocalEngine()
    unwrapOk(await engine.syncPort.registerAccount(owner))
    unwrapOk(await engine.syncPort.stageSendMutation(plain))

    expect(
      await engine.syncPort.replacePendingMutationIfCurrent(plain, invalidNext),
    ).toEqual({ ok: false, error: { kind: 'conflict' } })
  })

  it('S08 preserves the legacy plaintext conversion', () => {
    expect(
      submissionMessageFromSendIntent(
        remoteAccountIdFromString('remote-account'),
        intent('plain'),
      ).body,
    ).toEqual({ kind: 'plain', text: 'Text', html: '<p>HTML</p>' })
  })

  it('S09 rejects E2EE before producing a plaintext SubmissionMessage', () => {
    expect(() =>
      submissionMessageFromSendIntent(
        remoteAccountIdFromString('remote-account'),
        intent('boxplotE2eeV1'),
      ),
    ).toThrowError(
      'Encrypted SendIntent cannot use the plaintext submission converter',
    )
  })

  it('S09 never calls Submission.submit for an E2EE intent on the legacy path', async () => {
    const encrypted = mutation('boxplotE2eeV1', 'legacy-downgrade')
    engine = createMemoryLocalEngine()
    unwrapOk(await engine.syncPort.registerAccount(owner))
    unwrapOk(await engine.syncPort.stageSendMutation(encrypted))
    const submission = new FakeSubmission(async () => ({
      kind: 'accepted',
      remoteEmailId: null,
      receiptId: null,
    }))
    const outbox = new Outbox(
      new FakeRemoteMail(),
      submission,
      engine.syncPort,
      engine.readRepository,
      () => mutationInstantFromString('2026-08-30T12:02:00Z'),
    )

    await expect(
      outbox.processSendMutation(
        owner.key,
        remoteAccountIdFromString('remote-account'),
        encrypted.mutationId,
      ),
    ).rejects.toThrowError(
      'Encrypted SendIntent cannot use the plaintext submission converter',
    )
    expect(submission.calls).toHaveLength(0)
  })

  it('S10 keeps the current product send constructor explicitly plaintext', () => {
    const source = readFileSync(
      new URL('../../app/services/send-service.ts', import.meta.url),
      'utf8',
    )
    expect(source).toContain("securityMode: 'plain'")
    expect(source).not.toContain('securityMode ??')
  })
})
