<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide } from 'vue'
import AccountSetup from './components/account/AccountSetup.vue'
import AppShell from './components/layout/AppShell.vue'
import { createMailApplicationController } from './app/application'
import { rootViewMode } from './app/root-view-state'
import type { AccountSetupRequest } from './app/stores/account-setup'
import { useAccountSetupStore } from './app/stores/account-setup'
import { useMailStore } from './app/stores/mail'
import { useRuntimeStore } from './app/stores/runtime'
import {
  mailApplicationControllerKey,
  useApplicationContext,
} from './app/vue-application-context'

const context = useApplicationContext()
const mailStore = useMailStore()
const runtimeStore = useRuntimeStore()
const accountSetupStore = useAccountSetupStore()
const controller = createMailApplicationController(
  context,
  mailStore,
  runtimeStore,
)

provide(mailApplicationControllerKey, controller)

const rootMode = computed(() =>
  rootViewMode(runtimeStore.local, mailStore.accounts),
)

async function connectAccount(request: AccountSetupRequest) {
  if (accountSetupStore.phase === 'connecting') return
  accountSetupStore.beginConnection()
  const result = await controller.connectAccount(request, {
    onAuthenticated: () => accountSetupStore.clearSensitive(),
  })
  if (!result.ok) accountSetupStore.setConnectionError(result.error.message)
  else accountSetupStore.finishConnection()
}

function retryLocal() {
  void controller.retry().catch(() => undefined)
}

onMounted(() => {
  void controller.initialize().catch(() => undefined)
})

onBeforeUnmount(() => controller.dispose())
</script>

<template>
  <main v-if="rootMode === 'boot'" class="root-state" aria-live="polite">
    Abriendo correo local…
  </main>
  <main v-else-if="rootMode === 'localError'" class="root-state" role="alert">
    <p>No se pudo abrir el almacenamiento local.</p>
    <button type="button" @click="retryLocal">Reintentar</button>
  </main>
  <AccountSetup v-else-if="rootMode === 'setup'" @submit="connectAccount" />
  <AppShell v-else />
</template>

<style scoped>
.root-state {
  min-height: 100vh;
  display: grid;
  place-content: center;
  gap: 16px;
  margin: 0;
  padding: 32px;
  background: #f8fafc;
  color: #0f172a;
}

.root-state p {
  margin: 0;
}

.root-state button {
  justify-self: center;
  border: 0;
  border-radius: 8px;
  padding: 10px 14px;
  background: #2563eb;
  color: #fff;
  font: inherit;
}
</style>
