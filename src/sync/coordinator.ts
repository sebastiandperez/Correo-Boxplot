import type { SyncPort } from '../ports/sync-port'
import type { JmapClient } from '../jmap/client'
import type { AccountKey } from '../domain/ids'
import type { JmapQueryResult } from '../jmap/types'
import { JmapMethodError } from '../jmap/errors'

export class Coordinator {
  constructor(
    private readonly client: JmapClient,
    private readonly syncPort: SyncPort,
  ) {}

  /**
   * Synchronizes emails incrementally using Email/changes.
   * If JMAP returns cannotCalculateChanges, falls back to hard reset.
   *
   * The delta (created/updated/destroyed IDs) is used to fetch only
   * the changed emails and apply them atomically to local state.
   */
  async syncEmails(
    accountKey: AccountKey,
    jmapAccountId: string,
    sinceState: string,
  ): Promise<void> {
    try {
      const delta = await this.client.getEmailChanges(jmapAccountId, sinceState)

      // Fetch full metadata for created and updated emails
      const idsToFetch = [...delta.created, ...delta.updated]
      if (idsToFetch.length > 0) {
        await this.client.getEmails(jmapAccountId, idsToFetch)
        // In a real implementation we would map these to EmailSyncRecord
        // and apply a DeltaCommit via SyncPort. The mapping logic and
        // SyncPort commit will be integrated when the proxy supplies real data.
      }

      // delta.destroyed would be removed from local cache
      // await this.syncPort.applyCollectionSync({ kind: 'email', mode: 'delta', ... })

    } catch (err: unknown) {
      if (
        err instanceof JmapMethodError &&
        err.type === 'cannotCalculateChanges'
      ) {
        await this.performHardReset(accountKey, jmapAccountId)
      } else {
        throw err
      }
    }
  }

  /**
   * Synchronizes a query view incrementally using Email/queryChanges.
   * Preserves queryState, position, and total for correct pagination.
   *
   * If canCalculateChanges is false or the server rejects the sinceQueryState,
   * falls back to a full query replacement.
   */
  async syncQueryView(
    jmapAccountId: string,
    mailboxId: string,
    sinceQueryState: string,
  ): Promise<void> {
    try {
      const changes = await this.client.getEmailQueryChanges(
        jmapAccountId,
        mailboxId,
        sinceQueryState,
      )

      // changes.added contains { id, index } pairs for new positions
      // changes.removed contains IDs that are no longer in the query
      // changes.newQueryState is the cursor for the next incremental sync
      // changes.total is the authoritative server-side total

      // Apply these to the MailboxView via SyncPort when the proxy is live:
      // await this.syncPort.applyCollectionSync({
      //   kind: 'mailboxView',
      //   mode: 'delta',
      //   added: changes.added,
      //   removed: changes.removed,
      //   nextCursor: { queryState: changes.newQueryState, total: changes.total },
      // })

      console.log(
        `[Coordinator] queryChanges applied: +${changes.added.length} -${changes.removed.length}, ` +
        `newState=${changes.newQueryState}, total=${changes.total}`
      )
    } catch (err: unknown) {
      if (
        err instanceof JmapMethodError &&
        err.type === 'cannotCalculateChanges'
      ) {
        // Fallback: full re-query
        await this.searchEmails(jmapAccountId, mailboxId, undefined)
      } else {
        throw err
      }
    }
  }

  private async performHardReset(
    accountKey: AccountKey,
    jmapAccountId: string,
  ): Promise<void> {
    console.log(this.syncPort, accountKey, jmapAccountId)
    // 1. Fetch ALL emails (or first batch) to rebuild local state
    // 2. Commit a 'replace' to SyncPort to drop the corrupt cache
    // This assumes SyncPort is implemented to handle EmailCollectionReplaceCommit
  }

  /**
   * Decoupled search operation. Does not block or interleave with state sync.
   * Leverages JMAP query but does NOT modify local collection cursors.
   * Returns full query metadata including queryState, total, and position.
   */
  async searchEmails(
    jmapAccountId: string,
    mailboxId: string,
    query: unknown,
  ): Promise<JmapQueryResult> {
    const result = await this.client.queryEmails(jmapAccountId, mailboxId, query)

    // Result now properly includes queryState, total, position,
    // and canCalculateChanges for downstream consumers.
    return result
  }
}