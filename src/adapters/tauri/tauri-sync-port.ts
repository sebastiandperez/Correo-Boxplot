import type { Account } from '../../domain/account'
import type { AttachmentRef } from '../../domain/attachment-ref'
import type { EmailBody } from '../../domain/email-body'
import type { AccountKey, MutationId, ScopedEmailId } from '../../domain/ids'
import type { MailboxView } from '../../domain/mailbox-view'
import type {
  KeywordMutation,
  MailboxMembershipMutation,
  PendingMutation,
  SendMutation,
} from '../../domain/pending-mutation'
import type { IpcWriteResult } from '../../ipc/dto'
import type { LocalEngineIpcClient } from '../../ipc/local-engine-ipc-client'
import type {
  CollectionSyncCommit,
  SyncPort,
  WriteResult,
} from '../../ports/sync-port'
import { error, mapTransportFailure, ok } from './adapter-results'
import {
  encodeAccount,
  encodeAttachmentRef,
  encodeCollectionSyncCommit,
  encodeEmailBody,
  encodeKeywordMutation,
  encodeMailboxMembershipMutation,
  encodeMailboxView,
  encodePendingMutation,
  encodeScopedEmailId,
  encodeSendMutation,
} from './domain-ipc-codecs'

export class TauriSyncPort implements SyncPort {
  constructor(private readonly client: LocalEngineIpcClient) {}
  private async write(
    call: () => Promise<IpcWriteResult>,
  ): Promise<WriteResult> {
    try {
      const result = await call()
      if (result.ok) {
        return result.value === null
          ? ok(undefined)
          : error({ kind: 'unexpected' })
      }
      if (
        !['unavailable', 'corruptState', 'conflict', 'unexpected'].includes(
          result.error.kind,
        )
      ) {
        return error({ kind: 'unexpected' })
      }
      return error(result.error)
    } catch (cause) {
      return error(mapTransportFailure(cause))
    }
  }
  registerAccount(value: Account) {
    return this.write(() =>
      this.client.registerAccount({ account: encodeAccount(value) }),
    )
  }
  applyCollectionSync(value: CollectionSyncCommit) {
    return this.write(() =>
      this.client.applyCollectionSync({
        commit: encodeCollectionSyncCommit(value),
      }),
    )
  }
  cacheEmailBody(value: EmailBody) {
    return this.write(() =>
      this.client.cacheEmailBody({ body: encodeEmailBody(value) }),
    )
  }
  replaceAttachmentRefs(
    emailId: ScopedEmailId,
    refs: readonly AttachmentRef[],
  ) {
    return this.write(() =>
      this.client.replaceAttachmentRefs({
        emailId: encodeScopedEmailId(emailId),
        refs: refs.map(encodeAttachmentRef),
      }),
    )
  }
  replaceMailboxView(value: MailboxView) {
    return this.write(() =>
      this.client.replaceMailboxView({ view: encodeMailboxView(value) }),
    )
  }
  stageSendMutation(value: SendMutation) {
    return this.write(() =>
      this.client.stageSendMutation({ mutation: encodeSendMutation(value) }),
    )
  }
  applyOptimisticKeywordMutation(value: KeywordMutation) {
    return this.write(() =>
      this.client.applyOptimisticKeywordMutation({
        mutation: encodeKeywordMutation(value),
      }),
    )
  }
  applyOptimisticMailboxMembershipMutation(value: MailboxMembershipMutation) {
    return this.write(() =>
      this.client.applyOptimisticMailboxMembershipMutation({
        mutation: encodeMailboxMembershipMutation(value),
      }),
    )
  }
  replacePendingMutationIfCurrent(
    expected: PendingMutation,
    next: PendingMutation,
  ) {
    return this.write(() =>
      this.client.replacePendingMutationIfCurrent({
        expected: encodePendingMutation(expected),
        next: encodePendingMutation(next),
      }),
    )
  }
  removeConfirmedMutation(accountKey: AccountKey, mutationId: MutationId) {
    return this.write(() =>
      this.client.removeConfirmedMutation({ accountKey, mutationId }),
    )
  }
}
