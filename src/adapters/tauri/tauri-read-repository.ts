import type { Account } from '../../domain/account'
import type { AttachmentRef } from '../../domain/attachment-ref'
import type { EmailBody } from '../../domain/email-body'
import type { Email } from '../../domain/email'
import type {
  AccountKey,
  MutationId,
  ScopedEmailId,
  ScopedIdentityId,
  ScopedMailboxId,
} from '../../domain/ids'
import { sameScopedEmailId } from '../../domain/ids'
import type { Identity } from '../../domain/identity'
import type { EmailMailbox, Mailbox } from '../../domain/mailbox'
import type { MailboxView, MailboxViewSpec } from '../../domain/mailbox-view'
import type { PendingMutation } from '../../domain/pending-mutation'
import type {
  CollectionDataType,
  CollectionSyncCursor,
} from '../../domain/sync-cursor'
import type {
  IpcLocalEntityRead,
  IpcOwnedCacheRead,
  IpcOwnedOptionalRead,
  IpcOwnedSnapshotRead,
  IpcReadResult,
} from '../../ipc/dto'
import type { LocalEngineIpcClient } from '../../ipc/local-engine-ipc-client'
import type {
  LocalEntityRead,
  OwnedCacheRead,
  OwnedOptionalRead,
  OwnedSnapshotRead,
  ReadRepository,
  ReadResult,
} from '../../ports/read-repository'
import { error, mapTransportFailure, ok } from './adapter-results'
import {
  decodeAccount,
  decodeAttachmentRef,
  decodeCursor,
  decodeEmail,
  decodeEmailBody,
  decodeEmailMailbox,
  decodeIdentity,
  decodeMailbox,
  decodeMailboxView,
  decodePendingMutation,
  encodeAccountKey,
  encodeMailboxViewSpec,
  encodeScopedEmailId,
  encodeScopedIdentityId,
  encodeScopedMailboxId,
} from './domain-ipc-codecs'

export class TauriReadRepository implements ReadRepository {
  constructor(private readonly client: LocalEngineIpcClient) {}

  private async read<I, O>(
    call: () => Promise<IpcReadResult<I>>,
    decode: (value: I) => O,
  ): Promise<ReadResult<O>> {
    try {
      const result = await call()
      if (!result.ok) {
        if (
          !['unavailable', 'corruptState', 'unexpected'].includes(
            result.error.kind,
          )
        ) {
          return error({ kind: 'unexpected' })
        }
        return error(result.error)
      }
      try {
        return ok(decode(result.value))
      } catch {
        return error({ kind: 'corruptState' })
      }
    } catch (cause) {
      return error(mapTransportFailure(cause))
    }
  }

  private entity<I, O>(
    value: IpcLocalEntityRead<I>,
    decode: (value: I) => O,
  ): LocalEntityRead<O> {
    if (value.kind === 'absent') return value
    if (value.kind === 'present')
      return { kind: 'present', value: decode(value.value) }
    throw new TypeError('Invalid local entity presence')
  }
  private snapshot<I, O>(
    value: IpcOwnedSnapshotRead<readonly I[]>,
    decode: (value: I) => O,
  ): OwnedSnapshotRead<readonly O[]> {
    if (value.kind === 'ownerAbsent') return value
    if (value.kind === 'present')
      return { kind: 'present', value: value.value.map(decode) }
    throw new TypeError('Invalid owned snapshot presence')
  }
  private cache<I, O>(
    value: IpcOwnedCacheRead<I>,
    decode: (value: I) => O,
  ): OwnedCacheRead<O> {
    if (value.kind === 'cached')
      return { kind: 'cached', value: decode(value.value) }
    if (value.kind === 'ownerAbsent' || value.kind === 'notCached') return value
    throw new TypeError('Invalid owned cache presence')
  }
  private optional<I, O>(
    value: IpcOwnedOptionalRead<I>,
    decode: (value: I) => O,
  ): OwnedOptionalRead<O> {
    if (value.kind === 'present')
      return { kind: 'present', value: decode(value.value) }
    if (value.kind === 'ownerAbsent' || value.kind === 'absent') return value
    throw new TypeError('Invalid owned optional presence')
  }

