<script setup lang="ts">
import { computed, ref } from 'vue'
import { useMailStore } from '../../app/stores/mail'
import { useRuntimeStore } from '../../app/stores/runtime'
import { useMailApplicationController } from '../../app/vue-application-context'
import type { EmailAddressList } from '../../domain/address'
import type { ScopedEmailId } from '../../domain/ids'
import type { Email } from '../../domain/email'

const mailStore = useMailStore()
const runtimeStore = useRuntimeStore()
const controller = useMailApplicationController()
const searchQuery = ref('')

const folderTitle = computed(() => {
  return mailStore.selectedMailbox?.name ?? 'Correo local'
})

const filteredEmails = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) return mailStore.emails

  return mailStore.emails.filter((msg) => {
    const subject = msg.subject?.toLowerCase() || ''
    const from = getFromLabel(msg.from).toLowerCase()
    const preview = msg.preview?.toLowerCase() || ''
    return (
      subject.includes(query) || from.includes(query) || preview.includes(query)
    )
  })
})

const messagesCount = computed(() => {
  if (mailStore.loadState === 'loading') return 'Cargando...'
  const count = filteredEmails.value.length
  if (count === 0) return 'Sin mensajes'
  if (count === 1) return '1 mensaje'
  return `${count} mensajes`
})

const refreshActivity = computed(() => {
  const accountKey = mailStore.selectedAccountKey
  return accountKey === null
    ? { phase: 'idle' as const, error: null }
    : (mailStore.refreshActivity[String(accountKey)] ?? {
        phase: 'idle' as const,
        error: null,
      })
})

const canRefresh = computed(
  () =>
    mailStore.selectedAccountKey !== null &&
    runtimeStore.auth === 'authenticated',
)

function handleRefresh() {
  const accountKey = mailStore.selectedAccountKey
  if (
    accountKey === null ||
    !canRefresh.value ||
    refreshActivity.value.phase === 'refreshing'
  ) {
    return
  }
  void controller.refreshAccount(accountKey)
}

function isEmailSelected(emailId: ScopedEmailId): boolean {
  if (!mailStore.selectedEmailId) return false
  return (
    mailStore.selectedEmailId.accountKey === emailId.accountKey &&
    mailStore.selectedEmailId.jmapId === emailId.jmapId
  )
}

function isUnread(email: Email): boolean {
  return !email.keywords.has('$seen')
}

function isFlagged(email: Email): boolean {
  return email.keywords.has('$flagged')
}

function getFromLabel(from: EmailAddressList): string {
  if (!from || from.length === 0) return 'Sin remitente'
  const first = from[0]
  return first.name || first.email
}

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr)
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return dateStr
  }
}

function handleToggleSeen(e: Event, emailId: ScopedEmailId) {
  e.stopPropagation()
  const value = mailStore.emails.find(
    (email) =>
      email.id.accountKey === emailId.accountKey &&
      email.id.jmapId === emailId.jmapId,
  )
  if (value !== undefined) {
    void controller.toggleKeyword(value, '$seen').catch(() => {
      mailStore.setLoadState('error', 'No se pudo actualizar el mensaje.')
    })
  }
}

function handleToggleFlag(e: Event, emailId: ScopedEmailId) {
  e.stopPropagation()
  const value = mailStore.emails.find(
    (email) =>
      email.id.accountKey === emailId.accountKey &&
      email.id.jmapId === emailId.jmapId,
  )
  if (value !== undefined) {
    void controller.toggleKeyword(value, '$flagged').catch(() => {
      mailStore.setLoadState('error', 'No se pudo actualizar el mensaje.')
    })
  }
}

function handleDelete(e: Event, emailId: ScopedEmailId) {
  e.stopPropagation()
  void controller.moveEmail(emailId, 'trash').catch(() => {
    mailStore.setLoadState('error', 'No se pudo mover el mensaje.')
  })
}

function handleSelectEmail(emailId: ScopedEmailId) {
  void controller.selectEmail(emailId)
}
</script>

