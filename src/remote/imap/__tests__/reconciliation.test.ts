import { describe, expect, it, vi } from 'vitest'

import type {
  NativeFindMessageIdRequest,
  NativeFindMessageIdResponse,
  NativeMailIpcPort,
} from '../../native/ipc'
import { remoteEmailIdFromString } from '../../types'
import { decodeImapEmailId, imapAccountId } from '../ids'
import {
  ImapMutationReconciler,
  smtpMessageId,
} from '../imap-mutation-reconciler'

function nativeIpc(
  result: NativeFindMessageIdResponse,
  requests: NativeFindMessageIdRequest[],
): NativeMailIpcPort {
  const unused = async (): Promise<never> => {
    throw new Error('unused native capability')
  }
  return {
    open: unused,
    close: unused,
    listMailboxes: vi.fn(async () => [
      {
        name: 'INBOX',
        messages: 0,
        unseen: 0,
        uidValidity: 1,
        uidNext: 1,
      },
      {
        name: 'SENT',
        messages: 1,
        unseen: 0,
        uidValidity: 71,
        uidNext: 43,
      },
    ]),
    snapshotMailbox: unused,
    fetchBody: unused,
    fetchAttachments: unused,
    findMessageId: vi.fn(async (request) => {
      requests.push(request)
      return result
    }),
    storeFlags: unused,
    move: unused,
    smtpSubmit: unused,
  }
}

describe('ImapMutationReconciler', () => {
  it.each([
    [{ kind: 'notFound' } as const, { kind: 'inconclusive' } as const],
    [{ kind: 'ambiguous' } as const, { kind: 'inconclusive' } as const],
  ])('preserves normal non-positive evidence %o', async (native, expected) => {
    const requests: NativeFindMessageIdRequest[] = []
    const accountId = imapAccountId('alice@boxplot.test')
    const reconciler = new ImapMutationReconciler(
      nativeIpc(native, requests),
      'same-active-session',
      accountId,
    )

    await expect(
      reconciler.reconcileSend({
        remoteAccountId: accountId,
        idempotencyKey: 'mutation-1',
      }),
    ).resolves.toEqual(expected)
    expect(requests).toEqual([
      {
        sessionId: 'same-active-session',
        mailbox: 'SENT',
        messageId: '<boxplot.bXV0YXRpb24tMQ@boxplot.invalid>',
      },
    ])
  })

  it('maps one authoritative match to the real IMAP RemoteEmailId', async () => {
    const requests: NativeFindMessageIdRequest[] = []
    const accountId = imapAccountId('alice@boxplot.test')
    const reconciler = new ImapMutationReconciler(
      nativeIpc(
        {
          kind: 'found',
          emailId: { mailbox: 'SENT', uidValidity: 71, uid: 42 },
        },
        requests,
      ),
      'session-1',
      accountId,
    )

    const evidence = await reconciler.reconcileSend({
      remoteAccountId: accountId,
      idempotencyKey: 'mutation-1',
    })

    expect(evidence.kind).toBe('applied')
    if (evidence.kind !== 'applied') throw new Error('expected evidence')
    expect(decodeImapEmailId(evidence.emailId)).toEqual({
      mailbox: 'SENT',
      uidValidity: 71,
      uid: 42,
    })
  })

  it('rejects foreign account scope and never performs lookup', async () => {
    const requests: NativeFindMessageIdRequest[] = []
    const reconciler = new ImapMutationReconciler(
      nativeIpc({ kind: 'notFound' }, requests),
      'session-A',
      imapAccountId('alice@boxplot.test'),
    )
    await expect(
      reconciler.reconcileSend({
        remoteAccountId: imapAccountId('bob@boxplot.test'),
        idempotencyKey: 'same-looking-mutation',
      }),
    ).rejects.toMatchObject({ kind: 'stateInvalid' })
    expect(requests).toEqual([])
  })

  it('keeps IMAP membership ambiguity inconclusive without fabricating an ID', async () => {
    const requests: NativeFindMessageIdRequest[] = []
    const accountId = imapAccountId('alice@boxplot.test')
    const reconciler = new ImapMutationReconciler(
      nativeIpc({ kind: 'notFound' }, requests),
      'session-A',
      accountId,
    )
    await expect(
      reconciler.reconcileMembership({
        remoteAccountId: accountId,
        idempotencyKey: 'move-1',
        emailId: remoteEmailIdFromString('source-id'),
        change: { add: [], remove: [] },
      }),
    ).resolves.toEqual({ kind: 'inconclusive' })
    expect(requests).toEqual([])
  })

  it('derives the frozen UTF-8 base64url Message-ID exactly', () => {
    expect(smtpMessageId('mutación/+/=')).toBe(
      '<boxplot.bXV0YWNpw7NuLysvPQ@boxplot.invalid>',
    )
  })
})
