<script setup lang="ts">
defineOptions({ name: 'MailComposer' })
</script>

<template>
  <section class="composer" aria-labelledby="composer-title">
    <header class="composer__header">
      <h2 id="composer-title">Nuevo mensaje</h2>
    </header>

    <div class="composer__field">
      <label for="composer-to">Para</label>
      <input id="composer-to" type="email" disabled />
    </div>

    <div class="composer__field">
      <label for="composer-subject">Asunto</label>
      <input id="composer-subject" type="text" disabled />
    </div>

    <div class="composer__field composer__field--body">
      <label for="composer-body">Mensaje</label>
      <textarea id="composer-body" disabled />
    </div>

    <footer class="composer__footer">
      <button type="button" disabled>Enviar</button>
    </footer>
  </section>
</template>