<template>
  <section class="message-list" aria-labelledby="message-list-title">
    <header class="message-list__header">
      <div class="message-list__header-row">
        <h1 id="message-list-title">{{ folderTitle }}</h1>
        <div class="message-list__header-actions">
          <span class="message-list__count-badge">{{ messagesCount }}</span>
          <button
            class="message-list__refresh"
            type="button"
            :disabled="!canRefresh || refreshActivity.phase === 'refreshing'"
            title="Actualizar correo"
            aria-label="Actualizar correo"
            @click="handleRefresh"
          >
            {{
              refreshActivity.phase === 'refreshing'
                ? 'Sincronizando…'
                : 'Actualizar'
            }}
          </button>
        </div>
      </div>
      <p
        v-if="refreshActivity.error"
        class="message-list__refresh-error"
        role="alert"
      >
        {{ refreshActivity.error }}
      </p>

      <!-- Barra de búsqueda rápida -->
      <div class="message-list__search">
        <svg
          class="message-list__search-icon"
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          v-model="searchQuery"
          type="text"
          class="message-list__search-input"
          placeholder="Buscar en esta carpeta..."
          aria-label="Buscar correos"
        />
        <button
          v-if="searchQuery.length > 0"
          type="button"
          class="message-list__search-clear"
          title="Limpiar búsqueda"
          @click="searchQuery = ''"
        >
          ✕
        </button>
      </div>
    </header>

    <!-- Estado de Carga -->
    <div
      v-if="mailStore.loadState === 'loading'"
      class="message-list__loading-state"
    >
      <span class="message-list__spinner"></span>
      <p>Cargando mensajes...</p>
    </div>

    <!-- Lista de Correos -->
    <ul v-else-if="filteredEmails.length > 0" class="message-list__items">
      <li
        v-for="msg in filteredEmails"
        :key="`${msg.id.accountKey}:${msg.id.jmapId}`"
      >
        <button
          class="message-item"
          :class="{
            'message-item--selected': isEmailSelected(msg.id),
            'message-item--unread': isUnread(msg),
          }"
          type="button"
          @click="handleSelectEmail(msg.id)"
        >
          <div class="message-item__top">
            <div class="message-item__from-group">
              <span v-if="isUnread(msg)" class="message-item__unread-dot" />
              <span class="message-item__from">{{
                getFromLabel(msg.from)
              }}</span>
            </div>
            <time class="message-item__date">{{
              formatDate(msg.receivedAt)
            }}</time>
          </div>

          <div class="message-item__mid">
            <span class="message-item__subject">{{
              msg.subject || '(Sin asunto)'
            }}</span>
          </div>

          <div class="message-item__bottom">
            <span class="message-item__preview">{{ msg.preview }}</span>

            <!-- Botones de acción rápida al pasar el mouse -->
            <div class="message-item__quick-actions">
              <!-- Destacar / Estrella -->
              <button
                class="message-item__quick-btn"
                :class="{ 'message-item__quick-btn--active': isFlagged(msg) }"
                type="button"
                :title="
                  isFlagged(msg) ? 'Quitar estrella' : 'Marcar con estrella'
                "
                @click="handleToggleFlag($event, msg.id)"
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  :fill="isFlagged(msg) ? '#eab308' : 'none'"
                  :stroke="isFlagged(msg) ? '#eab308' : 'currentColor'"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <polygon
                    points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
                  />
                </svg>
              </button>

              <!-- Alternar Leído / No Leído con sobre abierto o cerrado según el estado -->
              <button
                class="message-item__quick-btn"
                type="button"
                :title="isUnread(msg) ? 'Marcar como leído' : 'Marcar no leído'"
                @click="handleToggleSeen($event, msg.id)"
              >
                <!-- Sobre cerrado si no está leído -->
                <svg
                  v-if="isUnread(msg)"
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path
                    d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"
                  />
                  <polyline points="22,6 12,13 2,6" />
                </svg>
                <!-- Sobre abierto si ya está leído -->
                <svg
                  v-else
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path
                    d="M21.2 8.4c.5.38.8.97.8 1.6v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 .8-1.6l8-6a2 2 0 0 1 2.4 0l8 6Z"
                  />
                  <path d="m22 10-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 10" />
                </svg>
              </button>

              <!-- Eliminar -->
              <button
                class="message-item__quick-btn message-item__quick-btn--delete"
                type="button"
                title="Eliminar"
                @click="handleDelete($event, msg.id)"
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <polyline points="3 6 5 6 21 6" />
                  <path
                    d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
                  />
                </svg>
              </button>
            </div>
          </div>
        </button>
      </li>
    </ul>

    <!-- Estado Vacío -->
    <div v-else class="empty-state">
      <svg
        class="empty-state__icon"
        width="40"
        height="40"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#94a3b8"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M22 12h-6l-2 3h-4l-2-3H2" />
        <path
          d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"
        />
      </svg>
      <h2>
        {{
          mailStore.loadState === 'error'
            ? 'Error de almacenamiento local'
            : mailStore.loadState === 'notCached'
              ? 'Vista no disponible en la caché local'
              : searchQuery
                ? 'Sin resultados'
                : mailStore.selectedAccountKey === null
                  ? 'No hay cuentas locales'
                  : 'No hay mensajes'
        }}
      </h2>
      <p>
        {{
          mailStore.error ??
          (mailStore.loadState === 'notCached'
            ? 'La sincronización remota podrá materializar esta vista más adelante.'
            : searchQuery
              ? `No se encontraron correos que coincidan con "${searchQuery}".`
              : `Los mensajes de ${folderTitle.toLowerCase()} aparecerán aquí.`)
        }}
      </p>
    </div>
  </section>
</template>
