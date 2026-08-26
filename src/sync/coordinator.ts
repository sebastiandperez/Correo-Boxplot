import type {
  CollectionCursorPrecondition,
  CollectionSyncCommit,
  EmailSyncRecord,
  SyncPort,
} from '../ports/sync-port'
import type { ReadRepository } from '../ports/read-repository'
import type { AccountKey } from '../domain/ids'
import type { Mailbox } from '../domain/mailbox'
import type { Identity } from '../domain/identity'
import {
  mailboxViewFilterAll,
  mailboxViewSort,
  mailboxViewSpec,
  type MailboxViewSpec,
} from '../domain/mailbox-view'
import type {
  CollectionDataType,
  CollectionSyncCursor,
} from '../domain/sync-cursor'
import { collectionSyncCursor } from '../domain/sync-cursor'
import type {
  RemoteCollectionSync,
  RemoteMail,
  RemoteMailboxQuery,
  RemoteQueryOptions,
} from '../remote/mail'
import type {
  RemoteAccountId,
  RemoteEmail,
  RemoteEmailId,
  RemoteIdentity,
  RemoteIdentityId,
  RemoteMailbox,
  RemoteMailboxId,
  RemoteSyncState,
} from '../remote/types'
import { remoteSyncStateFromString } from '../remote/types'
import {
  localCollectionState,
  localEmailId,
  localIdentityId,
  localMailboxId,
  remoteMailboxId,
} from '../remote/compat/domain-ids'
import {
  toDomainEmailRecord,
  toDomainIdentity,
  toDomainMailbox,
  toMailboxView,
} from './mappers'

const QUERY_PAGE_SIZE = 500

type CursorOutcome =
  | Readonly<{ kind: 'absent' }>
  | Readonly<{ kind: 'present'; cursor: CollectionSyncCursor }>

export class Coordinator {
  constructor(
    private readonly remoteMail: RemoteMail,
    private readonly syncPort: SyncPort,
    private readonly readRepository: ReadRepository,
  ) {}

  async syncAccount(
    accountKey: AccountKey,
    remoteAccountId: RemoteAccountId,
  ): Promise<void> {
    await this.syncIdentities(accountKey, remoteAccountId)
    await this.syncMailboxes(accountKey, remoteAccountId)
    await this.syncEmails(accountKey, remoteAccountId)

    const mailboxes = await this.readRepository.listMailboxes(accountKey)
    if (!mailboxes.ok) {
      throw new Error(`listMailboxes failed: ${mailboxes.error.kind}`)
    }
    if (mailboxes.value.kind === 'ownerAbsent') {
      throw new Error(`Account ${accountKey} is not registered locally`)
    }
    for (const mailbox of mailboxes.value.value) {
      await this.syncQueryView(
        accountKey,
        remoteAccountId,
        mailboxViewSpec(
          mailbox.id,
          mailboxViewFilterAll(),
          mailboxViewSort('descending'),
        ),
      )
    }
  }

  async syncIdentities(
    accountKey: AccountKey,
    remoteAccountId: RemoteAccountId,
  ): Promise<void> {
    await this.syncCollection(accountKey, 'identity', async (previous) => {
      const transition = await this.remoteMail.syncIdentities(
        remoteAccountId,
        previous,
      )
      return this.identityCommit(accountKey, transition)
    })
  }

  async syncMailboxes(
    accountKey: AccountKey,
    remoteAccountId: RemoteAccountId,
  ): Promise<void> {
    await this.syncCollection(accountKey, 'mailbox', async (previous) => {
      const transition = await this.remoteMail.syncMailboxes(
        remoteAccountId,
        previous,
      )
      return this.mailboxCommit(accountKey, transition)
    })
  }

  async syncEmails(
    accountKey: AccountKey,
    remoteAccountId: RemoteAccountId,
  ): Promise<void> {
    await this.syncCollection(accountKey, 'email', async (previous) => {
      const transition = await this.remoteMail.syncEmails(
        remoteAccountId,
        previous,
      )
      return this.emailCommit(accountKey, transition)
    })
  }

  async syncQueryView(
    accountKey: AccountKey,
    remoteAccountId: RemoteAccountId,
    spec: MailboxViewSpec,
  ): Promise<void> {
    const result = await this.remoteMail.queryMailbox(
      remoteAccountId,
      remoteMailboxId(spec.mailboxId),
      undefined,
      { limit: QUERY_PAGE_SIZE },
    )
    const view = toMailboxView(spec, accountKey, result)
    if (view === null) return
    const writeResult = await this.syncPort.replaceMailboxView(view)
    if (!writeResult.ok) {
      throw new Error(`replaceMailboxView failed: ${writeResult.error.kind}`)
    }
  }

  async searchEmails(
    remoteAccountId: RemoteAccountId,
    mailboxId: RemoteMailboxId,
    filter?: unknown,
    options?: RemoteQueryOptions,
  ): Promise<RemoteMailboxQuery> {
    return this.remoteMail.queryMailbox(
      remoteAccountId,
      mailboxId,
      filter,
      options,
    )
  }

