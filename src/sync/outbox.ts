import type { SyncPort } from '../ports/sync-port'
import type { JmapClient } from '../jmap/client'
import type { AccountKey } from '../domain/ids'
import type { SendMutation } from '../domain/pending-mutation'
import { JmapNetworkError } from '../jmap/errors'
import { mapSendIntentToJmapDraft } from '../jmap/mail/draft-mapper'

export class Outbox {
  constructor(
    private readonly client: JmapClient,
    private readonly syncPort: SyncPort,
  ) {}

  /**
   * Processes a SendMutation. The domain SendIntent is mapped to a
   * JMAP DTO exclusively inside the JMAP layer (draft-mapper.ts),
   * keeping Outbox protocol-agnostic per AGENTS.md architecture.
   *
   * If the proxy fails mid-way, the mutation remains pending/inFlight,
   * guaranteeing eventual consistency without optimistic data corruption.
   */
  async processSendMutation(
    accountKey: AccountKey,
    jmapAccountId: string,
    mutation: SendMutation,
  ): Promise<void> {
    // Delegate DTO construction to JMAP layer — Outbox stays protocol-agnostic
    const draft = mapSendIntentToJmapDraft(mutation.intent)

    try {
      // 1. Mark inFlight (Optimistic start, persisted)
      // await this.syncPort.replacePendingMutationIfCurrent(mutation, { ...mutation, status: 'inFlight' })

      // 2. Submit to JMAP Proxy
      await this.client.submitEmail(
        jmapAccountId,
        draft,
        mutation.intent.identityId.jmapId,
      )

      // 3. Confirm mutation (Eventual Consistency achieved)
      await this.syncPort.removeConfirmedMutation(
        accountKey,
        mutation.mutationId,
      )
    } catch (err: unknown) {
      if (err instanceof JmapNetworkError) {
        // Leave inFlight or move to retrying. Do not delete!
        // await this.syncPort.replacePendingMutationIfCurrent(mutation, { ...mutation, status: 'retrying' })
        throw err
      } else {
        // Terminal failure (e.g. 400 Bad Request)
        // await this.syncPort.replacePendingMutationIfCurrent(mutation, { ...mutation, status: 'failedTerminal' })
        throw err
      }
    }
  }
}
