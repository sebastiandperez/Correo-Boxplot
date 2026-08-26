import type {
  SyncPort,
  CollectionCursorPrecondition,
  CollectionSyncCommit,
} from '../ports/sync-port'
import type { ReadRepository } from '../ports/read-repository'
import type { JmapClient } from '../jmap/client'
import type { JmapEmail, JmapQueryResult, QueryOptions } from '../jmap/types'
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
import {
  collectionSyncCursor,
  collectionSyncStateFromString,
} from '../domain/sync-cursor'
import type { EmailSyncRecord } from '../ports/sync-port'
import { jmapEmailIdFromString, scopedEmailId } from '../domain/ids'
import { JmapMethodError } from '../jmap/errors'
import {
  toDomainEmailRecord,
  toDomainIdentity,
  toDomainMailbox,
  toMailboxView,
} from './mappers'

const QUERY_PAGE_SIZE = 500
const EMAIL_GET_BATCH_SIZE = 500
const MAX_HARD_RESET_PAGES_PER_MAILBOX = 10_000

/** Bounds Email/changes pagination within a single syncEmails call so a
 * misbehaving server cannot make it loop forever on hasMoreChanges. */
const MAX_DELTA_PAGES = 20

type CursorOutcome =
  | Readonly<{ kind: 'absent' }>
  | Readonly<{ kind: 'present'; cursor: CollectionSyncCursor }>

function chunk<T>(values: readonly T[], size: number): T[][] {
  const batches: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    batches.push(values.slice(index, index + size))
  }
  return batches
}

export class Coordinator {
  constructor(
    private readonly client: JmapClient,
    private readonly syncPort: SyncPort,
    private readonly readRepository: ReadRepository,
  ) {}

  /** Materializes all currently supported remote account data in dependency order. */
  async syncAccount(
    accountKey: AccountKey,
    jmapAccountId: string,
  ): Promise<void> {
    await this.syncIdentities(accountKey, jmapAccountId)
    await this.syncMailboxes(accountKey, jmapAccountId)
    await this.syncEmails(accountKey, jmapAccountId)

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
        jmapAccountId,
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
    jmapAccountId: string,
  ): Promise<void> {
    const { identities, state } = await this.client.getIdentities(jmapAccountId)
    const snapshot: Identity[] = []
    for (const raw of identities) {
      const mapped = toDomainIdentity(accountKey, raw)
      if (mapped === null) {
        throw new Error(`Identity ${raw.id} failed Domain validation`)
      }
      snapshot.push(mapped)
    }

    const nextCursor = collectionSyncCursor({
      accountKey,
      dataType: 'identity',
      state: collectionSyncStateFromString(state),
    })

    await this.applyReplaceWithRetry(
      accountKey,
      'identity',
      (precondition) => ({
        kind: 'identity',
        mode: 'replace',
        expectedCursor: precondition,
        nextCursor,
        snapshot,
      }),
    )
  }

  /**
   * Synchronizes the Mailbox collection. JMAP only exposes Mailbox/get (no
   * Mailbox/changes) through this port, so mailbox sync is always a full
   * replace using Mailbox/get's own state token as the next cursor.
   */
  async syncMailboxes(
    accountKey: AccountKey,
    jmapAccountId: string,
  ): Promise<void> {
    const { mailboxes, state } = await this.client.getMailboxes(jmapAccountId)

    const snapshot: Mailbox[] = []
    for (const raw of mailboxes) {
      const mapped = toDomainMailbox(accountKey, raw)
      if (mapped !== null) snapshot.push(mapped)
    }

    const nextCursor = collectionSyncCursor({
      accountKey,
      dataType: 'mailbox',
      state: collectionSyncStateFromString(state),
    })

    await this.applyReplaceWithRetry(accountKey, 'mailbox', (precondition) => ({
      kind: 'mailbox',
      mode: 'replace',
      expectedCursor: precondition,
      nextCursor,
      snapshot,
    }))
  }

  /**
   * Synchronizes the Email collection incrementally using Email/changes.
   * With no local cursor yet, falls back to performHardReset — there is no
   * valid sinceState to start a delta from. If the server rejects the
   * cursor mid-flight (cannotCalculateChanges), also falls back to
   * performHardReset.
   */
  async syncEmails(
    accountKey: AccountKey,
    jmapAccountId: string,
  ): Promise<void> {
    return this.syncEmailsPage(accountKey, jmapAccountId, 0, 0)
  }

