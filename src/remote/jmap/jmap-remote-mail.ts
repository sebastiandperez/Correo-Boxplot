import type { JmapClient } from '../../jmap/client'
import { JmapMethodError } from '../../jmap/errors'
import type { JmapEmail } from '../../jmap/types'
import type {
  RemoteCollectionSync,
  RemoteKeywordChange,
  RemoteMail,
  RemoteMailboxQuery,
  RemoteMembershipChange,
  RemoteQueryOptions,
} from '../mail'
import { validateRemoteCollectionSync } from '../mail'
import type { RemoteBody } from '../body'
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
import { remoteEmailIdFromString, remoteSyncStateFromString } from '../types'
import { toRemoteError } from './error-mapper'
import { RemoteError } from '../errors'
import {
  mapJmapAttachment,
  mapJmapEmail,
  mapJmapIdentity,
  mapJmapMailbox,
  mapJmapQuery,
} from './mappers'

const PAGE_SIZE = 500
const MAX_PAGES = 10_000
const MAX_DELTA_PAGES = 20

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}

export class JmapRemoteMail implements RemoteMail {
  constructor(private readonly client: JmapClient) {}

  async syncIdentities(
    accountId: RemoteAccountId,
    previousState: RemoteSyncState | null,
  ): Promise<RemoteCollectionSync<RemoteIdentity, RemoteIdentityId>> {
    void previousState
    try {
      const result = await this.client.getIdentities(accountId)
      return validateRemoteCollectionSync(
        {
          mode: 'replace',
          state: remoteSyncStateFromString(result.state),
          snapshot: result.identities.map(mapJmapIdentity),
        },
        (identity) => identity.id,
      )
    } catch (error: unknown) {
      throw toRemoteError(error)
    }
  }

  async syncMailboxes(
    accountId: RemoteAccountId,
    previousState: RemoteSyncState | null,
  ): Promise<RemoteCollectionSync<RemoteMailbox, RemoteMailboxId>> {
    void previousState
    try {
      const result = await this.client.getMailboxes(accountId)
      return validateRemoteCollectionSync(
        {
          mode: 'replace',
          state: remoteSyncStateFromString(result.state),
          snapshot: result.mailboxes.map(mapJmapMailbox),
        },
        (mailbox) => mailbox.id,
      )
    } catch (error: unknown) {
      throw toRemoteError(error)
    }
  }

  async syncEmails(
    accountId: RemoteAccountId,
    previousState: RemoteSyncState | null,
  ): Promise<RemoteCollectionSync<RemoteEmail, RemoteEmailId>> {
    if (previousState === null) return this.completeEmailSnapshot(accountId)

    try {
      const changedIds = new Set<string>()
      const destroyedIds = new Set<string>()
      let state = previousState as string

      for (let page = 0; page < MAX_DELTA_PAGES; page++) {
        const delta = await this.client.getEmailChanges(accountId, state)
        for (const id of [...delta.created, ...delta.updated])
          changedIds.add(id)
        for (const id of delta.destroyed) {
          destroyedIds.add(id)
          changedIds.delete(id)
        }
        state = delta.newState
        if (!delta.hasMoreChanges) {
          const fetched = await this.fetchExactEmails(
            accountId,
            [...changedIds],
            false,
          )
          return validateRemoteCollectionSync(
            {
              mode: 'delta',
              state: remoteSyncStateFromString(state),
              changed: fetched.map(mapJmapEmail),
              destroyed: [...destroyedIds].map(remoteEmailIdFromString),
            },
            (email) => email.id,
          )
        }
      }
      throw new RemoteError(
        `Remote email changes still has more changes after ${MAX_DELTA_PAGES} pages`,
        {
          kind: 'protocol',
          retry: 'safeBackoff',
          session: 'keep',
          outcome: 'knownNotApplied',
        },
      )
    } catch (error: unknown) {
      if (
        error instanceof JmapMethodError &&
        error.type === 'cannotCalculateChanges'
      ) {
        return this.completeEmailSnapshot(accountId)
      }
      throw toRemoteError(error)
    }
  }

  async queryMailbox(
    accountId: RemoteAccountId,
    mailboxId: RemoteMailboxId,
    filter?: unknown,
    options?: RemoteQueryOptions,
  ): Promise<RemoteMailboxQuery> {
    try {
      const queryOptions =
        options === undefined
          ? undefined
          : {
              position: options.position,
              limit: options.limit,
              anchor: options.anchor,
              anchorOffset: options.anchorOffset,
            }
      const result =
        queryOptions === undefined
          ? await this.client.queryEmails(accountId, mailboxId, filter)
          : await this.client.queryEmails(
              accountId,
              mailboxId,
              filter,
              queryOptions,
            )
      return mapJmapQuery(result)
    } catch (error: unknown) {
      throw toRemoteError(error)
    }
  }

