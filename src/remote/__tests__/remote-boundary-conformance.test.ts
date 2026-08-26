import { afterEach, describe, expect, it } from 'vitest'
import { createMemoryLocalEngine } from '../../adapters/memory'
import type { MemoryLocalEngine } from '../../adapters/memory'
import { Coordinator } from '../../sync/coordinator'
import { Outbox } from '../../sync/outbox'
import { unwrapOk } from '../../tests/contracts/assertions'
import {
  createTestAccount,
  createTestIdentity,
  createTestKeywordMutation,
  createTestSendMutation,
} from '../../tests/contracts/fixtures'
import { FakeRemoteMail, FakeSubmission } from '../testing'
import { localEmailId } from '../compat/domain-ids'
import {
  remoteAccountIdFromString,
  remoteBlobIdFromString,
  remoteEmailIdFromString,
  remoteIdentityIdFromString,
  remoteMailboxIdFromString,
  remoteSyncStateFromString,
  remoteThreadIdFromString,
  type RemoteEmail,
} from '../types'

const remoteAccount = remoteAccountIdFromString('opaque/account')
const inboxId = remoteMailboxIdFromString('box:inbox')
const sentId = remoteMailboxIdFromString('box:sent')
const trashId = remoteMailboxIdFromString('box:trash')

function remoteEmail(index: number): RemoteEmail {
  return {
    id: remoteEmailIdFromString(`opaque/email/${index}`),
    blobId: remoteBlobIdFromString(`opaque/blob/${index}`),
    threadId: remoteThreadIdFromString(`opaque/thread/${index}`),
    sender: [{ name: 'Sender', email: 'sender@example.test' }],
    from: [{ name: 'Sender', email: 'sender@example.test' }],
    replyTo: null,
    to: [{ name: null, email: 'recipient@example.test' }],
    cc: [],
    bcc: null,
    subject: `Message ${index}`,
    sentAt: null,
    receivedAt: `2026-01-0${index}T00:00:00Z`,
    size: index,
    preview: `preview ${index}`,
    hasAttachment: false,
    keywords: new Set(index === 1 ? ['$seen'] : []),
    mailboxIds: [inboxId],
  }
}