  private async syncEmailsPage(
    accountKey: AccountKey,
    jmapAccountId: string,
    conflictRetries: number,
    page: number,
  ): Promise<void> {
    const outcome = await this.readCursorOutcome(accountKey, 'email')

    if (outcome.kind === 'absent') {
      await this.performHardReset(accountKey, jmapAccountId)
      return
    }

    const cursor = outcome.cursor

    let delta
    try {
      delta = await this.client.getEmailChanges(jmapAccountId, cursor.state)
    } catch (err: unknown) {
      if (
        err instanceof JmapMethodError &&
        err.type === 'cannotCalculateChanges'
      ) {
        await this.performHardReset(accountKey, jmapAccountId)
        return
      }
      throw err
    }

    // Contract requires changed/destroyed to be disjoint. A server could in
    // principle report the same id as both created/updated and destroyed
    // within one delta — treat destruction as authoritative.
    const destroyedIds = new Set(delta.destroyed)
    const idsToFetch = [
      ...new Set([...delta.created, ...delta.updated]),
    ].filter((id) => !destroyedIds.has(id))

    let fetchedEmails: readonly JmapEmail[] = []
    if (idsToFetch.length > 0) {
      const result = await this.client.getEmails(jmapAccountId, idsToFetch)
      fetchedEmails = result.emails
    }

    const changed: EmailSyncRecord[] = []
    for (const raw of fetchedEmails) {
      const mapped = toDomainEmailRecord(accountKey, raw)
      if (mapped !== null) changed.push(mapped)
    }

    const destroyed = delta.destroyed.map((id) =>
      scopedEmailId(accountKey, jmapEmailIdFromString(id)),
    )

    const nextCursor = collectionSyncCursor({
      accountKey,
      dataType: 'email',
      state: collectionSyncStateFromString(delta.newState),
    })

    const result = await this.syncPort.applyCollectionSync({
      kind: 'email',
      mode: 'delta',
      expectedCursor: { kind: 'matches', cursor },
      nextCursor,
      changed,
      destroyed,
    })

    if (!result.ok) {
      if (result.error.kind === 'conflict' && conflictRetries < 1) {
        // Another writer advanced the cursor between our read and our
        // write. Re-read and redo the whole delta from the fresh state —
        // retrying with this stale `changed`/`nextCursor` would be wrong.
        return this.syncEmailsPage(
          accountKey,
          jmapAccountId,
          conflictRetries + 1,
          page,
        )
      }
      throw new Error(`applyCollectionSync(email) failed: ${result.error.kind}`)
    }

    if (delta.hasMoreChanges) {
      if (page + 1 >= MAX_DELTA_PAGES) {
        throw new Error(
          `Email/changes still has more changes after ${MAX_DELTA_PAGES} committed pages`,
        )
      }
      await this.syncEmailsPage(accountKey, jmapAccountId, 0, page + 1)
    }
  }

  /**
   * Synchronizes a MailboxView by fully re-querying it and replacing the
   * cached snapshot. Applying Email/queryChanges incrementally (position
   * splicing, rebase on removal) is COORD-01, deferred — this always does
   * the safe, simple full replace.
   */
  async syncQueryView(
    accountKey: AccountKey,
    jmapAccountId: string,
    spec: MailboxViewSpec,
  ): Promise<void> {
    const result = await this.client.queryEmails(
      jmapAccountId,
      spec.mailboxId.jmapId,
      undefined,
      { limit: QUERY_PAGE_SIZE },
    )

    const view = toMailboxView(spec, accountKey, result)
    if (view === null) {
      // Logged inside the mapper. Nothing safe to commit from this
      // response; leave the previously cached view (if any) untouched.
      return
    }

    const writeResult = await this.syncPort.replaceMailboxView(view)
    if (!writeResult.ok) {
      throw new Error(`replaceMailboxView failed: ${writeResult.error.kind}`)
    }
  }

