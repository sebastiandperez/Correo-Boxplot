import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import {
  listen as tauriListen,
  type Event as TauriEvent,
  type UnlistenFn,
} from '@tauri-apps/api/event'

import {
  IPC_READ_COMMANDS,
  IPC_WRITE_COMMANDS,
  LOCAL_STATE_CHANGED_EVENT,
} from './commands'
import type {
  IpcAccount,
  IpcApplyCollectionSyncRequest,
  IpcAttachmentRef,
  IpcCacheEmailBodyRequest,
  IpcEmail,
  IpcEmailBody,
  IpcEmailMailbox,
  IpcIdentity,
  IpcListOwnedRequest,
  IpcLocalChangeBatch,
  IpcMailbox,
  IpcMailboxView,
  IpcMutationRequest,
  IpcOwnedCacheRead,
  IpcOwnedOptionalRead,
  IpcOwnedSnapshotRead,
  IpcPendingMutation,
  IpcReadAccountRequest,
  IpcReadCursorRequest,
  IpcReadEmailRequest,
  IpcReadEmailsRequest,
  IpcReadIdentityRequest,
  IpcReadMailboxRequest,
  IpcReadMailboxViewRequest,
  IpcReadMutationRequest,
  IpcReadResult,
  IpcRegisterAccountRequest,
  IpcRemoveMutationRequest,
  IpcReplaceAttachmentRefsRequest,
  IpcReplaceMailboxViewRequest,
  IpcReplaceMutationRequest,
  IpcSendMutation,
  IpcKeywordMutation,
  IpcMailboxMembershipMutation,
  IpcCollectionSyncCursor,
  IpcLocalEntityRead,
  IpcWriteResult,
} from './dto'

export type IpcTransportFailure = Readonly<{
  kind: 'transportFailure'
  cause: unknown
}>

export type IpcInvoke = <T>(
  command: string,
  args?: Readonly<{ request: object }>,
) => Promise<T>
export type IpcListen = <T>(
  event: string,
  handler: (event: TauriEvent<T>) => void,
) => Promise<UnlistenFn>

const [
  READ_ACCOUNT,
  LIST_ACCOUNTS,
  READ_MAILBOX,
  LIST_MAILBOXES,
  READ_IDENTITY,
  LIST_IDENTITIES,
  READ_EMAIL,
  READ_EMAILS,
  READ_EMAIL_MEMBERSHIPS,
  READ_EMAIL_BODY,
  READ_ATTACHMENT_REFS,
  READ_MAILBOX_VIEW,
  READ_CURSOR,
  READ_MUTATION,
  LIST_MUTATIONS,
] = IPC_READ_COMMANDS
const [
  REGISTER_ACCOUNT,
  APPLY_COLLECTION_SYNC,
  CACHE_EMAIL_BODY,
  REPLACE_ATTACHMENT_REFS,
  REPLACE_MAILBOX_VIEW,
  STAGE_SEND,
  APPLY_KEYWORDS,
  APPLY_MEMBERSHIP,
  REPLACE_MUTATION,
  REMOVE_MUTATION,
] = IPC_WRITE_COMMANDS

export class LocalEngineIpcClient {
  constructor(
    private readonly invoke: IpcInvoke = tauriInvoke,
    private readonly listen: IpcListen = tauriListen,
  ) {}

  private async call<T>(command: string, request: object): Promise<T> {
    try {
      const value = await this.invoke<T>(command, { request })
      if (
        typeof value !== 'object' ||
        value === null ||
        !('ok' in value) ||
        typeof value.ok !== 'boolean' ||
        (value.ok && !('value' in value)) ||
        (!value.ok &&
          (!('error' in value) ||
            typeof value.error !== 'object' ||
            value.error === null ||
            !('kind' in value.error) ||
            typeof value.error.kind !== 'string'))
      ) {
        throw new TypeError('Malformed Local Engine IPC response envelope')
      }
      return value
    } catch (cause) {
      throw { kind: 'transportFailure', cause } satisfies IpcTransportFailure
    }
  }