  private async syncCollection(
    accountKey: AccountKey,
    dataType: CollectionDataType,
    build: (
      previousState: RemoteSyncState | null,
    ) => Promise<
      (precondition: CollectionCursorPrecondition) => CollectionSyncCommit
    >,
  ): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const outcome = await this.readCursorOutcome(accountKey, dataType)
      const previousState =
        outcome.kind === 'absent'
          ? null
          : remoteSyncStateFromString(outcome.cursor.state)
      const createCommit = await build(previousState)
      const precondition: CollectionCursorPrecondition =
        outcome.kind === 'absent'
          ? { kind: 'absent' }
          : { kind: 'matches', cursor: outcome.cursor }
      const result = await this.syncPort.applyCollectionSync(
        createCommit(precondition),
      )
      if (result.ok) return
      if (result.error.kind !== 'conflict') {
        throw new Error(
          `applyCollectionSync(${dataType}) failed: ${result.error.kind}`,
        )
      }
    }
    throw new Error(
      `applyCollectionSync(${dataType}): conflict persisted after retry`,
    )
  }

  private identityCommit(
    accountKey: AccountKey,
    transition: RemoteCollectionSync<RemoteIdentity, RemoteIdentityId>,
  ): (precondition: CollectionCursorPrecondition) => CollectionSyncCommit {
    const nextCursor = this.nextCursor(accountKey, 'identity', transition.state)
    const map = (value: RemoteIdentity): Identity => {
      const mapped = toDomainIdentity(accountKey, value)
      if (mapped === null) {
        throw new Error(`Remote Identity ${value.id} failed Domain validation`)
      }
      return mapped
    }
    return transition.mode === 'replace'
      ? (expectedCursor) => ({
          kind: 'identity',
          mode: 'replace',
          expectedCursor,
          nextCursor,
          snapshot: transition.snapshot.map(map),
        })
      : (expectedCursor) => {
          if (expectedCursor.kind !== 'matches') {
            throw new Error('Identity delta requires a previous cursor')
          }
          return {
            kind: 'identity',
            mode: 'delta',
            expectedCursor,
            nextCursor,
            changed: transition.changed.map(map),
            destroyed: transition.destroyed.map((id) =>
              localIdentityId(accountKey, id),
            ),
          }
        }
  }

  private mailboxCommit(
    accountKey: AccountKey,
    transition: RemoteCollectionSync<RemoteMailbox, RemoteMailboxId>,
  ): (precondition: CollectionCursorPrecondition) => CollectionSyncCommit {
    const nextCursor = this.nextCursor(accountKey, 'mailbox', transition.state)
    const map = (value: RemoteMailbox): Mailbox | null =>
      toDomainMailbox(accountKey, value)
    return transition.mode === 'replace'
      ? (expectedCursor) => ({
          kind: 'mailbox',
          mode: 'replace',
          expectedCursor,
          nextCursor,
          snapshot: transition.snapshot
            .map(map)
            .filter((value): value is Mailbox => value !== null),
        })
      : (expectedCursor) => {
          if (expectedCursor.kind !== 'matches') {
            throw new Error('Mailbox delta requires a previous cursor')
          }
          return {
            kind: 'mailbox',
            mode: 'delta',
            expectedCursor,
            nextCursor,
            changed: transition.changed
              .map(map)
              .filter((value): value is Mailbox => value !== null),
            destroyed: transition.destroyed.map((id) =>
              localMailboxId(accountKey, id),
            ),
          }
        }
  }

  private emailCommit(
    accountKey: AccountKey,
    transition: RemoteCollectionSync<RemoteEmail, RemoteEmailId>,
  ): (precondition: CollectionCursorPrecondition) => CollectionSyncCommit {
    const nextCursor = this.nextCursor(accountKey, 'email', transition.state)
    const map = (value: RemoteEmail): EmailSyncRecord => {
      const mapped = toDomainEmailRecord(accountKey, value)
      if (mapped === null) {
        throw new Error(`Remote Email ${value.id} failed Domain validation`)
      }
      return mapped
    }
    return transition.mode === 'replace'
      ? (expectedCursor) => ({
          kind: 'email',
          mode: 'replace',
          expectedCursor,
          nextCursor,
          snapshot: transition.snapshot.map(map),
        })
      : (expectedCursor) => {
          if (expectedCursor.kind !== 'matches') {
            throw new Error('Email delta requires a previous cursor')
          }
          return {
            kind: 'email',
            mode: 'delta',
            expectedCursor,
            nextCursor,
            changed: transition.changed.map(map),
            destroyed: transition.destroyed.map((id) =>
              localEmailId(accountKey, id),
            ),
          }
        }
  }

  private nextCursor(
    accountKey: AccountKey,
    dataType: CollectionDataType,
    state: RemoteSyncState,
  ): CollectionSyncCursor {
    return collectionSyncCursor({
      accountKey,
      dataType,
      state: localCollectionState(state),
    })
  }

  private async readCursorOutcome(
    accountKey: AccountKey,
    dataType: CollectionDataType,
  ): Promise<CursorOutcome> {
    const result = await this.readRepository.readCollectionSyncCursor(
      accountKey,
      dataType,
    )
    if (!result.ok) {
      throw new Error(
        `readCollectionSyncCursor(${dataType}) failed: ${result.error.kind}`,
      )
    }
    switch (result.value.kind) {
      case 'ownerAbsent':
        throw new Error(`Account ${accountKey} is not registered locally`)
      case 'absent':
        return { kind: 'absent' }
      case 'present':
        return { kind: 'present', cursor: result.value.value }
    }
  }
}
