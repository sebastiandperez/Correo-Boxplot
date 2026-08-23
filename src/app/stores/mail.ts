import { defineStore } from 'pinia'

import type { Account } from '../../domain/account'
import type { Email } from '../../domain/email'
import type { EmailBody } from '../../domain/email-body'
import type {
  AccountKey,
  ScopedEmailId,
  ScopedMailboxId,
} from '../../domain/ids'
import type { Mailbox } from '../../domain/mailbox'
import type { MailboxView } from '../../domain/mailbox-view'

export type MailLoadState = 'idle' | 'loading' | 'ready' | 'notCached' | 'error'

export type BodyLoadState =
  'idle' | 'loading' | 'cached' | 'notCached' | 'ownerAbsent' | 'error'

export interface MailState {
  accounts: Account[]
  selectedAccountKey: AccountKey | null
  selectedMailboxId: ScopedMailboxId | null
  selectedEmailId: ScopedEmailId | null
  visiblePage: number
  loadState: MailLoadState
  mailboxes: Mailbox[]
  mailboxView: MailboxView | null
  emails: Email[]
  emailBody: EmailBody | null
  bodyLoadState: BodyLoadState
  error: string | null
}

export const useMailStore = defineStore('mail', {
  state: (): MailState => ({
    accounts: [],
    selectedAccountKey: null,
    selectedMailboxId: null,
    selectedEmailId: null,
    visiblePage: 0,
    loadState: 'idle',
    mailboxes: [],
    mailboxView: null,
    emails: [],
    emailBody: null,
    bodyLoadState: 'idle',
    error: null,
  }),

  getters: {
    selectedMailbox(state): Mailbox | null {
      if (!state.selectedMailboxId) return null
      return (
        state.mailboxes.find(
          (mailbox) =>
            mailbox.id.accountKey === state.selectedMailboxId?.accountKey &&
            mailbox.id.jmapId === state.selectedMailboxId?.jmapId,
        ) ?? null
      )
    },

    selectedEmail(state): Email | null {
      if (!state.selectedEmailId) return null
      return (
        state.emails.find(
          (email) =>
            email.id.accountKey === state.selectedEmailId?.accountKey &&
            email.id.jmapId === state.selectedEmailId?.jmapId,
        ) ?? null
      )
    },
  },

  actions: {
    setAccounts(accounts: readonly Account[]) {
      this.accounts = [...accounts]
    },

    selectAccount(accountKey: AccountKey | null) {
      this.selectedAccountKey = accountKey
      this.selectedMailboxId = null
      this.selectedEmailId = null
      this.visiblePage = 0
      this.mailboxes = []
      this.mailboxView = null
      this.emails = []
      this.emailBody = null
      this.bodyLoadState = 'idle'
      this.loadState = 'idle'
      this.error = null
    },

    selectMailbox(mailboxId: ScopedMailboxId | null) {
      this.selectedMailboxId = mailboxId
      this.selectedEmailId = null
      this.visiblePage = 0
      this.mailboxView = null
      this.emails = []
      this.emailBody = null
      this.bodyLoadState = 'idle'
      this.loadState = 'idle'
      this.error = null
    },

    selectEmail(emailId: ScopedEmailId | null) {
      this.selectedEmailId = emailId
      this.emailBody = null
      this.bodyLoadState = emailId === null ? 'idle' : 'loading'
      this.error = null
    },

    setVisiblePage(page: number) {
      this.visiblePage = page
    },

    setMailboxes(mailboxes: readonly Mailbox[]) {
      this.mailboxes = [...mailboxes]
    },

    setMailboxView(view: MailboxView | null) {
      this.mailboxView = view
    },

    setEmails(emails: readonly Email[]) {
      this.emails = [...emails]
    },

    setEmailBody(body: EmailBody | null, state: BodyLoadState) {
      this.emailBody = body
      this.bodyLoadState = state
    },

    setLoadState(loadState: MailLoadState, error: string | null = null) {
      this.loadState = loadState
      this.error = error
    },
  },
})
