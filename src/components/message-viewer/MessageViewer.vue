<script setup lang="ts">
import { computed } from 'vue'
import DOMPurify from 'dompurify'
import { useMailStore } from '../../app/stores/mail'
import { useComposerStore } from '../../app/stores/composer'
import type { EmailAddressList } from '../../domain/address'

const mailStore = useMailStore()
const composerStore = useComposerStore()

const email = computed(() => mailStore.selectedEmail)

function formatAddressList(addresses: EmailAddressList): string {
  if (!addresses || addresses.length === 0) return 'Ninguno'
  return addresses
    .map((addr) => (addr.name ? `${addr.name} <${addr.email}>` : addr.email))
    .join(', ')
}

function getSenderInitial(from: EmailAddressList): string {
  if (!from || from.length === 0) return '?'
  const name = from[0].name || from[0].email
  return name.charAt(0).toUpperCase()
}

function getSenderName(from: EmailAddressList): string {
  if (!from || from.length === 0) return 'Sin remitente'
  return from[0].name || from[0].email
}

function getSenderEmail(from: EmailAddressList): string {
  if (!from || from.length === 0) return ''
  return from[0].email
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return ''
  try {
    const date = new Date(dateStr)
    return date.toLocaleString(undefined, {
      dateStyle: 'full',
      timeStyle: 'short',
    })
  } catch {
    return dateStr
  }
}

function handleReply() {
  if (!email.value) return
  const fromAddr = email.value.from?.[0]?.email ?? ''
  const subject = email.value.subject?.startsWith('Re:')
    ? email.value.subject
    : `Re: ${email.value.subject || ''}`

  composerStore.open({
    to: fromAddr,
    subject,
    body: `\n\n--- En fecha ${formatDate(email.value.receivedAt)}, ${formatAddressList(email.value.from)} escribió:\n> ${email.value.preview}`,
  })
}

function handleToggleFlag() {
  if (!email.value) return
  mailStore.toggleFlagged(email.value.id)
}

function handleToggleSeen() {
  if (!email.value) return
  mailStore.toggleSeen(email.value.id)
}

function handleMarkSpam() {
  if (!email.value) return
  mailStore.moveToFolder(email.value.id, 'spam')
}

function handleDelete() {
  if (!email.value) return
  mailStore.deleteEmail(email.value.id)
}

const isFlagged = computed(() => email.value?.keywords.has('$flagged') ?? false)
const isSeen = computed(() => email.value?.keywords.has('$seen') ?? false)

const iframeDocument = computed(() => {
  if (!email.value) return ''

  const rawHtml = email.value.preview
    ? `<p style="font-size: 15px; line-height: 1.6; color: #1e293b;">${email.value.preview}</p>`
    : '<p><em>(Sin contenido de mensaje)</em></p>'

  const cleanHtml = DOMPurify.sanitize(rawHtml, {
    FORBID_TAGS: [
      'script',
      'iframe',
      'object',
      'embed',
      'form',
      'svg',
      'math',
      'style',
    ],
    FORBID_ATTR: ['style', 'onerror', 'onload', 'onclick', 'onmouseover'],
    ALLOW_DATA_ATTR: false,
  })

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
  <style>
    body {
      margin: 0;
      padding: 24px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      font-size: 14px;
      line-height: 1.65;
      color: #0f172a;
      word-break: break-word;
    }
  </style>
</head>
<body>${cleanHtml}</body>
</html>`
})
</script>

<template>
  <section class="message-viewer" aria-labelledby="message-viewer-title">
    <div v-if="email" class="message-viewer__content">
      <header class="message-viewer__header">
        <div class="message-viewer__top-bar">
          <h1 id="message-viewer-title" class="message-viewer__subject">
            {{ email.subject || '(Sin asunto)' }}
          </h1>

          <div class="message-viewer__actions">
            <!-- Responder -->
            <button
              class="message-viewer__action-btn"
              type="button"
              title="Responder al remitente"
              @click="handleReply"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="9 17 4 12 9 7" />
                <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
              </svg>
              <span>Responder</span>
            </button>

            <!-- Destacar (Estrella) -->
            <button
              class="message-viewer__action-btn"
              :class="{ 'message-viewer__action-btn--starred': isFlagged }"
              type="button"
              :title="isFlagged ? 'Quitar estrella' : 'Marcar con estrella'"
              @click="handleToggleFlag"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                :fill="isFlagged ? '#eab308' : 'none'"
                :stroke="isFlagged ? '#eab308' : 'currentColor'"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polygon
                  points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
                />
              </svg>
              <span>{{ isFlagged ? 'Destacado' : 'Destacar' }}</span>
            </button>

            <!-- Marcar No Leído / Leído -->
            <button
              class="message-viewer__action-btn"
              type="button"
              :title="isSeen ? 'Marcar como no leído' : 'Marcar como leído'"
              @click="handleToggleSeen"
            >
              <!-- Sobre abierto si isSeen -->
              <svg
                v-if="isSeen"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path
                  d="M21.2 8.4c.5.38.8.97.8 1.6v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 .8-1.6l8-6a2 2 0 0 1 2.4 0l8 6Z"
                />
                <path d="m22 10-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 10" />
              </svg>
              <!-- Sobre cerrado si !isSeen -->
              <svg
                v-else
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path
                  d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"
                />
                <polyline points="22,6 12,13 2,6" />
              </svg>
              <span>{{ isSeen ? 'Leído' : 'No leído' }}</span>
            </button>

            <!-- Marcar Spam -->
            <button
              class="message-viewer__action-btn"
              type="button"
              title="Marcar como spam"
              @click="handleMarkSpam"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>Spam</span>
            </button>

            <!-- Eliminar -->
            <button
              class="message-viewer__action-btn message-viewer__action-btn--delete"
              type="button"
              title="Eliminar mensaje"
              @click="handleDelete"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="3 6 5 6 21 6" />
                <path
                  d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
                />
              </svg>
              <span>Eliminar</span>
            </button>
          </div>
        </div>

        <div class="message-viewer__meta">
          <div class="message-viewer__sender-card">
            <div class="message-viewer__avatar">
              {{ getSenderInitial(email.from) }}
            </div>
            <div class="message-viewer__sender-details">
              <div class="message-viewer__sender-top">
                <span class="message-viewer__sender-name">{{
                  getSenderName(email.from)
                }}</span>
                <span class="message-viewer__sender-email"
                  >&lt;{{ getSenderEmail(email.from) }}&gt;</span
                >
                <time class="message-viewer__date">{{
                  formatDate(email.receivedAt)
                }}</time>
              </div>
              <div
                v-if="email.to && email.to.length > 0"
                class="message-viewer__to-line"
              >
                <span class="message-viewer__label">Para:</span>
                <span class="message-viewer__value">{{
                  formatAddressList(email.to)
                }}</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div class="message-viewer__body">
        <iframe
          sandbox=""
          :srcdoc="iframeDocument"
          class="message-viewer__iframe"
          title="Contenido del mensaje"
        />
      </div>
    </div>

    <div v-else class="empty-state">
      <svg
        class="empty-state__icon"
        width="44"
        height="44"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#94a3b8"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path
          d="M21.2 8.4c.5.38.8.97.8 1.6v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 .8-1.6l8-6a2 2 0 0 1 2.4 0l8 6Z"
        />
        <path d="m22 10-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 10" />
      </svg>
      <h2 id="message-viewer-title">Selecciona un mensaje</h2>
      <p>El contenido del correo aparecerá aquí.</p>
    </div>
  </section>
</template>
