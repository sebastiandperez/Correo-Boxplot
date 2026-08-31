import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { accountKeyFromString } from '../../domain/ids'
import { localEmailId } from '../compat/domain-ids'
import { RemoteError } from '../errors'
import type { RemoteMembershipChange } from '../mail'
import {
  appliedRemoteMutationEvidence,
  inconclusiveRemoteMutationEvidence,
  remoteMutationEvidenceFromExactMatches,
  type RemoteMembershipReconciliationRequest,
  type RemoteMutationEvidence,
  type RemoteMutationReconciler,
  type RemoteSendReconciliationRequest,
} from '../reconciliation'
import {
  remoteAccountIdFromString,
  remoteEmailIdFromString,
  remoteMailboxIdFromString,
  type RemoteAccountId,
  type RemoteEmailId,
} from '../types'
import { NATIVE_MAIL_COMMANDS } from '../native/native-mail-ipc-client'

const root = resolve(import.meta.dirname, '../..')

function source(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

const accountA = remoteAccountIdFromString('account-A')
const accountB = remoteAccountIdFromString('account-B')
const emailA = remoteEmailIdFromString('email-A')
const emailB = remoteEmailIdFromString('email-B')

const membershipChange: RemoteMembershipChange = {
  add: [remoteMailboxIdFromString('archive')],
  remove: [remoteMailboxIdFromString('inbox')],
}

class ExactEvidenceReconciler implements RemoteMutationReconciler {
  constructor(
    private readonly sendMatches: ReadonlyMap<
      RemoteAccountId,
      readonly RemoteEmailId[]
    >,
    private readonly membershipMatches: ReadonlyMap<
      RemoteAccountId,
      readonly RemoteEmailId[]
    >,
  ) {}

  reconcileSend(
    request: RemoteSendReconciliationRequest,
  ): Promise<RemoteMutationEvidence> {
    return Promise.resolve(
      remoteMutationEvidenceFromExactMatches(
        this.sendMatches.get(request.remoteAccountId) ?? [],
      ),
    )
  }

  reconcileMembership(
    request: RemoteMembershipReconciliationRequest,
  ): Promise<RemoteMutationEvidence> {
    return Promise.resolve(
      remoteMutationEvidenceFromExactMatches(
        this.membershipMatches.get(request.remoteAccountId) ?? [],
      ),
    )
  }
}

describe('mutation reconciliation evidence contract', () => {
  it('CR01-CR05 requires a concrete ID and maps only one exact match to applied', () => {
    expect(appliedRemoteMutationEvidence(emailA)).toEqual({
      kind: 'applied',
      emailId: emailA,
    })
    expect(inconclusiveRemoteMutationEvidence()).toEqual({
      kind: 'inconclusive',
    })
    expect(remoteMutationEvidenceFromExactMatches([])).toEqual({
      kind: 'inconclusive',
    })
    expect(remoteMutationEvidenceFromExactMatches([emailA])).toEqual({
      kind: 'applied',
      emailId: emailA,
    })
    expect(remoteMutationEvidenceFromExactMatches([emailA, emailB])).toEqual({
      kind: 'inconclusive',
    })
  })

  it('CR06-CR08 restart lookup needs only account plus durable idempotency key and exposes no heuristics', () => {
    const request: RemoteSendReconciliationRequest = {
      remoteAccountId: accountA,
      idempotencyKey: 'durable-mutation-id',
    }
    expect(Object.keys(request).sort()).toEqual([
      'idempotencyKey',
      'remoteAccountId',
    ])

    const contract = source('remote/reconciliation.ts')
    expect(contract).not.toMatch(/receiptId|subject|timestamp|sentAt|createdAt/)
  })

  it('CR09-CR13 treats membership absence or unlinked postconditions as inconclusive', async () => {
    const reconciler = new ExactEvidenceReconciler(
      new Map(),
      new Map([[accountA, [emailB]]]),
    )
    const base: RemoteMembershipReconciliationRequest = {
      remoteAccountId: accountB,
      idempotencyKey: 'membership-mutation',
      emailId: emailA,
      change: membershipChange,
    }

    await expect(reconciler.reconcileMembership(base)).resolves.toEqual({
      kind: 'inconclusive',
    })
    await expect(
      reconciler.reconcileMembership({ ...base, remoteAccountId: accountA }),
    ).resolves.toEqual({ kind: 'applied', emailId: emailB })
  })

  it('CR14-CR15 remote failure remains an error and cannot invoke mutation submission', async () => {
    const reconciler: RemoteMutationReconciler = {
      reconcileSend: async () => {
        throw new RemoteError('session expired during evidence lookup', {
          kind: 'auth',
          retry: 'never',
          session: 'expire',
          outcome: 'notApplicable',
        })
      },
      reconcileMembership: async () => ({ kind: 'inconclusive' }),
    }

    await expect(
      reconciler.reconcileSend({
        remoteAccountId: accountA,
        idempotencyKey: 'send-mutation',
      }),
    ).rejects.toMatchObject({ session: 'expire', outcome: 'notApplicable' })
    expect(source('remote/reconciliation.ts')).not.toMatch(
      /\bsubmit\(|\bapplyMembershipChange\(/,
    )
  })

  it('CR16-CR17 isolates evidence by remote account and preserves local account scope', async () => {
    const sharedText = remoteEmailIdFromString('same-textual-email-id')
    const reconciler = new ExactEvidenceReconciler(
      new Map([
        [accountA, [sharedText]],
        [accountB, []],
      ]),
      new Map(),
    )

    await expect(
      reconciler.reconcileSend({
        remoteAccountId: accountA,
        idempotencyKey: 'same-mutation-text',
      }),
    ).resolves.toEqual({ kind: 'applied', emailId: sharedText })
    await expect(
      reconciler.reconcileSend({
        remoteAccountId: accountB,
        idempotencyKey: 'same-mutation-text',
      }),
    ).resolves.toEqual({ kind: 'inconclusive' })

    const localA = localEmailId(accountKeyFromString('A'), sharedText)
    const localB = localEmailId(accountKeyFromString('B'), sharedText)
    expect(localA.jmapId).toBe(localB.jmapId)
    expect(localA.accountKey).not.toBe(localB.accountKey)
  })

  it('proves the existing nine-command native surface cannot perform exact Message-ID lookup', () => {
    expect(NATIVE_MAIL_COMMANDS).toHaveLength(9)
    expect(NATIVE_MAIL_COMMANDS).not.toContain('native_imap_find_message_id')
    expect(source('remote/native/ipc.ts')).not.toMatch(/findMessageId/)
  })
})
