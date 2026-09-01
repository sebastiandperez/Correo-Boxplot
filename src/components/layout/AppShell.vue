<script setup lang="ts">
import { ref } from 'vue'
import type { AccountKey } from '../../domain/ids'
import AccountReconnectDialog from '../account/AccountReconnectDialog.vue'
import MailboxSidebar from '../mailbox/MailboxSidebar.vue'
import MessageList from '../message-list/MessageList.vue'
import MessageViewer from '../message-viewer/MessageViewer.vue'
import Composer from '../composer/Composer.vue'

const reconnectAccountKey = ref<AccountKey | null>(null)

function openReconnect(accountKey: AccountKey) {
  reconnectAccountKey.value = accountKey
}

function closeReconnect() {
  reconnectAccountKey.value = null
}
</script>

<template>
  <main class="app-shell" aria-label="Cliente de correo">
    <MailboxSidebar @reconnect="openReconnect" />
    <MessageList />
    <MessageViewer />
    <Composer />
    <AccountReconnectDialog
      v-if="reconnectAccountKey"
      :account-key="reconnectAccountKey"
      @close="closeReconnect"
    />
  </main>
</template>
