import type { RemoteBody } from '../body'
import type {
  RemoteCollectionSync,
  RemoteKeywordChange,
  RemoteMail,
  RemoteMailboxQuery,
  RemoteMembershipChange,
  RemoteQueryOptions,
} from '../mail'
import { validateRemoteCollectionSync } from '../mail'
import type {
  RemoteAccountId,
  RemoteAttachment,
  RemoteEmail,
  RemoteEmailId,
  RemoteIdentity,
  RemoteIdentityId,
  RemoteMailbox,
  RemoteMailboxId,
  RemoteSyncState,
} from '../types'
import { remoteSyncStateFromString } from '../types'

export type FakeRemoteMailHandlers = Partial<{
  syncIdentities: RemoteMail['syncIdentities']
  syncMailboxes: RemoteMail['syncMailboxes']
  syncEmails: RemoteMail['syncEmails']
  queryMailbox: RemoteMail['queryMailbox']
  fetchBody: RemoteMail['fetchBody']
  fetchAttachments: RemoteMail['fetchAttachments']
  applyKeywordChange: RemoteMail['applyKeywordChange']
  applyMembershipChange: RemoteMail['applyMembershipChange']
}>

const emptyState = remoteSyncStateFromString('fake-state')

export class FakeRemoteMail implements RemoteMail {
  constructor(private readonly handlers: FakeRemoteMailHandlers = {}) {}

  syncIdentities(
    accountId: RemoteAccountId,
    previousState: RemoteSyncState | null,
  ): Promise<RemoteCollectionSync<RemoteIdentity, RemoteIdentityId>> {
    const result =
      this.handlers.syncIdentities?.(accountId, previousState) ??
      Promise.resolve({
        mode: 'replace' as const,
        state: emptyState,
        snapshot: [],
      })
    return result.then((value) =>
      validateRemoteCollectionSync(value, (item) => item.id),
    )
  }

  syncMailboxes(
    accountId: RemoteAccountId,
    previousState: RemoteSyncState | null,
  ): Promise<RemoteCollectionSync<RemoteMailbox, RemoteMailboxId>> {
    const result =
      this.handlers.syncMailboxes?.(accountId, previousState) ??
      Promise.resolve({
        mode: 'replace' as const,
        state: emptyState,
        snapshot: [],
      })
    return result.then((value) =>
      validateRemoteCollectionSync(value, (item) => item.id),
    )
  }

  syncEmails(
    accountId: RemoteAccountId,
    previousState: RemoteSyncState | null,
  ): Promise<RemoteCollectionSync<RemoteEmail, RemoteEmailId>> {
    const result =
      this.handlers.syncEmails?.(accountId, previousState) ??
      Promise.resolve({
        mode: 'replace' as const,
        state: emptyState,
        snapshot: [],
      })
    return result.then((value) =>
      validateRemoteCollectionSync(value, (item) => item.id),
    )
  }

  queryMailbox(
    accountId: RemoteAccountId,
    mailboxId: RemoteMailboxId,
    filter?: unknown,
    options?: RemoteQueryOptions,
  ): Promise<RemoteMailboxQuery> {
    if (this.handlers.queryMailbox) {
      return this.handlers.queryMailbox(accountId, mailboxId, filter, options)
    }
    return Promise.resolve({
      ids: [],
      queryState: emptyState,
      total: 0,
      position: options?.position ?? 0,
      canCalculateChanges: false,
    })
  }

  fetchBody(
    accountId: RemoteAccountId,
    emailId: RemoteEmailId,
  ): Promise<RemoteBody> {
    return (
      this.handlers.fetchBody?.(accountId, emailId) ??
      Promise.resolve({ kind: 'plain', text: null, html: null })
    )
  }

  fetchAttachments(
    accountId: RemoteAccountId,
    emailId: RemoteEmailId,
  ): Promise<readonly RemoteAttachment[]> {
    return (
      this.handlers.fetchAttachments?.(accountId, emailId) ??
      Promise.resolve([])
    )
  }

  applyKeywordChange(
    accountId: RemoteAccountId,
    emailId: RemoteEmailId,
    change: RemoteKeywordChange,
  ): Promise<void> {
    return (
      this.handlers.applyKeywordChange?.(accountId, emailId, change) ??
      Promise.resolve()
    )
  }

  applyMembershipChange(
    accountId: RemoteAccountId,
    emailId: RemoteEmailId,
    change: RemoteMembershipChange,
  ): Promise<void> {
    return (
      this.handlers.applyMembershipChange?.(accountId, emailId, change) ??
      Promise.resolve()
    )
  }
}
