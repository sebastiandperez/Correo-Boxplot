<script setup lang="ts">
import { useAccountSetupStore } from '../../app/stores/account-setup'
import type {
  AccountSetupProfile,
  AccountSetupRequest,
} from '../../app/stores/account-setup'

const store = useAccountSetupStore()
withDefaults(
  defineProps<{
    mode?: 'firstRun' | 'reconnect'
  }>(),
  { mode: 'firstRun' },
)
const emit = defineEmits<{
  submit: [request: AccountSetupRequest]
  cancel: []
}>()

function readInputValue(event: Event): string {
  return (event.target as HTMLInputElement).value
}

function handleProfileChange(event: Event) {
  store.setProfile(
    (event.target as HTMLSelectElement).value as AccountSetupProfile,
  )
}

function handleSubmit() {
  const result = store.buildRequest()
  if (result.ok) emit('submit', result.value)
}
</script>

<template>
  <main class="account-setup" aria-labelledby="account-setup-title">
    <section class="account-setup__panel">
      <header class="account-setup__header">
        <p class="account-setup__eyebrow">Correo Boxplot</p>
        <h1 id="account-setup-title">
          {{
            mode === 'reconnect'
              ? 'Reconectar para sincronizar'
              : 'Configurar cuenta'
          }}
        </h1>
        <p>
          {{
            mode === 'reconnect'
              ? 'Ingresa de nuevo las credenciales para restaurar la sincronización.'
              : 'Ingresa la configuración local que se usará para conectar más adelante.'
          }}
        </p>
      </header>

      <form
        class="account-setup__form"
        novalidate
        @submit.prevent="handleSubmit"
      >
        <label class="account-setup__field" for="account-profile">
          <span>Perfil / protocolo</span>
          <select
            id="account-profile"
            name="profile"
            :value="store.profile"
            @change="handleProfileChange"
          >
            <option value="boxplotLocalImap">Boxplot Local / IMAP</option>
          </select>
        </label>

        <label class="account-setup__field" for="account-username">
          <span>Usuario</span>
          <input
            id="account-username"
            name="username"
            type="text"
            autocomplete="username"
            :value="store.username"
            @input="store.setUsername(readInputValue($event))"
          />
        </label>

        <label class="account-setup__field" for="account-password">
          <span>Contraseña</span>
          <input
            id="account-password"
            name="password"
            type="password"
            autocomplete="current-password"
            :value="store.password"
            @input="store.setPassword(readInputValue($event))"
          />
        </label>

        <label class="account-setup__field" for="account-host">
          <span>Servidor</span>
          <input
            id="account-host"
            name="host"
            type="text"
            autocomplete="off"
            :value="store.host"
            @input="store.setHost(readInputValue($event))"
          />
        </label>

        <label class="account-setup__field" for="account-imap-port">
          <span>Puerto IMAP</span>
          <input
            id="account-imap-port"
            name="imapPort"
            type="text"
            inputmode="numeric"
            :value="store.port"
            @input="store.setPort(readInputValue($event))"
          />
        </label>

        <p class="account-setup__smtp" aria-live="polite">
          SMTP: <strong>{{ store.smtpEndpoint }}</strong>
        </p>

        <p
          v-if="store.error"
          id="account-setup-error"
          class="account-setup__error"
          role="alert"
        >
          {{ store.error }}
        </p>

        <button
          class="account-setup__submit"
          type="submit"
          :disabled="
            store.phase === 'validating' || store.phase === 'connecting'
          "
        >
          {{ store.phase === 'connecting' ? 'Conectando…' : 'Conectar' }}
        </button>
        <button
          v-if="mode === 'reconnect'"
          class="account-setup__cancel"
          type="button"
          :disabled="store.phase === 'connecting'"
          @click="emit('cancel')"
        >
          Cancelar
        </button>
      </form>
    </section>
  </main>
</template>

<style scoped>
.account-setup {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 32px 20px;
  background:
    radial-gradient(
      circle at top left,
      rgb(219 234 254 / 80%),
      transparent 42%
    ),
    #f8fafc;
  color: #0f172a;
}

.account-setup__panel {
  width: min(100%, 480px);
  border: 1px solid #dbe3ee;
  border-radius: 18px;
  padding: 32px;
  background: #fff;
  box-shadow: 0 20px 50px rgb(15 23 42 / 10%);
}

.account-setup__header h1 {
  margin: 4px 0 8px;
  font-size: 1.75rem;
}

.account-setup__header p {
  margin: 0;
  color: #64748b;
  line-height: 1.5;
}

.account-setup__eyebrow {
  color: #2563eb !important;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.account-setup__form {
  display: grid;
  gap: 18px;
  margin-top: 28px;
}

.account-setup__field {
  display: grid;
  gap: 7px;
  font-size: 0.875rem;
  font-weight: 600;
}

.account-setup__field input,
.account-setup__field select {
  width: 100%;
  min-height: 44px;
  box-sizing: border-box;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  padding: 10px 12px;
  background: #fff;
  color: inherit;
  font: inherit;
  font-weight: 400;
}

.account-setup__field input:focus,
.account-setup__field select:focus {
  border-color: #2563eb;
  outline: 3px solid rgb(37 99 235 / 15%);
}

.account-setup__smtp {
  margin: -4px 0 0;
  border-radius: 10px;
  padding: 11px 12px;
  background: #f1f5f9;
  color: #475569;
  font-size: 0.875rem;
}

.account-setup__error {
  margin: -4px 0 0;
  color: #b91c1c;
  font-size: 0.875rem;
}

.account-setup__submit {
  min-height: 46px;
  border: 0;
  border-radius: 10px;
  background: #2563eb;
  color: #fff;
  cursor: pointer;
  font: inherit;
  font-weight: 700;
}

.account-setup__submit:hover:not(:disabled) {
  background: #1d4ed8;
}

.account-setup__submit:disabled {
  cursor: wait;
  opacity: 0.65;
}

.account-setup__cancel {
  min-height: 42px;
  border: 1px solid #cbd5e1;
  border-radius: 10px;
  background: #fff;
  color: #334155;
  cursor: pointer;
  font: inherit;
  font-weight: 600;
}

.account-setup__cancel:disabled {
  cursor: wait;
  opacity: 0.65;
}

@media (max-width: 520px) {
  .account-setup__panel {
    padding: 24px 20px;
  }
}
</style>