  async fetchBody(
    accountId: RemoteAccountId,
    emailId: RemoteEmailId,
  ): Promise<RemoteBody> {
    try {
      const body = await this.client.getEmailBody(accountId, emailId)
      return { kind: 'plain', text: body.text, html: body.html }
    } catch (error: unknown) {
      throw toRemoteError(error)
    }
  }

  async fetchAttachments(
    accountId: RemoteAccountId,
    emailId: RemoteEmailId,
  ): Promise<readonly RemoteAttachment[]> {
    try {
      return (await this.client.getEmailAttachments(accountId, emailId)).map(
        mapJmapAttachment,
      )
    } catch (error: unknown) {
      throw toRemoteError(error)
    }
  }

  async applyKeywordChange(
    accountId: RemoteAccountId,
    emailId: RemoteEmailId,
    change: RemoteKeywordChange,
  ): Promise<void> {
    const patch: Record<string, boolean> = {}
    for (const value of change.add) patch[value] = true
    for (const value of change.remove) patch[value] = false
    try {
      await this.client.updateEmailKeywords(accountId, emailId, patch)
    } catch (error: unknown) {
      throw toRemoteError(error)
    }
  }

  async applyMembershipChange(
    accountId: RemoteAccountId,
    emailId: RemoteEmailId,
    change: RemoteMembershipChange,
  ): Promise<void> {
    const patch: Record<string, boolean> = {}
    for (const value of change.add) patch[value] = true
    for (const value of change.remove) patch[value] = false
    try {
      await this.client.updateEmailMailboxes(accountId, emailId, patch)
    } catch (error: unknown) {
      throw toRemoteError(error)
    }
  }

  private async completeEmailSnapshot(
    accountId: RemoteAccountId,
  ): Promise<RemoteCollectionSync<RemoteEmail, RemoteEmailId>> {
    try {
      const { mailboxes } = await this.client.getMailboxes(accountId)
      const ids = new Set<string>()
      for (const mailbox of mailboxes) {
        const mailboxIds = new Set<string>()
        let position = 0
        let total: number | null = null
        let queryState: string | null = null
        for (let page = 0; page < MAX_PAGES; page++) {
          const query = await this.client.queryEmails(
            accountId,
            mailbox.id,
            undefined,
            { position, limit: PAGE_SIZE },
          )
          if (
            !Number.isSafeInteger(query.total) ||
            query.total < 0 ||
            query.position !== position ||
            query.ids.length > PAGE_SIZE
          ) {
            throw new Error(`Malformed query page for Mailbox ${mailbox.id}`)
          }
          total ??= query.total
          queryState ??= query.queryState
          if (query.total !== total || query.queryState !== queryState) {
            throw new Error(`Mailbox ${mailbox.id} changed during replacement`)
          }
          for (const id of query.ids) {
            if (mailboxIds.has(id)) {
              throw new Error(`Repeated Email ${id} in Mailbox ${mailbox.id}`)
            }
            mailboxIds.add(id)
            ids.add(id)
          }
          const next = query.position + query.ids.length
          if (next >= query.total) break
          if (next <= position) {
            throw new Error(`Query made no progress for Mailbox ${mailbox.id}`)
          }
          position = next
          if (page + 1 === MAX_PAGES) {
            throw new Error('Mailbox replacement exceeded safety bound')
          }
        }
      }

      const fetched = await this.fetchExactEmails(accountId, [...ids], true)
      return validateRemoteCollectionSync(
        {
          mode: 'replace',
          state: remoteSyncStateFromString(fetched.state),
          snapshot: fetched.emails.map(mapJmapEmail),
        },
        (email) => email.id,
      )
    } catch (error: unknown) {
      throw toRemoteError(error)
    }
  }

  private async fetchExactEmails(
    accountId: RemoteAccountId,
    ids: readonly string[],
    includeState: true,
  ): Promise<{ emails: JmapEmail[]; state: string }>
  private async fetchExactEmails(
    accountId: RemoteAccountId,
    ids: readonly string[],
    includeState: false,
  ): Promise<JmapEmail[]>
  private async fetchExactEmails(
    accountId: RemoteAccountId,
    ids: readonly string[],
    includeState: boolean,
  ): Promise<JmapEmail[] | { emails: JmapEmail[]; state: string }> {
    const emails: JmapEmail[] = []
    let state: string | null = null
    const batches = ids.length === 0 ? [[]] : chunks(ids, PAGE_SIZE)
    for (const batch of batches) {
      const result = await this.client.getEmails(accountId, batch)
      state ??= result.state
      if (includeState && result.state !== state) {
        throw new Error('Email collection changed during replacement')
      }
      const expected = new Set(batch)
      for (const email of result.emails) {
        if (!expected.delete(email.id)) {
          throw new Error(
            `Email/get returned unexpected or duplicate ${email.id}`,
          )
        }
        emails.push(email)
      }
      if (expected.size > 0) {
        throw new Error('Email/get omitted a requested Email')
      }
    }
    return includeState ? { emails, state: state ?? '' } : emails
  }
}