  /**
   * Rebuilds the local Email collection from scratch: every Mailbox is
   * queried exhaustively for its email IDs, the union is
   * fetched, and the result replaces the current snapshot. Email/get's own
   * response state seeds the new cursor, since there is no Email/changes
   * state to anchor to after a hard reset.
   */
  private async performHardReset(
    accountKey: AccountKey,
    jmapAccountId: string,
  ): Promise<void> {
    const { mailboxes } = await this.client.getMailboxes(jmapAccountId)

    const allEmailIds = new Set<string>()
    for (const mailbox of mailboxes) {
      const mailboxEmailIds = new Set<string>()
      let position = 0
      let expectedTotal: number | null = null
      let expectedQueryState: string | null = null

      for (let page = 0; page < MAX_HARD_RESET_PAGES_PER_MAILBOX; page++) {
        const query = await this.client.queryEmails(
          jmapAccountId,
          mailbox.id,
          undefined,
          { position, limit: QUERY_PAGE_SIZE },
        )

        if (
          !Number.isSafeInteger(query.total) ||
          query.total < 0 ||
          query.position !== position ||
          query.ids.length > QUERY_PAGE_SIZE
        ) {
          throw new Error(
            `Malformed Email/query page for Mailbox ${mailbox.id}`,
          )
        }
        if (expectedTotal === null) expectedTotal = query.total
        if (expectedQueryState === null) expectedQueryState = query.queryState
        if (
          query.total !== expectedTotal ||
          query.queryState !== expectedQueryState
        ) {
          throw new Error(
            `Email/query changed during Mailbox ${mailbox.id} reset`,
          )
        }

        for (const id of query.ids) {
          if (mailboxEmailIds.has(id)) {
            throw new Error(
              `Email/query repeated ${id} in Mailbox ${mailbox.id}`,
            )
          }
          mailboxEmailIds.add(id)
          allEmailIds.add(id)
        }

        const nextPosition = query.position + query.ids.length
        if (nextPosition >= query.total) break
        if (nextPosition <= position) {
          throw new Error(
            `Email/query made no progress for Mailbox ${mailbox.id}`,
          )
        }
        position = nextPosition

        if (page + 1 === MAX_HARD_RESET_PAGES_PER_MAILBOX) {
          throw new Error(`Email/query exceeded hard-reset safety bound`)
        }
      }
    }

    const ids = [...allEmailIds]
    const fetchedEmails: JmapEmail[] = []
    let state: string | null = null
    const batches = ids.length === 0 ? [[]] : chunk(ids, EMAIL_GET_BATCH_SIZE)
    for (const batch of batches) {
      const result = await this.client.getEmails(jmapAccountId, batch)
      if (state === null) state = result.state
      if (result.state !== state) {
        throw new Error('Email collection changed during hard-reset Email/get')
      }

      const expectedIds = new Set(batch)
      for (const raw of result.emails) {
        if (!expectedIds.delete(raw.id)) {
          throw new Error(
            `Email/get returned unexpected or duplicate ID ${raw.id}`,
          )
        }
        fetchedEmails.push(raw)
      }
      if (expectedIds.size > 0) {
        throw new Error('Email/get did not return the complete requested batch')
      }
    }

    const snapshot: EmailSyncRecord[] = []
    for (const raw of fetchedEmails) {
      const mapped = toDomainEmailRecord(accountKey, raw)
      if (mapped === null) {
        throw new Error(`Email ${raw.id} failed Domain validation`)
      }
      snapshot.push(mapped)
    }

    const nextCursor = collectionSyncCursor({
      accountKey,
      dataType: 'email',
      state: collectionSyncStateFromString(state ?? ''),
    })

    await this.applyReplaceWithRetry(accountKey, 'email', (precondition) => ({
      kind: 'email',
      mode: 'replace',
      expectedCursor: precondition,
      nextCursor,
      snapshot,
    }))
  }

  /** Stateless remote query; it never advances a collection cursor. */
  async searchEmails(
    jmapAccountId: string,
    mailboxId: string,
    filter?: unknown,
    options?: QueryOptions,
  ): Promise<JmapQueryResult> {
    return options === undefined
      ? this.client.queryEmails(jmapAccountId, mailboxId, filter)
      : this.client.queryEmails(jmapAccountId, mailboxId, filter, options)
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

  /**
   * Applies a replace commit, retrying once with a freshly-read cursor
   * precondition on `conflict`. Safe for replace (unlike delta): the
   * snapshot is the complete authoritative state regardless of what the
   * prior cursor was, so re-checking the precondition is all a retry needs.
   */
  private async applyReplaceWithRetry(
    accountKey: AccountKey,
    dataType: CollectionDataType,
    buildCommit: (
      precondition: CollectionCursorPrecondition,
    ) => CollectionSyncCommit,
  ): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const outcome = await this.readCursorOutcome(accountKey, dataType)
      const precondition: CollectionCursorPrecondition =
        outcome.kind === 'absent'
          ? { kind: 'absent' }
          : { kind: 'matches', cursor: outcome.cursor }

      const result = await this.syncPort.applyCollectionSync(
        buildCommit(precondition),
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
}
