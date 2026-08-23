import {
  accountKeyFromString,
  jmapBlobIdFromString,
  jmapEmailIdFromString,
  jmapMailboxIdFromString,
  jmapThreadIdFromString,
  scopedBlobId,
  scopedEmailId,
  scopedMailboxId,
  scopedThreadId,
} from '../domain/ids'
import { email, type Email } from '../domain/email'
import { mailbox, type Mailbox } from '../domain/mailbox'
import { emailAddress } from '../domain/address'

export const DEMO_ACCOUNT_KEY = accountKeyFromString('juan@correo.local')

export function createMockMailboxes(): Mailbox[] {
  const rights = {
    mayReadItems: true,
    mayAddItems: true,
    mayRemoveItems: true,
    maySetSeen: true,
    maySetKeywords: true,
    maySubmit: true,
  }

  return [
    mailbox({
      id: scopedMailboxId(DEMO_ACCOUNT_KEY, jmapMailboxIdFromString('inbox')),
      name: 'Bandeja de entrada',
      parent: null,
      role: 'inbox',
      sortOrder: 1,
      totalEmails: 3,
      unreadEmails: 2,
      rights,
    }),
    mailbox({
      id: scopedMailboxId(DEMO_ACCOUNT_KEY, jmapMailboxIdFromString('drafts')),
      name: 'Borradores',
      parent: null,
      role: 'drafts',
      sortOrder: 2,
      totalEmails: 1,
      unreadEmails: 0,
      rights,
    }),
    mailbox({
      id: scopedMailboxId(DEMO_ACCOUNT_KEY, jmapMailboxIdFromString('sent')),
      name: 'Enviados',
      parent: null,
      role: 'sent',
      sortOrder: 3,
      totalEmails: 1,
      unreadEmails: 0,
      rights,
    }),
    mailbox({
      id: scopedMailboxId(DEMO_ACCOUNT_KEY, jmapMailboxIdFromString('spam')),
      name: 'Spam',
      parent: null,
      role: 'junk',
      sortOrder: 4,
      totalEmails: 1,
      unreadEmails: 1,
      rights,
    }),
    mailbox({
      id: scopedMailboxId(DEMO_ACCOUNT_KEY, jmapMailboxIdFromString('trash')),
      name: 'Papelera',
      parent: null,
      role: 'trash',
      sortOrder: 5,
      totalEmails: 1,
      unreadEmails: 0,
      rights,
    }),
  ]
}

