<script setup lang="ts">
import { storeToRefs } from 'pinia'

import { useRuntimeStore } from './app/stores/runtime'

const runtime = useRuntimeStore()
const { auth, connectivity, local } = storeToRefs(runtime)
</script>

<template>
  <main class="shell">
    <p class="eyebrow">Tauri MVP · local-first</p>
    <h1>Correo Boxplot</h1>
    <p data-testid="runtime-status">
      Local: {{ local }} · Auth: {{ auth }} · Network: {{ connectivity }}
    </p>
  </main>
</template>
