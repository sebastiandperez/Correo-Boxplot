/**
 * engine.ts — Singleton del motor local en memoria para el MVP.
 *
 * Ensambla el MemoryLocalEngine y lo siembra (seed) con la cuenta demo,
 * los buzones y los correos de mock-data.ts. El engine es la única fuente
 * de verdad durable de la aplicación; Pinia solo refleja su contenido.
 *
 * Regla arquitectural: esta capa está en Application (src/app/). Solo puede
 * importar desde domain/ y adapters/. NUNCA importa desde components/.
 */

import { account, remoteAccountRef } from '../domain/account'
import { identity } from '../domain/identity'
import {
  jmapAccountIdFromString,
  jmapIdentityIdFromString,
  jmapMailboxIdFromString,
  scopedIdentityId,
  scopedMailboxId,
  serviceKeyFromString,
} from '../domain/ids'
import {
  createMemoryLocalEngine,
  type MemoryLocalEngine,
} from '../adapters/memory'
import {
  createMockEmailsByFolder,
  createMockMailboxes,
  DEMO_ACCOUNT_KEY,
} from './mock-data'
import {
  collectionSyncCursor,
  collectionSyncStateFromString,
} from '../domain/sync-cursor'

export { DEMO_ACCOUNT_KEY }

// ─── Constantes de la cuenta demo ────────────────────────────────────────────

const DEMO_SERVICE_KEY = serviceKeyFromString('local')
const DEMO_JMAP_ACCOUNT_ID = jmapAccountIdFromString('acc_juan')

export const DEMO_IDENTITY = identity({
  id: scopedIdentityId(
    DEMO_ACCOUNT_KEY,
    jmapIdentityIdFromString('identity_juan'),
  ),
  name: 'Juan Fernando',
  email: 'juan@correo.local',
  replyTo: null,
  bcc: null,
})

// ─── Seed del engine ──────────────────────────────────────────────────────────

async function seedEngine(engine: MemoryLocalEngine): Promise<void> {
  const { syncPort } = engine

  // 1. Registrar la cuenta demo
  const demoAccount = account(
    DEMO_ACCOUNT_KEY,
    remoteAccountRef(DEMO_SERVICE_KEY, DEMO_JMAP_ACCOUNT_ID),
  )
  await syncPort.registerAccount(demoAccount)

  // 2. Registrar la identidad de envío
  await syncPort.applyCollectionSync({
    kind: 'identity',
    mode: 'replace',
    expectedCursor: { kind: 'absent' },
    nextCursor: collectionSyncCursor({
      accountKey: DEMO_ACCOUNT_KEY,
      dataType: 'identity',
      state: collectionSyncStateFromString('v0'),
    }),
    snapshot: [DEMO_IDENTITY],
  })

  // 3. Registrar los buzones
  const mailboxes = createMockMailboxes()
  await syncPort.applyCollectionSync({
    kind: 'mailbox',
    mode: 'replace',
    expectedCursor: { kind: 'absent' },
    nextCursor: collectionSyncCursor({
      accountKey: DEMO_ACCOUNT_KEY,
      dataType: 'mailbox',
      state: collectionSyncStateFromString('v0'),
    }),
    snapshot: mailboxes,
  })

  // 4. Registrar todos los correos de todos los buzones
  const emailsByFolder = createMockEmailsByFolder()
  const allEmails = Object.entries(emailsByFolder).flatMap(
    ([folderId, emails]) =>
      emails.map((email) => ({
        email,
        memberships: [
          {
            emailId: email.id,
            mailboxId: scopedMailboxId(
              DEMO_ACCOUNT_KEY,
              jmapMailboxIdFromString(folderId),
            ),
          },
        ],
      })),
  )

  await syncPort.applyCollectionSync({
    kind: 'email',
    mode: 'replace',
    expectedCursor: { kind: 'absent' },
    nextCursor: collectionSyncCursor({
      accountKey: DEMO_ACCOUNT_KEY,
      dataType: 'email',
      state: collectionSyncStateFromString('v0'),
    }),
    snapshot: allEmails,
  })
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _engine: MemoryLocalEngine | null = null
let _ready: Promise<MemoryLocalEngine> | null = null

/**
 * Retorna el engine singleton listo para usar.
 * La primera llamada lo inicializa y siembra los datos; las siguientes
 * devuelven la misma instancia.
 */
export function getEngine(): Promise<MemoryLocalEngine> {
  if (_ready !== null) return _ready

  _ready = (async () => {
    const engine = createMemoryLocalEngine()
    await seedEngine(engine)
    _engine = engine
    return engine
  })()

  return _ready
}

/**
 * Devuelve el engine ya inicializado de forma síncrona.
 * Lanza si el engine aún no ha sido inicializado.
 * Útil en contextos donde ya se garantizó el await del setup.
 */
export function getEngineSync(): MemoryLocalEngine {
  if (_engine === null) {
    throw new Error(
      'Engine no inicializado. Llama await getEngine() primero desde App.vue.',
    )
  }
  return _engine
}
