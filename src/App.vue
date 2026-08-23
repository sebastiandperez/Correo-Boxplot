<script setup lang="ts">
import { onBeforeUnmount, onMounted, provide } from 'vue'
import AppShell from './components/layout/AppShell.vue'
import { createMailApplicationController } from './app/application'
import { useMailStore } from './app/stores/mail'
import { useRuntimeStore } from './app/stores/runtime'
import {
  mailApplicationControllerKey,
  useApplicationContext,
} from './app/vue-application-context'

const context = useApplicationContext()
const mailStore = useMailStore()
const runtimeStore = useRuntimeStore()
const controller = createMailApplicationController(
  context,
  mailStore,
  runtimeStore,
)

provide(mailApplicationControllerKey, controller)

onMounted(() => {
  void controller.initialize().catch(() => undefined)
})

onBeforeUnmount(() => controller.dispose())
</script>

<template>
  <AppShell />
</template>
