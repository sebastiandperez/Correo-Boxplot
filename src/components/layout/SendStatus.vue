<script setup lang="ts">
import { computed } from 'vue'

import { useMailStore } from '../../app/stores/mail'
import { useMutationStatusStore } from '../../app/stores/mutation-status'
import { useMailApplicationController } from '../../app/vue-application-context'

const mailStore = useMailStore()
const mutationStatusStore = useMutationStatusStore()
const controller = useMailApplicationController()

const latestSend = computed(() =>
  mutationStatusStore.latestSendForAccount(mailStore.selectedAccountKey),
)

const label = computed(() => {
  const value = latestSend.value
  if (value === null) return null
  if (value.kind === 'confirmed') return 'Enviado'
  if (
    value.value.needsReconciliation ||
    value.value.lifecycle === 'confirmed'
  ) {
    return 'Verificando envío…'
  }
  switch (value.value.lifecycle) {
    case 'pending':
      return 'En cola'
    case 'retrying':
      return 'En cola · pendiente de reintento'
    case 'inFlight':
      return 'Enviando…'
    case 'failedTerminal':
      return 'Error de sincronización'
    default:
      return null
  }
})

const canRetry = computed(() => {
  const value = latestSend.value
  return (
    value !== null &&
    value.kind === 'status' &&
    (value.value.lifecycle === 'pending' ||
      value.value.lifecycle === 'retrying' ||
      value.value.lifecycle === 'inFlight')
  )
})

function retry() {
  const value = latestSend.value
  if (value === null || value.kind !== 'status' || !canRetry.value) return
  void controller.runMutation(value.value.accountKey, value.value.mutationId)
}
</script>

<template>
  <aside v-if="label" class="send-status" aria-live="polite">
    <span>{{ label }}</span>
    <button v-if="canRetry" type="button" @click="retry">
      {{
        latestSend?.kind === 'status' && latestSend.value.needsReconciliation
          ? 'Verificar'
          : 'Reintentar'
      }}
    </button>
  </aside>
</template>
