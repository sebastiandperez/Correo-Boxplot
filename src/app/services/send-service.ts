import { emailAddress } from '../../domain/address'
import { isWildcardIdentity } from '../../domain/identity'
import { mutationIdFromString } from '../../domain/ids'
import {
  mutationInstantFromString,
  sendMutation,
} from '../../domain/pending-mutation'
import { sendIntent } from '../../domain/send-intent'
import type { ApplicationContext } from '../application'
import { useComposerStore } from '../stores/composer'
import { useMailStore } from '../stores/mail'

export type SendResult =
  | { ok: true }
  | {
      ok: false
      error:
        | 'emptyRecipient'
        | 'invalidAddress'
        | 'engineError'
        | 'notReady'
        | 'noIdentity'
    }

function generateMutationId(): string {
  return `send-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function parseRecipients(rawTo: string) {
  return rawTo
    .split(/[,;]/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .map((value) => emailAddress(null, value))
}

export async function executeSend(
  context: ApplicationContext,
): Promise<SendResult> {
  const composerStore = useComposerStore()
  const mailStore = useMailStore()
  composerStore.setPhase('queueing')

  const to = parseRecipients(composerStore.to)
  if (to.length === 0) {
    composerStore.setPhase(
      'error',
      'El campo destinatario (Para) no puede estar vacío.',
    )
    return { ok: false, error: 'emptyRecipient' }
  }

  const accountKey = mailStore.selectedAccountKey
  if (accountKey === null) {
    composerStore.setPhase('error', 'No hay una cuenta local seleccionada.')
    return { ok: false, error: 'notReady' }
  }

  const identities = await context.readRepository.listIdentities(accountKey)
  if (!identities.ok) {
    composerStore.setPhase(
      'error',
      'No se pudieron leer las identidades de envío locales.',
    )
    return { ok: false, error: 'engineError' }
  }
  if (identities.value.kind === 'ownerAbsent') {
    composerStore.setPhase('error', 'La cuenta local ya no está disponible.')
    return { ok: false, error: 'notReady' }
  }

  const selectedIdentity = [...identities.value.value]
    .filter((value) => !isWildcardIdentity(value))
    .sort((left, right) =>
      String(left.id.jmapId).localeCompare(String(right.id.jmapId)),
    )[0]
  if (selectedIdentity === undefined) {
    composerStore.setPhase(
      'error',
      'No hay una identidad de envío utilizable en la caché local.',
    )
    return { ok: false, error: 'noIdentity' }
  }

  let intent
  try {
    intent = sendIntent({
      securityMode: 'plain',
      identity: selectedIdentity,
      to,
      cc: [],
      bcc: [],
      subject: composerStore.subject,
      body: { text: composerStore.body, html: null },
    })
  } catch {
    composerStore.setPhase(
      'error',
      'Formato de dirección de correo electrónico inválido.',
    )
    return { ok: false, error: 'invalidAddress' }
  }

  const mutation = sendMutation({
    mutationId: mutationIdFromString(generateMutationId()),
    accountKey,
    createdAt: mutationInstantFromString(new Date().toISOString()),
    intent,
  })
  const result = await context.syncPort.stageSendMutation(mutation)
  if (!result.ok) {
    composerStore.setPhase(
      'error',
      'Error al persistir la mutación de envío en la base local.',
    )
    return { ok: false, error: 'engineError' }
  }

  composerStore.reset()
  return { ok: true }
}
