<script setup lang="ts">
import { onMounted } from 'vue'
import AppShell from './components/layout/AppShell.vue'
import { getEngine } from './app/engine'

onMounted(async () => {
  await getEngine()
})
</script>

<template>
  <AppShell />
</template>
