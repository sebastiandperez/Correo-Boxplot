# ADR-010 — Orquestación protocol-neutral de RemoteApplication

**Status:** ACCEPTED

## Context

ADR-008 congeló `RemoteConnection`, `RemoteSession`, `RemoteMail` y
`Submission`; ADR-009 añadió el primer backend nativo. Faltaba una capa de
Application que poseyera el lifecycle remoto, ligara de forma segura la
identidad local con la cuenta remota y ejecutara refresh sin entregar sesiones
o datos remotos a Pinia.

El `Account` local conserva el vocabulario histórico `JmapAccountId`. El puente
opaco de `src/remote/compat/` permite usarlo con `RemoteAccountId` sin interpretar
su texto ni reabrir Domain, Ports, IPC o persistencia.

## Decision

- `RemoteApplication` es una orquestación protocol-neutral. Posee lifecycle de
  sesiones, binding de cuenta, estado remoto scoped por `AccountKey`,
  suscripciones a ese estado y ejecución de refresh.
- El core recibe una `RemoteConnectionFactory`; no selecciona provider, no
  importa protocolos concretos y no ejecuta networking o IPC directamente.
- Una cuenta local nueva se registra únicamente cuando la sesión expone
  exactamente un `RemoteAccountDescriptor`. Cero o múltiples cuentas requieren
  selección explícita futura.
- Un `Account` existente debe coincidir exactamente en `ServiceKey` y
  `RemoteAccountId`. Nunca se reescribe ni se hace rebind silencioso.
- El registro en memoria guarda solo `AccountKey`, `RemoteAccountId`,
  `RemoteSession`, `Coordinator` y una generación de lifecycle. Password, token
  y `RemoteConnectionConfig` no se retienen.
- `connect()` autentica, verifica/registra el binding y activa la sesión; no
  sincroniza. `refreshAccount()` usa el `Coordinator` existente, que escribe
  únicamente mediante `SyncPort`. SQLCipher continúa siendo la fuente local de
  verdad.
- La disposición `keep`/`expire` de `RemoteError` gobierna la validez de sesión.
  Generaciones por cuenta impiden que resultados tardíos de connect o refresh
  resuciten sesiones o status después de disconnect/dispose.
- `RemoteApplication` no posee Outbox, envío, materialización de body, E2EE,
  estado Pinia ni datos visibles de correo.
- La primera composición productiva soporta IMAP/SMTP mediante
  `ImapSmtpRemoteConnection` y `TauriNativeMailIpc`. Su construcción no abre red.
- JMAP conserva explícitamente el lifecycle productivo del Worker hasta una
  migración separada; `RemoteApplication` no hace fallback silencioso al Worker.
- Una reconexión real requiere un nuevo `connect()` con credenciales. No existe
  `reconnect()` sin configuración.

## Consequences

- Application puede representar por cuenta auth, conectividad y último error
  sin convertir Pinia en autoridad de sesión.
- Accounts diferentes pueden coexistir; operaciones lifecycle de connect para
  la misma cuenta se serializan con error `busy`.
- Disconnect elimina autoridad antes de cerrar la sesión. Una operación local
  ya iniciada puede completar, pero no puede reactivar la sesión ni publicar un
  status remoto tardío.
- El Worker JMAP, Coordinator, Outbox, Domain, Ports y los inventarios IPC
  permanecen congelados.

## Deferred

- Verificación adversarial independiente de `RemoteApplication`.
- Migración del lifecycle JMAP desde el Worker.
- Integración de AccountSetup, routing inicial, UI de status y botón Refresh.
- Materialización de body/E2EE, ejecución de Outbox y reconciliación SMTP.
- Selección explícita cuando una sesión expone varias cuentas remotas.