  readAccount(request: IpcReadAccountRequest) {
    return this.call<IpcReadResult<IpcLocalEntityRead<IpcAccount>>>(
      READ_ACCOUNT,
      request,
    )
  }
  listAccounts() {
    return this.call<IpcReadResult<readonly IpcAccount[]>>(LIST_ACCOUNTS, {})
  }
  readMailbox(request: IpcReadMailboxRequest) {
    return this.call<IpcReadResult<IpcLocalEntityRead<IpcMailbox>>>(
      READ_MAILBOX,
      request,
    )
  }
  listMailboxes(request: IpcListOwnedRequest) {
    return this.call<
      IpcReadResult<IpcOwnedSnapshotRead<readonly IpcMailbox[]>>
    >(LIST_MAILBOXES, request)
  }
  readIdentity(request: IpcReadIdentityRequest) {
    return this.call<IpcReadResult<IpcLocalEntityRead<IpcIdentity>>>(
      READ_IDENTITY,
      request,
    )
  }
  listIdentities(request: IpcListOwnedRequest) {
    return this.call<
      IpcReadResult<IpcOwnedSnapshotRead<readonly IpcIdentity[]>>
    >(LIST_IDENTITIES, request)
  }
  readEmail(request: IpcReadEmailRequest) {
    return this.call<IpcReadResult<IpcLocalEntityRead<IpcEmail>>>(
      READ_EMAIL,
      request,
    )
  }
  readEmails(request: IpcReadEmailsRequest) {
    return this.call<IpcReadResult<readonly IpcLocalEntityRead<IpcEmail>[]>>(
      READ_EMAILS,
      request,
    )
  }
  readEmailMemberships(request: IpcReadEmailRequest) {
    return this.call<
      IpcReadResult<IpcOwnedSnapshotRead<readonly IpcEmailMailbox[]>>
    >(READ_EMAIL_MEMBERSHIPS, request)
  }
  readEmailBody(request: IpcReadEmailRequest) {
    return this.call<IpcReadResult<IpcOwnedCacheRead<IpcEmailBody>>>(
      READ_EMAIL_BODY,
      request,
    )
  }
  readAttachmentRefs(request: IpcReadEmailRequest) {
    return this.call<
      IpcReadResult<IpcOwnedCacheRead<readonly IpcAttachmentRef[]>>
    >(READ_ATTACHMENT_REFS, request)
  }
  readMailboxView(request: IpcReadMailboxViewRequest) {
    return this.call<IpcReadResult<IpcOwnedCacheRead<IpcMailboxView>>>(
      READ_MAILBOX_VIEW,
      request,
    )
  }
  readCollectionSyncCursor(request: IpcReadCursorRequest) {
    return this.call<
      IpcReadResult<IpcOwnedOptionalRead<IpcCollectionSyncCursor>>
    >(READ_CURSOR, request)
  }
  readPendingMutation(request: IpcReadMutationRequest) {
    return this.call<IpcReadResult<IpcOwnedOptionalRead<IpcPendingMutation>>>(
      READ_MUTATION,
      request,
    )
  }
  listPendingMutations(request: IpcListOwnedRequest) {
    return this.call<
      IpcReadResult<IpcOwnedSnapshotRead<readonly IpcPendingMutation[]>>
    >(LIST_MUTATIONS, request)
  }

  registerAccount(request: IpcRegisterAccountRequest) {
    return this.call<IpcWriteResult>(REGISTER_ACCOUNT, request)
  }
  applyCollectionSync(request: IpcApplyCollectionSyncRequest) {
    return this.call<IpcWriteResult>(APPLY_COLLECTION_SYNC, request)
  }
  cacheEmailBody(request: IpcCacheEmailBodyRequest) {
    return this.call<IpcWriteResult>(CACHE_EMAIL_BODY, request)
  }
  replaceAttachmentRefs(request: IpcReplaceAttachmentRefsRequest) {
    return this.call<IpcWriteResult>(REPLACE_ATTACHMENT_REFS, request)
  }
  replaceMailboxView(request: IpcReplaceMailboxViewRequest) {
    return this.call<IpcWriteResult>(REPLACE_MAILBOX_VIEW, request)
  }
  stageSendMutation(request: IpcMutationRequest<IpcSendMutation>) {
    return this.call<IpcWriteResult>(STAGE_SEND, request)
  }
  applyOptimisticKeywordMutation(
    request: IpcMutationRequest<IpcKeywordMutation>,
  ) {
    return this.call<IpcWriteResult>(APPLY_KEYWORDS, request)
  }
  applyOptimisticMailboxMembershipMutation(
    request: IpcMutationRequest<IpcMailboxMembershipMutation>,
  ) {
    return this.call<IpcWriteResult>(APPLY_MEMBERSHIP, request)
  }
  replacePendingMutationIfCurrent(request: IpcReplaceMutationRequest) {
    return this.call<IpcWriteResult>(REPLACE_MUTATION, request)
  }
  removeConfirmedMutation(request: IpcRemoveMutationRequest) {
    return this.call<IpcWriteResult>(REMOVE_MUTATION, request)
  }

  listenLocalStateChanged(
    listener: (batch: IpcLocalChangeBatch) => void,
  ): Promise<UnlistenFn> {
    return this.listen<IpcLocalChangeBatch>(
      LOCAL_STATE_CHANGED_EVENT,
      (event) => {
        if (
          typeof event.payload !== 'object' ||
          event.payload === null ||
          !('hints' in event.payload) ||
          !Array.isArray(event.payload.hints) ||
          event.payload.hints.length === 0
        ) {
          throw new TypeError('Malformed Local Engine change batch')
        }
        listener(event.payload)
      },
    ).catch((cause: unknown) => {
      throw { kind: 'transportFailure', cause } satisfies IpcTransportFailure
    })
  }
}
