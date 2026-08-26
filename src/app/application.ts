import type { Email } from '../domain/email'
import type { AccountKey, ScopedEmailId, ScopedMailboxId } from '../domain/ids'
import {
  mutationIdFromString,
  sameScopedEmailId,
  sameScopedMailboxId,
} from '../domain/ids'
import {
  keywordMutation,
  mailboxMembershipMutation,
  mutationInstantFromString,
} from '../domain/pending-mutation'
import {
  mailboxViewFilterAll,
  mailboxViewSort,
  mailboxViewSpec,
  sameMailboxViewSpec,
} from '../domain/mailbox-view'
import type {
  LocalChangeBatch,
  LocalChangeSource,
  LocalChangeSubscription,
} from '../ports/local-change-source'
import type { ReadRepository } from '../ports/read-repository'
import type { SyncPort } from '../ports/sync-port'
import type { useMailStore } from './stores/mail'
import type { useRuntimeStore } from './stores/runtime'

import { JmapWorkerClient } from './worker-client'

export interface ApplicationContext {
  readonly workerClient?: JmapWorkerClient
  readonly readRepository: ReadRepository
  readonly syncPort: SyncPort
  readonly localChangeSource: LocalChangeSource
}

export function createApplicationContext(
  dependencies: ApplicationContext,
): ApplicationContext {
  return {
    readRepository: dependencies.readRepository,
    syncPort: dependencies.syncPort,
    localChangeSource: dependencies.localChangeSource,
    workerClient: dependencies.workerClient,
  }
}

type MailStore = ReturnType<typeof useMailStore>
type RuntimeStore = ReturnType<typeof useRuntimeStore>

