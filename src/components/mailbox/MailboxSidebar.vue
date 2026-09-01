<script setup lang="ts">
import { computed } from 'vue'
import { useMailStore } from '../../app/stores/mail'
import { useComposerStore } from '../../app/stores/composer'
import { useRuntimeStore } from '../../app/stores/runtime'
import { useMailApplicationController } from '../../app/vue-application-context'
import { connectionStatusView } from '../../app/connection-status-view'
import type { AccountKey } from '../../domain/ids'
import type { Mailbox } from '../../domain/mailbox'

const mailStore = useMailStore()
const composerStore = useComposerStore()
const runtimeStore = useRuntimeStore()
const controller = useMailApplicationController()
const emit = defineEmits<{
  reconnect: [accountKey: AccountKey]
}>()

function mailboxIcon(mailbox: Mailbox): string {
  if (mailbox.role === 'inbox') return 'inbox'
  if (mailbox.role === 'drafts') return 'drafts'
  if (mailbox.role === 'sent') return 'sent'
  if (mailbox.role === 'junk') return 'spam'
  if (mailbox.role === 'trash') return 'trash'
  return 'folder'
}

function isFolderSelected(mailbox: Mailbox): boolean {
  return (
    mailStore.selectedMailboxId?.accountKey === mailbox.id.accountKey &&
    mailStore.selectedMailboxId.jmapId === mailbox.id.jmapId
  )
}

function handleSelectFolder(mailbox: Mailbox) {
  void controller.selectMailbox(mailbox.id)
}

const accountLabel = computed(() => {
  return mailStore.selectedAccountKey
    ? String(mailStore.selectedAccountKey)
    : 'Sin cuenta local'
})

const connectionStatus = computed(() => connectionStatusView(runtimeStore))

const runtimeDotClass = computed(() => {
  if (connectionStatus.value.kind === 'localError') return 'dot--error'
  if (connectionStatus.value.kind === 'online') return 'dot--online'
  return 'dot--offline'
})

function reconnect() {
  const accountKey = mailStore.selectedAccountKey
  if (!accountKey || !connectionStatus.value.canReconnect) return
  emit('reconnect', accountKey)
}
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
        v-for="folder in mailStore.mailboxes"
        :key="`${folder.id.accountKey}:${folder.id.jmapId}`"
        class="mailbox-sidebar__folder"
        :class="{
          'mailbox-sidebar__folder--current': isFolderSelected(folder),
        }"
        type="button"
        :aria-current="isFolderSelected(folder) ? 'page' : undefined"
        @click="handleSelectFolder(folder)"
      >
        <!-- Icono Inbox -->
        <svg
          v-if="mailboxIcon(folder) === 'inbox'"
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
          v-else-if="mailboxIcon(folder) === 'drafts'"
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
          v-else-if="mailboxIcon(folder) === 'sent'"
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
          v-else-if="mailboxIcon(folder) === 'spam'"
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
          v-else-if="mailboxIcon(folder) === 'trash'"
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

        <span v-if="folder.unreadEmails > 0" class="mailbox-sidebar__badge">
          {{ folder.unreadEmails }}
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
          connectionStatus.label
        }}</span>
      </div>
      <button
        v-if="connectionStatus.canReconnect && mailStore.selectedAccountKey"
        class="mailbox-sidebar__reconnect"
        type="button"
        @click="reconnect"
      >
        {{ connectionStatus.reconnectLabel }}
      </button>

      <div class="mailbox-sidebar__account">
        <div class="mailbox-sidebar__account-avatar">
          {{ accountLabel.slice(0, 1).toUpperCase() }}
        </div>
        <div class="mailbox-sidebar__account-info">
          <span class="mailbox-sidebar__account-name">Mi Cuenta</span>
          <span class="mailbox-sidebar__account-email">{{ accountLabel }}</span>
        </div>
      </div>
    </div>
  </aside>
</template>
