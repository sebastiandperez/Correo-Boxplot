import { defineStore } from 'pinia'
import type {
  AccountKey,
  ScopedEmailId,
  ScopedMailboxId,
} from '../../domain/ids'
import type { Mailbox } from '../../domain/mailbox'
import { email, type Email } from '../../domain/email'
import {
  createMockEmailsByFolder,
  createMockMailboxes,
  DEMO_ACCOUNT_KEY,
  loadPersistedEmailsByFolder,
  resetPersistedData,
  savePersistedEmailsByFolder,
} from '../mock-data'
import {
  jmapBlobIdFromString,
  jmapEmailIdFromString,
  jmapMailboxIdFromString,
  jmapThreadIdFromString,
  scopedBlobId,
  scopedEmailId,
  scopedMailboxId,
  scopedThreadId,
} from '../../domain/ids'
import { emailAddress } from '../../domain/address'

export type MailLoadState = 'idle' | 'loading' | 'ready' | 'error'

export interface MailState {
  selectedAccountKey: AccountKey | null
  selectedMailboxId: ScopedMailboxId | null
  selectedEmailId: ScopedEmailId | null
  visiblePage: number
  loadState: MailLoadState
  mailboxes: Mailbox[]
  allEmailsByFolder: Record<string, Email[]>
  emails: Email[]
  error: string | null
}

const initialMailboxes = createMockMailboxes()
const initialFolders = loadPersistedEmailsByFolder()
const initialInboxId = scopedMailboxId(
  DEMO_ACCOUNT_KEY,
  jmapMailboxIdFromString('inbox'),
)