function nextMutationId() {
  return mutationIdFromString(
    `application-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
}

function nowMutationInstant() {
  return mutationInstantFromString(new Date().toISOString())
}

export class MailApplicationController {
  private subscription: LocalChangeSubscription | null = null
  private accountsGeneration = 0
  private mailboxesGeneration = 0
  private mailboxViewGeneration = 0
  private bodyGeneration = 0
  private pendingHints: LocalChangeBatch['hints'][number][] = []
  private invalidationScheduled = false

  constructor(
    private readonly context: ApplicationContext,
    private readonly mailStore: MailStore,
    private readonly runtimeStore: RuntimeStore,
  ) {}

  async initialize(): Promise<void> {
    if (this.subscription !== null) return

    this.runtimeStore.setLocal('opening')
    const subscription = await this.context.localChangeSource.subscribe(
      (batch) => this.scheduleInvalidation(batch),
    )

    if (!subscription.ok) {
      this.runtimeStore.setLocal('error')
      this.mailStore.setLoadState(
        'error',
        'El almacenamiento local no está disponible.',
      )
      throw new Error('LocalChangeSource is unavailable')
    }

    this.subscription = subscription.value

    try {
      await this.refreshAccounts()
      this.runtimeStore.setLocal('ready')
    } catch (error) {
      this.runtimeStore.setLocal('error')
      this.mailStore.setLoadState(
        'error',
        'No se pudo leer el almacenamiento local.',
      )
      throw error
    }
  }

  dispose(): void {
    this.subscription?.unsubscribe()
    this.subscription = null
  }

  async retry(): Promise<void> {
    if (this.subscription === null) {
      await this.initialize()
      return
    }

    this.runtimeStore.setLocal('opening')
    try {
      await this.refreshAccounts()
      this.runtimeStore.setLocal('ready')
    } catch (error) {
      this.runtimeStore.setLocal('error')
      throw error
    }
  }

  async selectAccount(accountKey: AccountKey): Promise<void> {
    if (this.mailStore.selectedAccountKey !== accountKey) {
      this.mailStore.selectAccount(accountKey)
    }
    await this.refreshMailboxes()
  }

  async selectMailbox(mailboxId: ScopedMailboxId): Promise<void> {
    if (
      this.mailStore.selectedMailboxId === null ||
      !sameScopedMailboxId(this.mailStore.selectedMailboxId, mailboxId)
    ) {
      this.mailStore.selectMailbox(mailboxId)
    }
    await this.refreshMailboxWindow()
  }

  async selectEmail(emailId: ScopedEmailId): Promise<void> {
    if (
      this.mailStore.selectedEmailId === null ||
      !sameScopedEmailId(this.mailStore.selectedEmailId, emailId)
    ) {
      this.mailStore.selectEmail(emailId)
    }
    await this.refreshSelectedBody()
  }

  async refreshAccounts(): Promise<void> {
    const generation = ++this.accountsGeneration
    const result = await this.context.readRepository.listAccounts()
    if (generation !== this.accountsGeneration) return
    if (!result.ok) throw new Error(`listAccounts failed: ${result.error.kind}`)

    const accounts = [...result.value].sort((left, right) =>
      String(left.key).localeCompare(String(right.key)),
    )
    this.mailStore.setAccounts(accounts)
    const selected = this.mailStore.selectedAccountKey
    const selectedStillExists =
      selected !== null && accounts.some((value) => value.key === selected)
    const nextAccount = selectedStillExists ? selected : accounts[0]?.key

    if (nextAccount === undefined) {
      this.mailStore.selectAccount(null)
      this.mailStore.setLoadState('ready')
      return
    }

    if (selected !== nextAccount) this.mailStore.selectAccount(nextAccount)
    await this.refreshMailboxes()
  }

  async refreshMailboxes(): Promise<void> {
    const accountKey = this.mailStore.selectedAccountKey
    const generation = ++this.mailboxesGeneration
    if (accountKey === null) return

    const result = await this.context.readRepository.listMailboxes(accountKey)
    if (
      generation !== this.mailboxesGeneration ||
      this.mailStore.selectedAccountKey !== accountKey
    ) {
      return
    }
    if (!result.ok)
      throw new Error(`listMailboxes failed: ${result.error.kind}`)
    if (result.value.kind === 'ownerAbsent') {
      this.mailStore.setMailboxes([])
      this.mailStore.selectMailbox(null)
      this.mailStore.setLoadState('error', 'La cuenta local ya no existe.')
      return
    }

    const mailboxes = [...result.value.value].sort(
      (left, right) =>
        left.sortOrder - right.sortOrder || left.name.localeCompare(right.name),
    )
    this.mailStore.setMailboxes(mailboxes)
    const selected = this.mailStore.selectedMailboxId
    const selectedStillExists =
      selected !== null &&
      mailboxes.some((value) => sameScopedMailboxId(value.id, selected))
    const nextMailbox = selectedStillExists
      ? selected
      : (mailboxes.find((value) => value.role === 'inbox')?.id ??
        mailboxes[0]?.id)

    if (nextMailbox === undefined) {
      this.mailStore.selectMailbox(null)
      this.mailStore.setLoadState('ready')
      return
    }

    if (selected === null || !sameScopedMailboxId(selected, nextMailbox)) {
      this.mailStore.selectMailbox(nextMailbox)
    }
    await this.refreshMailboxWindow()
  }

  async syncSelectedAccount(): Promise<void> {
    const accountKey = this.mailStore.selectedAccountKey
    if (!accountKey) return
    try {
      this.runtimeStore.setLocal('opening')
      // En un entorno real se extrae jmapAccountId del Account, aquí usamos mock
      this.context.workerClient?.syncAccount(accountKey, 'mock-jmap-account')
      this.runtimeStore.setLocal('ready')
    } catch (e) {
      console.error(e)
      this.runtimeStore.setLocal('error')
    }
  }

  async refreshMailboxWindow(): Promise<void> {
    const mailboxId = this.mailStore.selectedMailboxId
    const generation = ++this.mailboxViewGeneration
    if (mailboxId === null) return

    const spec = mailboxViewSpec(
      mailboxId,
      mailboxViewFilterAll(),
      mailboxViewSort('descending'),
    )
    this.mailStore.setLoadState('loading')
    const viewResult = await this.context.readRepository.readMailboxView(spec)
    if (
      generation !== this.mailboxViewGeneration ||
      this.mailStore.selectedMailboxId === null ||
      !sameScopedMailboxId(this.mailStore.selectedMailboxId, mailboxId)
    ) {
      return
    }
    if (!viewResult.ok) {
      this.mailStore.setLoadState(
        'error',
        'No se pudo leer la vista local del buzón.',
      )
      return
    }
    if (viewResult.value.kind === 'ownerAbsent') {
      this.mailStore.setMailboxView(null)
      this.mailStore.setEmails([])
      this.mailStore.setLoadState('error', 'El buzón local ya no existe.')
      return
    }
    if (viewResult.value.kind === 'notCached') {
      this.mailStore.setMailboxView(null)
      this.mailStore.setEmails([])
      this.mailStore.setLoadState('notCached')
      return
    }

    const view = viewResult.value.value
    const emailResult = await this.context.readRepository.readEmails(
      view.items.map((item) => item.emailId),
    )
    if (
      generation !== this.mailboxViewGeneration ||
      this.mailStore.selectedMailboxId === null ||
      !sameMailboxViewSpec(spec, view.spec) ||
      !sameScopedMailboxId(this.mailStore.selectedMailboxId, mailboxId)
    ) {
      return
    }
    if (
      !emailResult.ok ||
      emailResult.value.some((item) => item.kind === 'absent')
    ) {
      this.mailStore.setMailboxView(view)
      this.mailStore.setEmails([])
      this.mailStore.setLoadState(
        'error',
        'La vista local referencia mensajes no disponibles.',
      )
      return
    }

    const emails: Email[] = []
    for (const item of emailResult.value) {
      if (item.kind === 'present') emails.push(item.value)
    }
    this.mailStore.setMailboxView(view)
    this.mailStore.setEmails(emails)
    const selectedEmail = this.mailStore.selectedEmailId
    const nextEmail =
      selectedEmail !== null &&
      emails.some((value) => sameScopedEmailId(value.id, selectedEmail))
        ? selectedEmail
        : (emails[0]?.id ?? null)
    if (
      selectedEmail === null ||
      nextEmail === null ||
      !sameScopedEmailId(selectedEmail, nextEmail)
    ) {
      this.mailStore.selectEmail(nextEmail)
    }
    this.mailStore.setLoadState('ready')
    await this.refreshSelectedBody()
  }

  async refreshSelectedBody(): Promise<void> {
    const emailId = this.mailStore.selectedEmailId
    const generation = ++this.bodyGeneration
    if (emailId === null) {
      this.mailStore.setEmailBody(null, 'idle')
      return
    }

    this.mailStore.setEmailBody(null, 'loading')
    const result = await this.context.readRepository.readEmailBody(emailId)
    if (
      generation !== this.bodyGeneration ||
      this.mailStore.selectedEmailId === null ||
      !sameScopedEmailId(this.mailStore.selectedEmailId, emailId)
    ) {
      return
    }
    if (!result.ok) {
      this.mailStore.setEmailBody(null, 'error')
      return
    }

    if (result.value.kind === 'cached') {
      this.mailStore.setEmailBody(result.value.value, 'cached')
    } else {
      this.mailStore.setEmailBody(null, result.value.kind)
    }
  }

  async toggleKeyword(email: Email, keyword: string): Promise<void> {
    const hasKeyword = email.keywords.has(keyword)
    const mutation = keywordMutation({
      mutationId: nextMutationId(),
      accountKey: email.id.accountKey,
      createdAt: nowMutationInstant(),
      emailId: email.id,
      change: hasKeyword
        ? { add: new Set(), remove: new Set([keyword]) }
        : { add: new Set([keyword]), remove: new Set() },
    })
    const result =
      await this.context.syncPort.applyOptimisticKeywordMutation(mutation)
    if (!result.ok)
      throw new Error(`keyword write failed: ${result.error.kind}`)
  }

  async moveEmail(emailId: ScopedEmailId, targetRole: string): Promise<void> {
    const target = this.mailStore.mailboxes.find(
      (mailbox) => mailbox.role === targetRole,
    )
    if (target === undefined)
      throw new Error(`Mailbox role ${targetRole} missing`)

    const memberships =
      await this.context.readRepository.readEmailMemberships(emailId)
    if (!memberships.ok || memberships.value.kind !== 'present') {
      throw new Error('Email memberships are unavailable')
    }
    const remove = memberships.value.value
      .map((value) => value.mailboxId)
      .filter((mailboxId) => !sameScopedMailboxId(mailboxId, target.id))
    if (remove.length === 0) return

    const mutation = mailboxMembershipMutation({
      mutationId: nextMutationId(),
      accountKey: emailId.accountKey,
      createdAt: nowMutationInstant(),
      emailId,
      change: { add: [target.id], remove },
    })
    const result =
      await this.context.syncPort.applyOptimisticMailboxMembershipMutation(
        mutation,
      )
    if (!result.ok) {
      throw new Error(`membership write failed: ${result.error.kind}`)
    }
  }

  async sendEmail(
    intent: import('../domain/send-intent').SendIntent,
  ): Promise<void> {
    const accountKey = this.mailStore.selectedAccountKey
    if (!accountKey) throw new Error('No account selected')

    // Generar la mutación pendiente (esto se conectará con Composer)
    const mutation = {
      kind: 'send',
      mutationId: nextMutationId(),
      accountKey,
      createdAt: nowMutationInstant(),
      intent,
      lifecycle: { status: 'pending', attemptCount: 0 },
    } as import('../domain/pending-mutation').SendMutation

    // Primero, persistimos en SQLite optimistamente (en un escenario real)
    // await this.context.syncPort.stageSendMutation(mutation)

    // Delegamos al Outbox el proceso de red que garantiza consistencia eventual.
    // Outbox lee la mutación durable por mutationId (no confía en el objeto
    // local) — sin el stageSendMutation de arriba, no encontrará nada que
    // procesar todavía.
    this.context.workerClient?.sendEmail(
      accountKey,
      'mock-jmap-account',
      mutation.mutationId,
    )
  }

  private scheduleInvalidation(batch: LocalChangeBatch): void {
    this.pendingHints.push(...batch.hints)
    if (this.invalidationScheduled) return
    this.invalidationScheduled = true
    queueMicrotask(() => void this.flushInvalidations())
  }

  private async flushInvalidations(): Promise<void> {
    this.invalidationScheduled = false
    const hints = this.pendingHints.splice(0)
    const selectedAccount = this.mailStore.selectedAccountKey
    const selectedEmail = this.mailStore.selectedEmailId
    const mustRefreshAccounts = hints.some((hint) => hint.kind === 'accounts')
    const mustRefreshMailboxes = hints.some(
      (hint) =>
        hint.kind === 'mailboxes' &&
        selectedAccount !== null &&
        hint.accountKey === selectedAccount,
    )
    const mustRefreshWindow = hints.some((hint) => {
      if (hint.kind === 'mailboxView') {
        return (
          this.mailStore.selectedMailboxId !== null &&
          sameScopedMailboxId(
            hint.spec.mailboxId,
            this.mailStore.selectedMailboxId,
          )
        )
      }
      return (
        (hint.kind === 'emails' || hint.kind === 'emailMemberships') &&
        selectedAccount !== null &&
        hint.accountKey === selectedAccount
      )
    })
    const mustRefreshBody = hints.some(
      (hint) =>
        hint.kind === 'emailBody' &&
        selectedEmail !== null &&
        sameScopedEmailId(hint.emailId, selectedEmail),
    )

    try {
      if (mustRefreshAccounts) await this.refreshAccounts()
      else if (mustRefreshMailboxes) await this.refreshMailboxes()
      else if (mustRefreshWindow) await this.refreshMailboxWindow()
      if (
        !mustRefreshAccounts &&
        !mustRefreshMailboxes &&
        !mustRefreshWindow &&
        mustRefreshBody
      ) {
        await this.refreshSelectedBody()
      }
    } catch {
      this.runtimeStore.setLocal('error')
    }
  }
}

export function createMailApplicationController(
  context: ApplicationContext,
  mailStore: MailStore,
  runtimeStore: RuntimeStore,
): MailApplicationController {
  return new MailApplicationController(context, mailStore, runtimeStore)
}
