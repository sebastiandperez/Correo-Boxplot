<script setup lang="ts">
import MailboxSidebar from '../mailbox/MailboxSidebar.vue'
import MessageList from '../message-list/MessageList.vue'
import MessageViewer from '../message-viewer/MessageViewer.vue'
import Composer from '../composer/Composer.vue'
</script>

<template>
  <main class="app-shell" aria-label="Cliente de correo">
    <MailboxSidebar />
    <MessageList />
    <MessageViewer />
    <Composer />
  </main>
</template>