export const useMailStore = defineStore('mail', {
  state: (): MailState => ({
    selectedAccountKey: DEMO_ACCOUNT_KEY,
    selectedMailboxId: initialInboxId,
    selectedEmailId: initialFolders.inbox[0]?.id ?? null,
    visiblePage: 0,
    loadState: 'ready',
    mailboxes: initialMailboxes,
    allEmailsByFolder: initialFolders,
    emails: initialFolders.inbox ?? [],
    error: null,
  }),

  getters: {
    selectedMailbox(state): Mailbox | null {
      if (!state.selectedMailboxId) return null
      return (
        state.mailboxes.find(
          (m) =>
            m.id.accountKey === state.selectedMailboxId?.accountKey &&
            m.id.jmapId === state.selectedMailboxId?.jmapId,
        ) ?? null
      )
    },

    selectedEmail(state): Email | null {
      if (!state.selectedEmailId) return null
      return (
        state.emails.find(
          (e) =>
            e.id.accountKey === state.selectedEmailId?.accountKey &&
            e.id.jmapId === state.selectedEmailId?.jmapId,
        ) ?? null
      )
    },
  },

  actions: {
    selectAccount(accountKey: AccountKey | null) {
      this.selectedAccountKey = accountKey
      this.selectedMailboxId = null
      this.selectedEmailId = null
      this.visiblePage = 0
      this.loadState = 'idle'
      this.emails = []
      this.error = null
    },

    selectMailbox(mailboxId: ScopedMailboxId | null) {
      this.selectedMailboxId = mailboxId
      this.visiblePage = 0
      this.error = null

      if (mailboxId) {
        const folderKey = String(mailboxId.jmapId)
        this.emails = this.allEmailsByFolder[folderKey] ?? []
        // Seleccionamos automáticamente el primer correo de la lista si hay alguno
        this.selectedEmailId = this.emails[0]?.id ?? null
      } else {
        this.emails = []
        this.selectedEmailId = null
      }
    },

    persist() {
      savePersistedEmailsByFolder(this.allEmailsByFolder)
    },

    selectEmail(emailId: ScopedEmailId | null) {
      this.selectedEmailId = emailId
      this.error = null

      // Marcar como leído
      if (emailId) {
        const found = this.emails.find(
          (e) =>
            e.id.accountKey === emailId.accountKey &&
            e.id.jmapId === emailId.jmapId,
        )
        if (found && !found.keywords.has('$seen')) {
          ;(found.keywords as Set<string>).add('$seen')
          this.persist()
        }
      }
    },

    sendEmail(to: string, subject: string, body: string) {
      const account = this.selectedAccountKey ?? DEMO_ACCOUNT_KEY
      const randomId = `msg_sent_${Date.now()}`

      const newEmail = email({
        id: scopedEmailId(account, jmapEmailIdFromString(randomId)),
        blobId: scopedBlobId(account, jmapBlobIdFromString(`blob_${randomId}`)),
        threadId: scopedThreadId(
          account,
          jmapThreadIdFromString(`th_${randomId}`),
        ),
        sender: [emailAddress('Juan Fernando', 'juan@correo.local')],
        from: [emailAddress('Juan Fernando', 'juan@correo.local')],
        replyTo: null,
        to: [emailAddress(null, to)],
        cc: null,
        bcc: null,
        subject: subject.trim() || '(Sin asunto)',
        sentAt: new Date().toISOString(),
        receivedAt: new Date().toISOString(),
        size: body.length,
        preview: body.slice(0, 100),
        hasAttachment: false,
        keywords: new Set(['$seen']),
      })

      if (!this.allEmailsByFolder.sent) {
        this.allEmailsByFolder.sent = []
      }
      this.allEmailsByFolder.sent.unshift(newEmail)

      // Actualizar contador de enviados
      const sentBox = this.mailboxes.find((m) => m.role === 'sent')
      if (sentBox) {
        ;(sentBox as any).totalEmails += 1
      }

      // Si estamos en la carpeta enviados, refrescar la lista
      if (this.selectedMailboxId?.jmapId === 'sent') {
        this.emails = [...this.allEmailsByFolder.sent]
      }

      this.persist()
    },

    deleteEmail(emailId: ScopedEmailId) {
      this.moveToFolder(emailId, 'trash')
    },

    toggleSeen(emailId: ScopedEmailId) {
      const email = this.emails.find(
        (e) =>
          e.id.accountKey === emailId.accountKey &&
          e.id.jmapId === emailId.jmapId,
      )
      if (email) {
        const keywords = email.keywords as Set<string>
        if (keywords.has('$seen')) {
          keywords.delete('$seen')
        } else {
          keywords.add('$seen')
        }
        this.persist()
      }
    },

    toggleFlagged(emailId: ScopedEmailId) {
      const email = this.emails.find(
        (e) =>
          e.id.accountKey === emailId.accountKey &&
          e.id.jmapId === emailId.jmapId,
      )
      if (email) {
        const keywords = email.keywords as Set<string>
        if (keywords.has('$flagged')) {
          keywords.delete('$flagged')
        } else {
          keywords.add('$flagged')
        }
        this.persist()
      }
    },

    moveToFolder(emailId: ScopedEmailId, targetFolderId: string) {
      const currentFolder = String(this.selectedMailboxId?.jmapId ?? 'inbox')
      if (currentFolder === targetFolderId) return

      const index = this.emails.findIndex(
        (e) =>
          e.id.accountKey === emailId.accountKey &&
          e.id.jmapId === emailId.jmapId,
      )

      if (index !== -1) {
        const [moved] = this.emails.splice(index, 1)

        // Remover de allEmailsByFolder[currentFolder]
        if (this.allEmailsByFolder[currentFolder]) {
          this.allEmailsByFolder[currentFolder] = this.allEmailsByFolder[
            currentFolder
          ].filter(
            (e) =>
              !(
                e.id.accountKey === emailId.accountKey &&
                e.id.jmapId === emailId.jmapId
              ),
          )
        }

        // Agregar a allEmailsByFolder[targetFolderId]
        if (!this.allEmailsByFolder[targetFolderId]) {
          this.allEmailsByFolder[targetFolderId] = []
        }
        this.allEmailsByFolder[targetFolderId].unshift(moved)

        // Actualizar selección
        this.selectedEmailId = this.emails[0]?.id ?? null

        this.persist()
      }
    },

    resetToDemoDefaults() {
      resetPersistedData()
      const freshFolders = createMockEmailsByFolder()
      this.allEmailsByFolder = freshFolders
      this.mailboxes = createMockMailboxes()
      const currentFolderKey = String(this.selectedMailboxId?.jmapId ?? 'inbox')
      this.emails = this.allEmailsByFolder[currentFolderKey] ?? []
      this.selectedEmailId = this.emails[0]?.id ?? null
      this.persist()
    },

    setVisiblePage(page: number) {
      this.visiblePage = page
    },

    setMailboxes(mailboxes: Mailbox[]) {
      this.mailboxes = mailboxes
    },

    setEmails(emails: Email[]) {
      this.emails = emails
    },

    setLoadState(loadState: MailLoadState, error: string | null = null) {
      this.loadState = loadState
      this.error = error
    },
  },
})