describe('REMOTE-BOUNDARY-CONFORMANCE-01', () => {
  let engine: MemoryLocalEngine

  afterEach(async () => engine?.dispose())

  it('runs Coordinator and Outbox end-to-end without a concrete protocol', async () => {
    engine = createMemoryLocalEngine()
    const account = createTestAccount('remote-boundary')
    unwrapOk(await engine.syncPort.registerAccount(account))
    const emails = [remoteEmail(1), remoteEmail(2), remoteEmail(3)]
    const keywordCalls: string[] = []
    const mail = new FakeRemoteMail({
      syncIdentities: async () => ({
        mode: 'replace',
        state: remoteSyncStateFromString('identity:{opaque}'),
        snapshot: [
          {
            id: remoteIdentityIdFromString('identity/opaque'),
            name: 'Alice',
            email: 'alice@example.test',
            replyTo: null,
            bcc: null,
          },
        ],
      }),
      syncMailboxes: async () => ({
        mode: 'replace',
        state: remoteSyncStateFromString('mailbox:opaque'),
        snapshot: [
          {
            id: inboxId,
            name: 'Inbox',
            parent: null,
            role: 'inbox',
            sortOrder: 0,
            totalEmails: 3,
            unreadEmails: 2,
            rights: {
              mayReadItems: true,
              mayAddItems: true,
              mayRemoveItems: true,
              maySetSeen: true,
              maySetKeywords: true,
              maySubmit: true,
            },
          },
          {
            id: sentId,
            name: 'Sent',
            parent: null,
            role: 'sent',
            sortOrder: 1,
            totalEmails: 0,
            unreadEmails: 0,
            rights: {
              mayReadItems: true,
              mayAddItems: true,
              mayRemoveItems: true,
              maySetSeen: true,
              maySetKeywords: true,
              maySubmit: true,
            },
          },
          {
            id: trashId,
            name: 'Trash',
            parent: null,
            role: 'trash',
            sortOrder: 2,
            totalEmails: 0,
            unreadEmails: 0,
            rights: {
              mayReadItems: true,
              mayAddItems: true,
              mayRemoveItems: true,
              maySetSeen: true,
              maySetKeywords: true,
              maySubmit: true,
            },
          },
        ],
      }),
      syncEmails: async () => ({
        mode: 'replace',
        state: remoteSyncStateFromString('{"remote":3}'),
        snapshot: emails,
      }),
      queryMailbox: async (_account, mailbox) => {
        const ids = mailbox === inboxId ? emails.map((email) => email.id) : []
        return {
          ids,
          queryState: remoteSyncStateFromString(`query:${mailbox}`),
          total: ids.length,
          position: 0,
          canCalculateChanges: true,
        }
      },
      applyKeywordChange: async (_account, emailId) => {
        keywordCalls.push(emailId)
      },
    })
    const coordinator = new Coordinator(
      mail,
      engine.syncPort,
      engine.readRepository,
    )

    await coordinator.syncAccount(account.key, remoteAccount)

    const read = unwrapOk(
      await engine.readRepository.readEmails(
        emails.map((email) => localEmailId(account.key, email.id)),
      ),
    )
    expect(read).toHaveLength(3)

    const first = read[0]
    if (first.kind !== 'present') throw new Error('expected first email')
    const keywordMutation = createTestKeywordMutation(
      account,
      first.value,
      'remote-boundary',
    )
    unwrapOk(
      await engine.syncPort.applyOptimisticKeywordMutation(keywordMutation),
    )
    await mail.applyKeywordChange(remoteAccount, emails[0].id, {
      add: ['$flagged'],
      remove: [],
    })
    expect(keywordCalls).toEqual([emails[0].id])

    const identity = createTestIdentity(account, 'remote-boundary')
    const send = createTestSendMutation(account, identity, 'remote-boundary')
    unwrapOk(await engine.syncPort.stageSendMutation(send))
    const submission = new FakeSubmission(async () => ({
      kind: 'accepted',
      remoteEmailId: remoteEmailIdFromString('accepted/email'),
      receiptId: 'receipt',
    }))
    const outbox = new Outbox(
      mail,
      submission,
      engine.syncPort,
      engine.readRepository,
    )
    await expect(
      outbox.processSendMutation(account.key, remoteAccount, send.mutationId),
    ).resolves.toEqual({ kind: 'sent' })
    const afterSend = unwrapOk(
      await engine.readRepository.readPendingMutation(
        account.key,
        send.mutationId,
      ),
    )
    expect(afterSend.kind).toBe('absent')
  })

  it('keeps accepted submission without a remote Email ID in reconciliation', async () => {
    engine = createMemoryLocalEngine()
    const account = createTestAccount('smtp-shape')
    const identity = createTestIdentity(account, 'smtp-shape')
    const send = createTestSendMutation(account, identity, 'smtp-shape')
    unwrapOk(await engine.syncPort.registerAccount(account))
    unwrapOk(await engine.syncPort.stageSendMutation(send))
    const mail = new FakeRemoteMail()
    const submission = new FakeSubmission(async () => ({
      kind: 'accepted',
      remoteEmailId: null,
      receiptId: 'receipt-only',
    }))
    const outbox = new Outbox(
      mail,
      submission,
      engine.syncPort,
      engine.readRepository,
    )
    await expect(
      outbox.processSendMutation(account.key, remoteAccount, send.mutationId),
    ).resolves.toEqual({ kind: 'needsReconciliation' })
    const pending = unwrapOk(
      await engine.readRepository.readPendingMutation(
        account.key,
        send.mutationId,
      ),
    )
    expect(pending.kind).toBe('present')
    if (pending.kind === 'present') {
      expect(pending.value.lifecycle.status).toBe('inFlight')
    }
  })
})
