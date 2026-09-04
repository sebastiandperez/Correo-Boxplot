import { defineStore } from 'pinia'

import type { AccountKey, MutationId, ScopedEmailId } from '../../domain/ids'

export type MutationStatusKind = 'send' | 'keyword' | 'mailboxMembership'
export type MutationStatusLifecycle =
  'pending' | 'inFlight' | 'retrying' | 'failedTerminal' | 'confirmed'

/**
 * Deliberately payload-free presentation projection. SQLCipher/P-01 remains
 * the authority for the mutation, its recipients, body, and E2EE material.
 */
export type MutationStatusView = Readonly<{
  accountKey: AccountKey
  mutationId: MutationId
  kind: MutationStatusKind
  emailId?: ScopedEmailId
  lifecycle: MutationStatusLifecycle
  attemptCount: number
  securityMode?: 'plain' | 'boxplotE2eeV1'
  needsReconciliation: boolean
}>

export type RecentMutationConfirmation = Readonly<{
  accountKey: AccountKey
  mutationId: MutationId
  kind: MutationStatusKind
  emailId?: ScopedEmailId
}>

export interface MutationStatusState {
  byAccount: Record<string, MutationStatusView[]>
  reconciliation: Record<string, boolean>
  recentConfirmations: Record<string, RecentMutationConfirmation>
}

function identity(accountKey: AccountKey, mutationId: MutationId): string {
  return `${accountKey}\u0000${mutationId}`
}

export const useMutationStatusStore = defineStore('mutation-status', {
  state: (): MutationStatusState => ({
    byAccount: {},
    reconciliation: {},
    recentConfirmations: {},
  }),

  getters: {
    statusesForAccount: (state) => (accountKey: AccountKey | null) =>
      accountKey === null ? [] : (state.byAccount[String(accountKey)] ?? []),

    latestSendForAccount: (state) => (accountKey: AccountKey | null) => {
      if (accountKey === null) return null
      const statuses = state.byAccount[String(accountKey)] ?? []
      const send = [...statuses]
        .reverse()
        .find((status) => status.kind === 'send')
      if (send !== undefined) return { kind: 'status' as const, value: send }

      const recent = Object.values(state.recentConfirmations)
        .filter(
          (value) => value.accountKey === accountKey && value.kind === 'send',
        )
        .at(-1)
      return recent === undefined
        ? null
        : { kind: 'confirmed' as const, value: recent }
    },

    recentConfirmationForEmail: (state) => (emailId: ScopedEmailId) =>
      Object.values(state.recentConfirmations)
        .filter(
          (value) =>
            value.emailId?.accountKey === emailId.accountKey &&
            value.emailId?.jmapId === emailId.jmapId,
        )
        .at(-1) ?? null,
  },

  actions: {
    setStatuses(accountKey: AccountKey, values: readonly MutationStatusView[]) {
      const projected = values.map((value) => ({
        ...value,
        needsReconciliation:
          this.reconciliation[identity(accountKey, value.mutationId)] ?? false,
      }))
      this.byAccount[String(accountKey)] = projected

      const present = new Set(
        projected.map((value) => identity(accountKey, value.mutationId)),
      )
      for (const key of Object.keys(this.reconciliation)) {
        if (key.startsWith(`${accountKey}\u0000`) && !present.has(key)) {
          delete this.reconciliation[key]
        }
      }
    },

    markNeedsReconciliation(accountKey: AccountKey, mutationId: MutationId) {
      this.reconciliation[identity(accountKey, mutationId)] = true
      const statuses = this.byAccount[String(accountKey)]
      if (statuses === undefined) return
      this.byAccount[String(accountKey)] = statuses.map((value) =>
        value.mutationId === mutationId
          ? { ...value, needsReconciliation: true }
          : value,
      )
    },

    markConfirmed(
      accountKey: AccountKey,
      mutationId: MutationId,
      kind: MutationStatusKind,
      emailId?: ScopedEmailId,
    ) {
      this.recentConfirmations[identity(accountKey, mutationId)] = {
        accountKey,
        mutationId,
        kind,
        ...(emailId === undefined ? {} : { emailId }),
      }
    },

    clearAccount(accountKey: AccountKey) {
      delete this.byAccount[String(accountKey)]
      for (const key of Object.keys(this.reconciliation)) {
        if (key.startsWith(`${accountKey}\u0000`))
          delete this.reconciliation[key]
      }
      for (const key of Object.keys(this.recentConfirmations)) {
        if (key.startsWith(`${accountKey}\u0000`)) {
          delete this.recentConfirmations[key]
        }
      }
    },

    reset() {
      this.byAccount = {}
      this.reconciliation = {}
      this.recentConfirmations = {}
    },
  },
})
