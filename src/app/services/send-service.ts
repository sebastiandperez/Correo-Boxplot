/**
 * send-service.ts — Caso de uso: Enviar un correo (Epic A-06).
 *
 * Orquesta el flujo de envío seguro:
 *   composerStore.setPhase('queueing')
 *   → SendIntent (dominio inmutable)
 *   → stageSendMutation (SyncPort)
 *   → Si éxito: limpia composerStore.reset() y actualiza mailStore
 *   → Si falla: conserva composerStore.setPhase('error', msg) con el texto intacto
 */

import { sendIntent } from '../../domain/send-intent'
import {
  mutationInstantFromString,
  sendMutation,
} from '../../domain/pending-mutation'
import { emailAddress } from '../../domain/address'
import { mutationIdFromString } from '../../domain/ids'
import { DEMO_IDENTITY, getEngine } from '../engine'
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
 * correctamente tipado y lo persiste en el SyncPort.
 *
 * Sigue la semántica de cola de Epic A-06:
 * - Falla conserva el texto y pasa a phase='error'.
 * - Éxito limpia el compositor y pasa a phase='idle'.
 */
export async function executeSend(): Promise<SendResult> {
  const composerStore = useComposerStore()
  const mailStore = useMailStore()

  // 1. Marcar fase de encolamiento
  composerStore.setPhase('queueing')

  // 2. Validar destinatarios
  const toAddresses = parseRecipients(composerStore.to)
  if (toAddresses.length === 0) {
    composerStore.setPhase(
      'error',
      'El campo destinatario (Para) no puede estar vacío.',
    )
    return { ok: false, error: 'emptyRecipient' }
  }

  // 3. Validar que el engine esté disponible
  let engine
  try {
    engine = await getEngine()
  } catch {
    composerStore.setPhase(
      'error',
      'El motor local de almacenamiento no está listo.',
    )
    return { ok: false, error: 'notReady' }
  }

  // 4. Construir el SendIntent usando el dominio inmutable
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
    composerStore.setPhase(
      'error',
      'Formato de dirección de correo electrónico inválido.',
    )
    return { ok: false, error: 'invalidAddress' }
  }

  // 5. Construir y persistir la SendMutation en el engine vía SyncPort
  const mutation = sendMutation({
    mutationId: mutationIdFromString(generateMutationId()),
    accountKey: DEMO_IDENTITY.id.accountKey,
    createdAt: mutationInstantFromString(nowInstant()),
    intent,
  })

  const result = await engine.syncPort.stageSendMutation(mutation)

  if (!result.ok) {
    console.error('[send-service] stageSendMutation falló:', result.error)
    composerStore.setPhase(
      'error',
      'Error al persistir la mutación de envío en la base local.',
    )
    return { ok: false, error: 'engineError' }
  }

  // 6. Si el commit fue exitoso: actualizar UI optimista y resetear composer
  mailStore.sendEmail(
    composerStore.to,
    composerStore.subject,
    composerStore.body,
  )

  composerStore.reset()
  return { ok: true }
}
