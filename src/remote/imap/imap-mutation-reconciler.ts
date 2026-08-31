import type { RemoteMembershipChange } from '../mail'
import {
  inconclusiveRemoteMutationEvidence,
  type RemoteMembershipReconciliationRequest,
  type RemoteMutationEvidence,
  type RemoteMutationReconciler,
  type RemoteSendReconciliationRequest,
} from '../reconciliation'
import type { NativeMailIpcPort } from '../native/ipc'
import { toNativeRemoteError } from '../native/error-mapper'
import type { RemoteAccountId } from '../types'
import { imapEmailId } from './ids'
import { mapNativeMailbox } from './mappers'

const utf8 = new TextEncoder()

export class ImapMutationReconciler implements RemoteMutationReconciler {
  constructor(
    private readonly ipc: NativeMailIpcPort,
    private readonly sessionId: string,
    private readonly accountId: RemoteAccountId,
  ) {}

  async reconcileSend(
    request: RemoteSendReconciliationRequest,
  ): Promise<RemoteMutationEvidence> {
    this.assertAccount(request.remoteAccountId)
    try {
      const mailboxes = await this.ipc.listMailboxes(this.sessionId)
      const sent = mailboxes.filter(
        (mailbox, index) => mapNativeMailbox(mailbox, index).role === 'sent',
      )
      if (sent.length !== 1 || sent[0] === undefined) {
        return inconclusiveRemoteMutationEvidence()
      }
      const result = await this.ipc.findMessageId({
        sessionId: this.sessionId,
        mailbox: sent[0].name,
        messageId: smtpMessageId(request.idempotencyKey),
      })
      return result.kind === 'found'
        ? { kind: 'applied', emailId: imapEmailId(result.emailId) }
        : inconclusiveRemoteMutationEvidence()
    } catch (error: unknown) {
      throw toNativeRemoteError(error)
    }
  }

  reconcileMembership(
    request: RemoteMembershipReconciliationRequest,
  ): Promise<RemoteMutationEvidence> {
    this.assertAccount(request.remoteAccountId)
    void request.idempotencyKey
    void request.emailId
    const change: RemoteMembershipChange = request.change
    void change
    return Promise.resolve(inconclusiveRemoteMutationEvidence())
  }

  private assertAccount(accountId: RemoteAccountId): void {
    if (accountId !== this.accountId) {
      throw toNativeRemoteError({
        kind: 'stateInvalid',
        retry: 'never',
        session: 'keep',
        outcome: 'knownNotApplied',
        code: 'remote_account_mismatch',
      })
    }
  }
}

export function smtpMessageId(idempotencyKey: string): string {
  const binary = Array.from(utf8.encode(idempotencyKey), (byte) =>
    String.fromCharCode(byte),
  ).join('')
  const encoded = btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
  return `<boxplot.${encoded}@boxplot.invalid>`
}