  readAccount(key: AccountKey) {
    return this.read(
      () => this.client.readAccount({ accountKey: encodeAccountKey(key) }),
      (value): LocalEntityRead<Account> => this.entity(value, decodeAccount),
    )
  }
  listAccounts() {
    return this.read(
      () => this.client.listAccounts(),
      (value) => value.map(decodeAccount),
    )
  }
  readMailbox(id: ScopedMailboxId) {
    return this.read(
      () => this.client.readMailbox({ mailboxId: encodeScopedMailboxId(id) }),
      (value): LocalEntityRead<Mailbox> => this.entity(value, decodeMailbox),
    )
  }
  listMailboxes(key: AccountKey) {
    return this.read(
      () => this.client.listMailboxes({ accountKey: encodeAccountKey(key) }),
      (value): OwnedSnapshotRead<readonly Mailbox[]> =>
        this.snapshot(value, decodeMailbox),
    )
  }
  readIdentity(id: ScopedIdentityId) {
    return this.read(
      () =>
        this.client.readIdentity({ identityId: encodeScopedIdentityId(id) }),
      (value): LocalEntityRead<Identity> => this.entity(value, decodeIdentity),
    )
  }
  listIdentities(key: AccountKey) {
    return this.read(
      () => this.client.listIdentities({ accountKey: encodeAccountKey(key) }),
      (value): OwnedSnapshotRead<readonly Identity[]> =>
        this.snapshot(value, decodeIdentity),
    )
  }
  readEmail(id: ScopedEmailId) {
    return this.read(
      () => this.client.readEmail({ emailId: encodeScopedEmailId(id) }),
      (value): LocalEntityRead<Email> => this.entity(value, decodeEmail),
    )
  }
  readEmails(ids: readonly ScopedEmailId[]) {
    return this.read(
      () => this.client.readEmails({ emailIds: ids.map(encodeScopedEmailId) }),
      (value): readonly LocalEntityRead<Email>[] => {
        if (value.length !== ids.length) {
          throw new TypeError('Bulk Email response length mismatch')
        }
        return value.map((item, index) => {
          const decoded = this.entity(item, decodeEmail)
          if (
            decoded.kind === 'present' &&
            !sameScopedEmailId(decoded.value.id, ids[index])
          ) {
            throw new TypeError('Bulk Email response position mismatch')
          }
          return decoded
        })
      },
    )
  }
  readEmailMemberships(id: ScopedEmailId) {
    return this.read(
      () =>
        this.client.readEmailMemberships({ emailId: encodeScopedEmailId(id) }),
      (value): OwnedSnapshotRead<readonly EmailMailbox[]> =>
        this.snapshot(value, decodeEmailMailbox),
    )
  }
  readEmailBody(id: ScopedEmailId) {
    return this.read(
      () => this.client.readEmailBody({ emailId: encodeScopedEmailId(id) }),
      (value): OwnedCacheRead<EmailBody> => this.cache(value, decodeEmailBody),
    )
  }
  readAttachmentRefs(id: ScopedEmailId) {
    return this.read(
      () =>
        this.client.readAttachmentRefs({ emailId: encodeScopedEmailId(id) }),
      (value): OwnedCacheRead<readonly AttachmentRef[]> =>
        this.cache(value, (items) => items.map(decodeAttachmentRef)),
    )
  }
  readMailboxView(spec: MailboxViewSpec) {
    return this.read(
      () => this.client.readMailboxView({ spec: encodeMailboxViewSpec(spec) }),
      (value): OwnedCacheRead<MailboxView> =>
        this.cache(value, decodeMailboxView),
    )
  }
  readCollectionSyncCursor(key: AccountKey, dataType: CollectionDataType) {
    return this.read(
      () =>
        this.client.readCollectionSyncCursor({
          accountKey: encodeAccountKey(key),
          dataType,
        }),
      (value): OwnedOptionalRead<CollectionSyncCursor> =>
        this.optional(value, decodeCursor),
    )
  }
  readPendingMutation(key: AccountKey, mutationId: MutationId) {
    return this.read(
      () =>
        this.client.readPendingMutation({
          accountKey: encodeAccountKey(key),
          mutationId,
        }),
      (value): OwnedOptionalRead<PendingMutation> =>
        this.optional(value, decodePendingMutation),
    )
  }
  listPendingMutations(key: AccountKey) {
    return this.read(
      () =>
        this.client.listPendingMutations({ accountKey: encodeAccountKey(key) }),
      (value): OwnedSnapshotRead<readonly PendingMutation[]> =>
        this.snapshot(value, decodePendingMutation),
    )
  }
}
