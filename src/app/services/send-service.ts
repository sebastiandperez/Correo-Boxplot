/**
 * send-service.ts — Caso de uso: Enviar un correo.
 *
 * Orquesta el flujo completo:
 *   composerStore (UI) → SendIntent (dominio) → stageSendMutation (engine)
 *                      → optimistic UI update (mailStore)
 *
 * Regla: este servicio vive en Application (src/app/services/). Puede
 * importar de domain/, app/stores/, y app/engine.ts.
 * NUNCA importa de components/.
 */

import { sendIntent } from '../../domain/send-intent'
import {
  sendMutation,
  mutationInstantFromString,
} from '../../domain/pending-mutation'
import { emailAddress } from '../../domain/address'
import { mutationIdFromString } from '../../domain/ids'
import { getEngine, DEMO_IDENTITY } from '../engine'
import { useComposerStore } from '../stores/composer'
import { useMailStore } from '../stores/mail'

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type SendResult =
  | { ok: true }
  | {
      ok: false
      error: 'emptyRecipient' | 'invalidAddress' | 'engineError' | 'notReady'
    }

// ─── Utilidades ───────────────────────────────────────────────────────────────

function generateMutationId(): string {
  return `mut_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function nowInstant(): string {
  return new Date().toISOString()
}

function parseRecipients(rawTo: string) {
  return rawTo
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((addr) => emailAddress(null, addr))
}

// ─── Servicio principal ───────────────────────────────────────────────────────

/**
 * Toma el estado actual del composerStore, construye un SendMutation
 * correctamente tipado y lo persiste en el MemoryLocalEngine.
 *
 * También actualiza el mailStore de forma optimista para que la UI
 * refleje el correo en Enviados inmediatamente.
 */
export async function executeSend(): Promise<SendResult> {
  const composerStore = useComposerStore()
  const mailStore = useMailStore()

  // 1. Validar que el engine esté listo
  let engine
  try {
    engine = await getEngine()
  } catch {
    return { ok: false, error: 'notReady' }
  }

  // 2. Parsear destinatarios
  const toAddresses = parseRecipients(composerStore.to)
  if (toAddresses.length === 0) {
    return { ok: false, error: 'emptyRecipient' }
  }

  // 3. Construir el SendIntent usando el dominio
  let intent
  try {
    intent = sendIntent({
      identity: DEMO_IDENTITY,
      to: toAddresses,
      cc: [],
      bcc: [],
      subject: composerStore.subject.trim() || '(Sin asunto)',
      body: {
        text: composerStore.body,
        html: null,
      },
    })
  } catch (err) {
    console.warn('[send-service] SendIntent inválido:', err)
    return { ok: false, error: 'invalidAddress' }
  }

  // 4. Construir y persistir la SendMutation en el engine
  const mutation = sendMutation({
    mutationId: mutationIdFromString(generateMutationId()),
    accountKey: DEMO_IDENTITY.id.accountKey,
    createdAt: mutationInstantFromString(nowInstant()),
    intent,
  })

  const result = await engine.syncPort.stageSendMutation(mutation)

  if (!result.ok) {
    console.error('[send-service] stageSendMutation falló:', result.error)
    return { ok: false, error: 'engineError' }
  }

  // 5. Actualizar la UI de forma optimista: agregar a Enviados en mailStore
  mailStore.sendEmail(
    composerStore.to,
    composerStore.subject,
    composerStore.body,
  )

  return { ok: true }
}
