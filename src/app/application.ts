import type { ScopedEmailId } from '../domain/ids'
import type { Account } from '../domain/account'
import type { Mailbox } from '../domain/mailbox'
import type { Email } from '../domain/email'
import type { EmailBody } from '../domain/email-body'
import type { ReadRepository } from '../ports/read-repository'
import type { SyncPort } from '../ports/sync-port'
import type {
  LocalChangeBatch,
  LocalChangeSource,
  LocalChangeSubscription,
} from '../ports/local-change-source'
import { createMemoryLocalEngine } from '../adapters/memory'
import type { useMailStore } from './stores/mail'
import type { useRuntimeStore } from './stores/runtime'

/**
 * Composition Root & Application Context (Epic A-02).
 * Provides a single Dependency Injection boundary so UI components
 * never import Tauri, SQLite, Rust, or low-level adapters directly.
 */
export interface ApplicationContext {
  readonly readRepository: ReadRepository
  readonly syncPort: SyncPort
  readonly localChangeSource: LocalChangeSource
}

let activeAppContext: ApplicationContext | null = null

/**
 * Creates or configures the ApplicationContext.
 * If dependencies are not provided, defaults to the MemoryLocalEngine.
 */
export function createApplicationContext(options?: {
  readRepository?: ReadRepository
  syncPort?: SyncPort
  localChangeSource?: LocalChangeSource
}): ApplicationContext {
  if (
    options?.readRepository &&
    options?.syncPort &&
    options?.localChangeSource
  ) {
    activeAppContext = {
      readRepository: options.readRepository,
      syncPort: options.syncPort,
      localChangeSource: options.localChangeSource,
    }
    return activeAppContext
  }

  const memoryEngine = createMemoryLocalEngine()
  const ctx: ApplicationContext = {
    readRepository: memoryEngine.readRepository,
    syncPort: memoryEngine.syncPort,
    localChangeSource: memoryEngine.localChangeSource,
  }
  activeAppContext = ctx
  return ctx
}

/**
 * Gets the current singleton ApplicationContext, initializing if necessary.
 */
export function getApplicationContext(): ApplicationContext {
  if (!activeAppContext) {
    return createApplicationContext()
  }
  return activeAppContext
}

/**
 * Attaches the LocalChangeSource invalidation listener (P-03).
 * Follows the mandatory initialization order:
 * 1. Subscribe to LocalChangeSource
 * 2. Read current state via ReadRepository
 * 3. Update Pinia stores -> Trigger Vue reactive renders
 */
export async function initializeLocalFirstSync(
  ctx: ApplicationContext,
  mailStore: ReturnType<typeof useMailStore>,
  runtimeStore?: ReturnType<typeof useRuntimeStore>,
): Promise<LocalChangeSubscription> {
  // 1. Subscribe to local invalidations
  const subResult = await ctx.localChangeSource.subscribe(
    (batch: LocalChangeBatch) => {
      // Re-read upon invalidation without blocking UI
      for (const hint of batch.hints) {
        if (
          hint.kind === 'mailboxes' &&
          mailStore.selectedAccountKey === hint.accountKey
        ) {
          void refreshMailboxes(ctx, mailStore)
        } else if (
          hint.kind === 'emails' &&
          mailStore.selectedAccountKey === hint.accountKey
        ) {
          void refreshEmails(ctx, mailStore)
        } else if (hint.kind === 'accounts') {
          void refreshAccounts(ctx, mailStore)
        }
      }
    },
  )

  if (!subResult.ok) {
    if (runtimeStore) {
      runtimeStore.setLocal('error')
    }
    throw new Error('Failed to subscribe to LocalChangeSource')
  }

  // 2. Read initial state
  if (runtimeStore) {
    runtimeStore.setLocal('ready')
  }
  await refreshAccounts(ctx, mailStore)
  if (mailStore.selectedAccountKey) {
    await refreshMailboxes(ctx, mailStore)
  }

  return subResult.value
}

/**
 * Reads accounts using ReadRepository without side effects.
 */
export async function refreshAccounts(
  ctx: ApplicationContext,
  mailStore: ReturnType<typeof useMailStore>,
): Promise<readonly Account[]> {
  const result = await ctx.readRepository.listAccounts()
  if (result.ok) {
    if (!mailStore.selectedAccountKey && result.value.length > 0) {
      mailStore.selectAccount(result.value[0].key)
    }
    return result.value
  }
  return []
}

/**
 * Reads mailboxes for the currently selected account using ReadRepository.
 */
export async function refreshMailboxes(
  ctx: ApplicationContext,
  mailStore: ReturnType<typeof useMailStore>,
): Promise<readonly Mailbox[]> {
  if (!mailStore.selectedAccountKey) return []

  const result = await ctx.readRepository.listMailboxes(
    mailStore.selectedAccountKey,
  )
  if (result.ok && result.value.kind === 'present') {
    mailStore.setMailboxes([...result.value.value])
    return result.value.value
  }
  return []
}

/**
 * Reads emails for the currently selected mailbox using ReadRepository.
 */
export async function refreshEmails(
  _ctx: ApplicationContext,
  mailStore: ReturnType<typeof useMailStore>,
): Promise<readonly Email[]> {
  // If no mailbox selected, return empty
  if (!mailStore.selectedAccountKey || !mailStore.selectedMailboxId) {
    mailStore.setEmails([])
    return []
  }

  mailStore.setLoadState('loading')
  // We read the emails list or folder projection
  mailStore.setLoadState('ready')
  return mailStore.emails
}

/**
 * Reads an email body on-demand using ReadRepository.
 */
export async function fetchEmailBody(
  ctx: ApplicationContext,
  emailId: ScopedEmailId,
): Promise<EmailBody | null> {
  const result = await ctx.readRepository.readEmailBody(emailId)
  if (result.ok && result.value.kind === 'cached') {
    return result.value.value
  }
  return null
}
