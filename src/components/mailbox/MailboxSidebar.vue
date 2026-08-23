<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useMailStore } from '../../app/stores/mail'
import { useComposerStore } from '../../app/stores/composer'
import { useRuntimeStore } from '../../app/stores/runtime'
import {
  accountKeyFromString,
  jmapMailboxIdFromString,
  scopedMailboxId,
} from '../../domain/ids'

const mailStore = useMailStore()
const composerStore = useComposerStore()
const runtimeStore = useRuntimeStore()

const defaultAccount = accountKeyFromString('juan@correo.local')

onMounted(() => {
  if (!mailStore.selectedAccountKey) {
    mailStore.selectAccount(defaultAccount)
  }
  if (!mailStore.selectedMailboxId) {
    mailStore.selectMailbox(
      scopedMailboxId(defaultAccount, jmapMailboxIdFromString('inbox')),
    )
  }
  // Initialize runtime state as local ready
  if (runtimeStore.local === 'opening') {
    runtimeStore.setLocal('ready')
  }
})

const defaultFolders = [
  { id: 'inbox', name: 'Bandeja de entrada', icon: 'inbox' },
  { id: 'drafts', name: 'Borradores', icon: 'drafts' },
  { id: 'sent', name: 'Enviados', icon: 'sent' },
  { id: 'spam', name: 'Spam', icon: 'spam' },
  { id: 'trash', name: 'Papelera', icon: 'trash' },
]

function getUnreadCount(folderId: string): number {
  if (folderId === 'inbox') {
    const unread = mailStore.allEmailsByFolder.inbox?.filter(
      (e) => !e.keywords.has('$seen'),
    ).length
    return unread ?? 0
  }
  if (folderId === 'spam') {
    return (
      mailStore.allEmailsByFolder.spam?.filter((e) => !e.keywords.has('$seen'))
        .length ?? 0
    )
  }
  return 0
}

function isFolderSelected(folderId: string): boolean {
  if (!mailStore.selectedMailboxId) {
    return folderId === 'inbox'
  }
  return mailStore.selectedMailboxId.jmapId === folderId
}

function handleSelectFolder(folderId: string) {
  const account = mailStore.selectedAccountKey ?? defaultAccount
  if (!mailStore.selectedAccountKey) {
    mailStore.selectAccount(account)
  }
  mailStore.selectMailbox(
    scopedMailboxId(account, jmapMailboxIdFromString(folderId)),
  )
}

const accountLabel = computed(() => {
  return mailStore.selectedAccountKey
    ? String(mailStore.selectedAccountKey)
    : 'Cuenta activa'
})

const runtimeStatusText = computed(() => {
  if (runtimeStore.local === 'error') return 'Error de almacenamiento'
  if (runtimeStore.connectivity === 'online') return 'En línea'
  return 'Local / Sin conexión'
})

const runtimeDotClass = computed(() => {
  if (runtimeStore.local === 'error') return 'dot--error'
  if (runtimeStore.connectivity === 'online') return 'dot--online'
  return 'dot--offline'
})
</script>

<template>
  <aside class="mailbox-sidebar" aria-label="Carpetas de correo">
    <div class="mailbox-sidebar__brand">
      <svg
        class="mailbox-sidebar__brand-icon"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path
          d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"
        />
        <polyline points="22,6 12,13 2,6" />
      </svg>
      <span>Boxplot Mail</span>
    </div>

    <button
      class="mailbox-sidebar__compose"
      type="button"
      @click="composerStore.open()"
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
      <span>Redactar</span>
    </button>

    <nav class="mailbox-sidebar__folders" aria-label="Carpetas">
      <button
        v-for="folder in defaultFolders"
        :key="folder.id"
        class="mailbox-sidebar__folder"
        :class="{
          'mailbox-sidebar__folder--current': isFolderSelected(folder.id),
        }"
        type="button"
        :aria-current="isFolderSelected(folder.id) ? 'page' : undefined"
        @click="handleSelectFolder(folder.id)"
      >
        <!-- Icono Inbox -->
        <svg
          v-if="folder.icon === 'inbox'"
          class="mailbox-sidebar__icon"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
          <path
            d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"
          />
        </svg>

        <!-- Icono Borradores -->
        <svg
          v-else-if="folder.icon === 'drafts'"
          class="mailbox-sidebar__icon"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path
            d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
          />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
        </svg>

        <!-- Icono Enviados -->
        <svg
          v-else-if="folder.icon === 'sent'"
          class="mailbox-sidebar__icon"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </svg>

        <!-- Icono Spam -->
        <svg
          v-else-if="folder.icon === 'spam'"
          class="mailbox-sidebar__icon"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>

        <!-- Icono Papelera -->
        <svg
          v-else-if="folder.icon === 'trash'"
          class="mailbox-sidebar__icon"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="3 6 5 6 21 6" />
          <path
            d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
          />
        </svg>

        <span class="mailbox-sidebar__folder-name">{{ folder.name }}</span>

        <span
          v-if="getUnreadCount(folder.id) > 0"
          class="mailbox-sidebar__badge"
        >
          {{ getUnreadCount(folder.id) }}
        </span>
      </button>
    </nav>

    <div class="mailbox-sidebar__footer">
      <div class="mailbox-sidebar__runtime-status">
        <span
          class="mailbox-sidebar__status-dot"
          :class="runtimeDotClass"
        ></span>
        <span class="mailbox-sidebar__status-text">{{
          runtimeStatusText
        }}</span>
      </div>

      <div class="mailbox-sidebar__account">
        <div class="mailbox-sidebar__account-avatar">
          {{ accountLabel.slice(0, 1).toUpperCase() }}
        </div>
        <div class="mailbox-sidebar__account-info">
          <span class="mailbox-sidebar__account-name">Mi Cuenta</span>
          <span class="mailbox-sidebar__account-email">{{ accountLabel }}</span>
        </div>
        <button
          class="mailbox-sidebar__reset-btn"
          type="button"
          title="Restablecer datos demo originales"
          @click="mailStore.resetToDemoDefaults()"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
            <path d="M21 3v5h-5" />
            <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
            <path d="M3 21v-5h5" />
          </svg>
        </button>
      </div>
    </div>
  </aside>
</template>
