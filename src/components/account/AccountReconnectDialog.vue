<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import type { AccountKey } from '../../domain/ids'
import type { AccountSetupRequest } from '../../app/stores/account-setup'
import { useAccountSetupStore } from '../../app/stores/account-setup'
import { useMailApplicationController } from '../../app/vue-application-context'
import AccountSetup from './AccountSetup.vue'

const props = defineProps<{
  accountKey: AccountKey
}>()
const emit = defineEmits<{
  close: []
}>()

const store = useAccountSetupStore()
const controller = useMailApplicationController()
let generation = 0
const googleReauthorization = ref(false)

async function reconnect(request: AccountSetupRequest) {
  if (store.phase === 'connecting') return
  const attempt = ++generation
  store.beginConnection()
  const result = await controller.reconnectAccount(props.accountKey, request, {
    onAuthenticated: () => store.clearSensitive(),
  })
  if (attempt !== generation) return
  if (!result.ok) {
    if (request.profile === 'gmailOAuth' && result.error.kind === 'auth') {
      googleReauthorization.value = true
    }
    store.setConnectionError(result.error.message)
    return
  }
  store.finishConnection()
  emit('close')
}

function close() {
  generation += 1
  store.reset()
  emit('close')
}

onBeforeUnmount(() => {
  generation += 1
  store.clearSensitive()
})
</script>

<template>
  <div class="account-reconnect" role="dialog" aria-modal="true">
    <div class="account-reconnect__backdrop"></div>
    <AccountSetup
      mode="reconnect"
      :google-reauthorization="googleReauthorization"
      @submit="reconnect"
      @cancel="close"
    />
  </div>
</template>

<style scoped>
.account-reconnect {
  position: fixed;
  z-index: 20;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 20px;
}

.account-reconnect__backdrop {
  position: absolute;
  z-index: -1;
  inset: 0;
  background: rgb(15 23 42 / 48%);
}

.account-reconnect :deep(.account-setup) {
  min-height: auto;
  width: min(100%, 520px);
  padding: 0;
  background: transparent;
}
</style>
