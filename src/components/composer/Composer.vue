<script setup lang="ts">
import { useComposerStore } from '../../app/stores/composer'
import { executeSend } from '../../app/services/send-service'
import { useApplicationContext } from '../../app/vue-application-context'

defineOptions({ name: 'MailComposer' })

const composerStore = useComposerStore()
const applicationContext = useApplicationContext()

function handleClose() {
  composerStore.close()
}

async function handleSend() {
  if (!composerStore.canSend) return

  await executeSend(applicationContext)
}
</script>

<template>
  <div
    v-if="composerStore.isOpen"
    class="composer-overlay"
    tabindex="-1"
    @click.self="handleClose"
    @keydown.esc="handleClose"
  >
    <section
      class="composer"
      aria-labelledby="composer-title"
      @keydown.ctrl.enter="handleSend"
      @keydown.meta.enter="handleSend"
    >
      <header class="composer__header">
        <h2 id="composer-title" class="composer__title">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path
              d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"
            />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
          <span>Nuevo mensaje</span>
        </h2>
        <button
          class="composer__close-btn"
          type="button"
          aria-label="Cerrar (Escape)"
          title="Cerrar (Esc)"
          @click="handleClose"
        >
          ✕
        </button>
      </header>

      <!-- Mensaje de error si falla la validación -->
      <div v-if="composerStore.error" class="composer__error-banner">
        <span>⚠️ {{ composerStore.error }}</span>
      </div>

      <div class="composer__fields">
        <div class="composer__field">
          <label for="composer-to">Para</label>
          <input
            id="composer-to"
            v-model="composerStore.to"
            type="email"
            placeholder="destinatario@ejemplo.com"
            :disabled="composerStore.phase === 'queueing'"
            autofocus
          />
        </div>

        <div class="composer__field">
          <label for="composer-subject">Asunto</label>
          <input
            id="composer-subject"
            v-model="composerStore.subject"
            type="text"
            placeholder="Asunto del correo"
            :disabled="composerStore.phase === 'queueing'"
          />
        </div>

        <div class="composer__field composer__field--body">
          <textarea
            id="composer-body"
            v-model="composerStore.body"
            class="composer__body-input"
            placeholder="Escribe tu mensaje aquí... (Ctrl+Enter para enviar)"
            :disabled="composerStore.phase === 'queueing'"
          />
        </div>
      </div>

      <footer class="composer__footer">
        <button
          class="composer__discard-btn"
          type="button"
          title="Descartar borrador (Esc)"
          @click="composerStore.reset()"
        >
          Descartar
        </button>

        <div class="composer__actions">
          <button
            class="composer__send-btn"
            type="button"
            title="Enviar correo (Ctrl+Enter)"
            :disabled="!composerStore.canSend"
            @click="handleSend"
          >
            <svg
              v-if="composerStore.phase !== 'queueing'"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
            <span>{{
              composerStore.phase === 'queueing' ? 'Enviando...' : 'Enviar'
            }}</span>
          </button>
        </div>
      </footer>
    </section>
  </div>
</template>