export function createMockEmailsByFolder(): Record<string, Email[]> {
  const account = DEMO_ACCOUNT_KEY

  const inboxEmails: Email[] = [
    email({
      id: scopedEmailId(account, jmapEmailIdFromString('msg_001')),
      blobId: scopedBlobId(account, jmapBlobIdFromString('blob_001')),
      threadId: scopedThreadId(account, jmapThreadIdFromString('th_001')),
      sender: [emailAddress('Equipo Boxplot', 'dev@boxplot.local')],
      from: [emailAddress('Equipo Boxplot', 'dev@boxplot.local')],
      replyTo: null,
      to: [emailAddress('Juan Fernando', 'juan@correo.local')],
      cc: null,
      bcc: null,
      subject: '🚀 ¡Bienvenido a tu nuevo cliente de correo!',
      sentAt: new Date(Date.now() - 3600000 * 2).toISOString(),
      receivedAt: new Date(Date.now() - 3600000 * 2).toISOString(),
      size: 1420,
      preview:
        'Tu aplicación de correo local-first ya está en marcha. Todo lo que ves se almacena localmente y se renderiza con la máxima seguridad.',
      hasAttachment: false,
      keywords: new Set(['$seen']),
    }),
    email({
      id: scopedEmailId(account, jmapEmailIdFromString('msg_002')),
      blobId: scopedBlobId(account, jmapBlobIdFromString('blob_002')),
      threadId: scopedThreadId(account, jmapThreadIdFromString('th_002')),
      sender: [emailAddress('Seguridad Local-First', 'security@boxplot.local')],
      from: [emailAddress('Seguridad Local-First', 'security@boxplot.local')],
      replyTo: null,
      to: [emailAddress('Juan Fernando', 'juan@correo.local')],
      cc: null,
      bcc: null,
      subject: '🛡️ Reporte de Protección: Sandbox y DOMPurify Activos',
      sentAt: new Date(Date.now() - 3600000 * 5).toISOString(),
      receivedAt: new Date(Date.now() - 3600000 * 5).toISOString(),
      size: 2340,
      preview:
        'Cualquier contenido HTML malicioso, enlaces con javascript o intentos de rastreo están bloqueados dentro de un iframe aislado.',
      hasAttachment: false,
      keywords: new Set([]),
    }),
    email({
      id: scopedEmailId(account, jmapEmailIdFromString('msg_003')),
      blobId: scopedBlobId(account, jmapBlobIdFromString('blob_003')),
      threadId: scopedThreadId(account, jmapThreadIdFromString('th_003')),
      sender: [
        emailAddress('GitHub Notifications', 'notifications@github.com'),
      ],
      from: [emailAddress('GitHub Notifications', 'notifications@github.com')],
      replyTo: null,
      to: [emailAddress('Juan Fernando', 'juan@correo.local')],
      cc: null,
      bcc: null,
      subject: '📦 [Pull Request] UI + Application completados exitosamente',
      sentAt: new Date(Date.now() - 3600000 * 24).toISOString(),
      receivedAt: new Date(Date.now() - 3600000 * 24).toISOString(),
      size: 3100,
      preview:
        'Se han conectado los stores de Pinia con los componentes Vue 3. La interfaz cuenta con navegación fluida y animaciones interactivas.',
      hasAttachment: false,
      keywords: new Set(['$seen']),
    }),
  ]

  const sentEmails: Email[] = [
    email({
      id: scopedEmailId(account, jmapEmailIdFromString('msg_004')),
      blobId: scopedBlobId(account, jmapBlobIdFromString('blob_004')),
      threadId: scopedThreadId(account, jmapThreadIdFromString('th_004')),
      sender: [emailAddress('Juan Fernando', 'juan@correo.local')],
      from: [emailAddress('Juan Fernando', 'juan@correo.local')],
      replyTo: null,
      to: [emailAddress('Profesor Universidad', 'profesor@universidad.edu.co')],
      cc: null,
      bcc: null,
      subject: 'Avance del Proyecto: Cliente de Correo',
      sentAt: new Date(Date.now() - 3600000 * 12).toISOString(),
      receivedAt: new Date(Date.now() - 3600000 * 12).toISOString(),
      size: 980,
      preview:
        'Buenas tardes profesor, adjunto el reporte de diseño de la capa de UI + Application y la conexión con el estado reactivo.',
      hasAttachment: false,
      keywords: new Set(['$seen']),
    }),
  ]

  const draftsEmails: Email[] = [
    email({
      id: scopedEmailId(account, jmapEmailIdFromString('msg_005')),
      blobId: scopedBlobId(account, jmapBlobIdFromString('blob_005')),
      threadId: scopedThreadId(account, jmapThreadIdFromString('th_005')),
      sender: [emailAddress('Juan Fernando', 'juan@correo.local')],
      from: [emailAddress('Juan Fernando', 'juan@correo.local')],
      replyTo: null,
      to: [emailAddress('Colega', 'colega@empresa.com')],
      cc: null,
      bcc: null,
      subject: '(Borrador) Ideas para la sincronización JMAP',
      sentAt: null,
      receivedAt: new Date(Date.now() - 3600000 * 30).toISOString(),
      size: 500,
      preview:
        'Hola, estaba pensando que la arquitectura por puertos nos permite probar toda la interfaz sin depender del backend...',
      hasAttachment: false,
      keywords: new Set([]),
    }),
  ]

  const spamEmails: Email[] = [
    email({
      id: scopedEmailId(account, jmapEmailIdFromString('msg_006')),
      blobId: scopedBlobId(account, jmapBlobIdFromString('blob_006')),
      threadId: scopedThreadId(account, jmapThreadIdFromString('th_006')),
      sender: [emailAddress('Lotería Internacional', 'premio@spam.net')],
      from: [emailAddress('Lotería Internacional', 'premio@spam.net')],
      replyTo: null,
      to: [emailAddress('Juan Fernando', 'juan@correo.local')],
      cc: null,
      bcc: null,
      subject: '🎉 ¡Has ganado un premio de $1,000,000 USD! Reclama aquí',
      sentAt: new Date(Date.now() - 3600000 * 48).toISOString(),
      receivedAt: new Date(Date.now() - 3600000 * 48).toISOString(),
      size: 4500,
      preview:
        'Felicidades! Fuiste seleccionado como ganador. Haz clic en el enlace para reclamar tus fondos de inmediato.',
      hasAttachment: false,
      keywords: new Set([]),
    }),
  ]

  const trashEmails: Email[] = [
    email({
      id: scopedEmailId(account, jmapEmailIdFromString('msg_007')),
      blobId: scopedBlobId(account, jmapBlobIdFromString('blob_007')),
      threadId: scopedThreadId(account, jmapThreadIdFromString('th_007')),
      sender: [emailAddress('Newsletter Antiguo', 'news@antiguo.org')],
      from: [emailAddress('Newsletter Antiguo', 'news@antiguo.org')],
      replyTo: null,
      to: [emailAddress('Juan Fernando', 'juan@correo.local')],
      cc: null,
      bcc: null,
      subject: 'Boletín mensual - Enero 2026',
      sentAt: new Date(Date.now() - 3600000 * 120).toISOString(),
      receivedAt: new Date(Date.now() - 3600000 * 120).toISOString(),
      size: 1800,
      preview:
        'Este es el boletín del mes pasado que ya fue enviado a la papelera de reciclaje.',
      hasAttachment: false,
      keywords: new Set(['$seen']),
    }),
  ]

  return {
    inbox: inboxEmails,
    sent: sentEmails,
    drafts: draftsEmails,
    spam: spamEmails,
    trash: trashEmails,
  }
}
