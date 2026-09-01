Epic	ID	Pri.	Título	Descripción	Paths previstos	Dep.	SP	Criterios de aceptación	Tests a añadir
Protocol Spike	C-01	P0	Spike Stalwart / jmap-jam	Probar candidato contra Session, Mailbox, Email, changes, batching, submission y WS	src/jmap/spike/* o test dedicado	Stalwart dev	3	Decisión usar/no usar paquete documentada; ningún tipo externo se congela	Integration spike
Contract	C-02	P0	API propia JmapClient	Definir interfaz, tipos normalized y clasificación de errores	src/jmap/client.ts, types.ts, errors.ts	B-00B Domain frozen	3	No filtra tipos jmap-jam; apta para Coordinator/Outbox	Fake transport contract tests
Session	C-03	P0	Session discovery/capabilities	Obtener Session y validar accounts/capabilities/endpoints	src/jmap/session.ts, transport/http.ts	C-02	5	Session inválida falla tipadamente; capability missing detectable	Success/401/malformed/missing capability
Mail Read	C-04	P0	Mailbox + Email read APIs	Mailbox/get, Email/query, Email/get, changes/queryChanges y batching	src/jmap/mail/*	C-03	5	IDs/states normalizados; paginación/deltas correctos	fixtures RFC/Stalwart, hasMoreChanges
Body	C-05	P1	Normalización del contenido JMAP	Producir `EmailBody` solo desde contenido completo/no truncado y extraer metadata `AttachmentRef`	src/jmap/normalizers/*	C-04	3	No filtra MIME tree raw; respeta shapes D-09/D-10 y mantiene AttachmentRef separado	multipart HTML/text/attachment vectors
Remote Mutation	C-06	P1	Email patch + submission	Primitive propia para keywords/mailboxes y send sin adjuntos	src/jmap/mail/mutations.ts, submission.ts	C-03	5	Errores JMAP clasificados; sin persistencia local	accepted/rejected/stateMismatch/tooLarge
Push	C-07	P1	WebSocket StateChange — DEFERRED	El browser WebSocket no puede adjuntar Authorization; Recovery prohíbe credenciales en URL y mantiene push deshabilitado fail-closed	src/jmap/transport/websocket.ts	C-03	5	Reabrir solo con transporte autenticado interoperable; HTTP/manual sync siguen operativos	Security transport + Stalwart integration
Secret Lifecycle	C-08	P0	Token memory-only	Worker bootstrap recibe token, nunca lo expone/persiste/loguea y lo destruye	src/workers/*, src/jmap/*	C-03	3	Canario no aparece en storage/log; logout invalida client	token lifecycle tests

## REMOTE-INTEGRATION-RECOVERY-01

Recovery estabiliza la línea JMAP existente antes de diseñar la futura frontera protocol-neutral. No introduce IMAP, SMTP, `RemoteMail`, `Submission` ni ADR-008.

| ID | Estado | Resultado |
| --- | --- | --- |
| C2-R01 baseline | COMPLETE | Parte de `9776bfa` (A2-00/A2-01); Domain, Ports, Local Engine, IPC, SQLCipher y E2EE permanecen congelados. |
| C2-R02 session lifecycle | COMPLETE | Login fallido, expiración, logout y 401/403 eliminan la credencial memory-only y vuelven inutilizable el cliente previo. Los mensajes Worker no devuelven secretos ni errores remotos sin filtrar. |
| C2-R03 WebSocket safety | DEFERRED / FAIL-CLOSED | Se elimina todo token Bearer/Basic de URLs. El runtime productivo no inicia WebSocket hasta disponer de un handshake autenticado seguro; JMAP HTTP sigue habilitado. C-07 queda reabierto/deferred. |
| C2-R04 Coordinator correctness | COMPLETE | Account sync ordena Identity → Mailbox → Email → MailboxView; hard reset pagina exhaustivamente, usa estado Email/get real incluso vacío y no confirma snapshots parciales. |
| C2-R05 Outbox retry | COMPLETE | `pending` y `retrying` vencida pueden reclamarse; `retrying` futura se omite; `inFlight`, `confirmed` y `failedTerminal` nunca se reenvían automáticamente. |
| C2-R06 ambiguous send safety | COMPLETE | Una pérdida de transporte durante submission conserva `inFlight`, produce `needsReconciliation` y bloquea el reenvío ciego. La reconciliación remota completa continúa diferida. |
| C2-R07 Worker wiring | COMPLETE | `SYNC_ACCOUNT` espera la orquestación completa sobre el cliente autenticado real. El estado anónimo no usa `MockJmapClient`; Application obtiene el JMAP Account ID del `RemoteAccountRef` persistido. |
| C2-R08 cross-owner audit | NEEDS PERSONA B REVIEW | FTS5 permanece dentro del archivo SQLCipher y no cambia P-01/P-02, pero es una migración no consumida todavía por los Ports; Recovery no la modifica. |

### Recovery boundaries preserved

- Domain D-01→D-10 y Ports P-01/P-02/P-03: unchanged.
- Los 25 comandos IPC locales, schema SQLCipher, bootstrap/DEK y E2EE V1: unchanged.
- ADR-007 fue posteriormente **SUPERSEDED BY ADR-008** mediante REMOTE-BOUNDARY-01.

## REMOTE-BOUNDARY-01

**Estado: COMPLETE.** ADR-008 está ACCEPTED y `src/remote/` define IDs/estado
opacos, `RemoteError`, `RemoteConnection`/`RemoteSession`, `RemoteMail`,
`Submission`, `RemoteBody` y `SubmissionMessage`. `JmapRemoteMail` y
`JmapSubmission` reutilizan la implementación JMAP recuperada detrás de esa
frontera. Coordinator no importa JMAP; Outbox consume RemoteMail + Submission;
el Worker selecciona/compone el adapter una vez.

El puente `src/remote/compat/` concentra la conversión Remote* hacia el
vocabulario local `Jmap*` congelado. Domain, P-01/P-02/P-03, los 25 comandos
IPC, SQLCipher y E2EE no cambian. La implementación nativa se aborda en el
bloque posterior NATIVE-MAIL-PROTOCOLS-01.

## NATIVE-MAIL-PROTOCOLS-01

**Estado: COMPLETE.** ADR-009 implementa el primer backend no-JMAP sobre la
frontera congelada: `ImapRemoteMail` + `SmtpSubmission`, IPC nativo tipado y
red Rust separada del Local Engine. El flujo Alice/Bob se verifica contra
Servidor-Boxplot con snapshots completos, BODY.PEEK, Seen/Flagged, MOVE, HTML,
Bcc, metadata de attachments, límites y reinicio.

El MVP plaintext está limitado a loopback verificado antes de que salgan
credenciales. TLS externo, bridge Persona A, scheduler, reconciliación SMTP y
E2EE integrado permanecen en bloques posteriores. Coordinator, Outbox, Domain,
Ports, los 25 comandos `local_*`, persistencia y E2EE no cambian.

### NATIVE-MAIL-HARDENING-01

**Estado: COMPLETE.** La resolución loopback ocurre una sola vez por endpoint y
la conexión reutiliza exactamente un `SocketAddr` del conjunto validado. Los
snapshots IMAP comparan UID sets y status antes/después, y `syncEmails()` añade
una barrera de fingerprint account-wide con un único reintento acotado. Una
inestabilidad nunca publica un replace parcial.

Los `Debug` de request/sesión redactan el password. El password no se persiste y
los buffers credential-bearing explícitamente controlados por la aplicación se
zeroizan donde es práctico, sin afirmar borrado absoluto de temporales del
compilador o librerías. Contratos, Coordinator, Outbox e inventarios IPC siguen
congelados.

## REMOTE-APPLICATION-01

**Estado: FULLY FROZEN.** ADR-010 añade
`RemoteApplication` como lifecycle protocol-neutral por `AccountKey`. Connect
autentica y exige un binding exacto `ServiceKey + RemoteAccountId`; una cuenta
nueva solo se registra ante un único descriptor remoto. No hay rebind
silencioso, retención de credenciales ni sincronización implícita.

Refresh usa el `Coordinator` real y persiste exclusivamente mediante `SyncPort`.
Disconnect, dispose y generaciones por cuenta impiden que operaciones tardías
resuciten sesiones o status. La composición Tauri productiva habilita
IMAP/SMTP; JMAP conserva de forma explícita su Worker hasta una migración
separada. `REMOTE-APPLICATION-REVERIFY-AND-FREEZE-01` verificó la reparación
reentrante y cerró `RF01`–`RF70` sin P0/P1. Body y Mutation Execution fueron
posteriormente verificados y congelados por `PERSONA-C-FINAL-CLOSE-01`.

## BODY-MATERIALIZATION-E2EE-01

**Estado: IMPLEMENTED · VERIFIED · FROZEN.** `BodyMaterializer` conserva
`ownerAbsent`, `notCached` y `cached`, usa la misma sesión activa gobernada por
`RemoteApplication` y persiste exclusivamente un `EmailBody` completo mediante
`SyncPort.cacheEmailBody`. La capacidad remota es mínima, scoped por
`AccountKey` e invalida resultados tardíos tras disconnect, expiry o dispose;
no abre una segunda sesión ni retiene credenciales.

Los cuerpos E2EE V1 se parsean estrictamente y se descifran mediante el
`E2eePort` congelado. Sender, recipient, identidad local y subject esperados
proceden de `Email`/`Identity` committed, nunca del envelope. No hay auto-trust,
auto-provisioning de keys, sanitización de HTML ni cache de ciphertext en caso
de error. La composición productiva expone aditivamente
`RemoteApplication + BodyMaterializer` sin red o IPC E2EE al construirla. JMAP
por este lifecycle sigue diferido hasta migrar su Worker.
Un `RemoteError` de body con `session=keep` conserva la capacidad. Con
`session=expire`, la composición la invalida inmediatamente y falla cerrado
para operaciones futuras; no altera el estado privado del `RemoteApplication`
congelado, que conserva ownership del cierre físico en su lifecycle público.


## SEND-SECURITY-MODE-CONTRACT-01

**Estado: IMPLEMENTED · VERIFIED · FROZEN.** ADR-011 añade a cada `SendIntent`
un `securityMode` obligatorio con exactamente `plain` o `boxplotE2eeV1`. La
decisión viaja dentro de `SendMutation`, sobrevive IPC, SQLCipher y reinicio, y
forma parte del payload immutable que compara CAS. Ninguna clave, recipient,
dominio, trust o estado de red puede reinferirla.

El flujo de Composer actual declara `plain` explícitamente. Las filas
históricas sin campo migran a `plain` únicamente al decodificar persistencia;
valores desconocidos fallan como estado corrupto. El convertidor plaintext
rechaza `boxplotE2eeV1`, de modo que la ejecución posterior no puede degradar
una intención E2EE antes de implementar su executor dedicado.

## MUTATION-EXECUTION-RECONCILIATION-01

**Estado: IMPLEMENTED · VERIFIED · FROZEN.** El
`MutationRunner` productivo
lee la cola durable única, reclama `pending`/`retrying` mediante CAS antes del
efecto remoto y ejecuta Send plain/E2EE, Keyword y Membership usando la misma
capacidad de sesión account-scoped que `BodyMaterializer`. Retry es
determinista (5s, 15s, 60s, 5m), `MutationId` permanece como idempotency key y
un `inFlight` nunca se reproduce a ciegas tras crash o reinicio.

Plain y E2EE se seleccionan exclusivamente por `SendIntent.securityMode`; E2EE
usa `encryptSendIntent`, no hace auto-trust/auto-key y nunca degrada a
plaintext. `unavailable` programa retry determinista; `keyUnavailable`,
`peerKeyUnavailable` y los fallos criptográficos/metadata restantes terminan
la mutación para evitar loops que no pueden reparar trust o provisioning.
Keyword puede reconciliarse tras refresh autoritativo cuando el Email estable
demuestra el delta. ADR-012 acepta ahora `RemoteMutationReconciler` con evidencia
`applied + RemoteEmailId` o `inconclusive`, sin `notApplied` especulativo. Send
usa `MutationId` para rederivar el `Message-ID` SMTP exacto; 0 o múltiples
coincidencias quedan inconclusas y una sola confirma. MOVE ambiguo puede
permanecer `inFlight` indefinidamente cuando no existe identidad causal exacta;
no se reproduce ni se confirma por ausencia o heurística.

La superficie nativa expone diez comandos tras la extensión aprobada
`native_imap_find_message_id`, con 0/1/many, verificación exacta posterior al
SEARCH por substring y bounds fail-closed. El adapter usa el reconciler de la
misma sesión activa account-scoped; no abre otra conexión ni retiene
credenciales. El runner confirma únicamente con el `RemoteEmailId` real de una
coincidencia única; cero, múltiples o fallo de consulta conservan `inFlight` y
nunca reenvían SMTP ni MOVE a ciegas.

El runtime Tauri IMAP/SMTP compone solo `DefaultMutationRunner`. El Worker JMAP
conserva temporalmente solo el Outbox legado hasta su migración separada, por lo
que una cuenta/protocolo no tiene dos motores productivos simultáneos.

## PERSONA-C-FINAL-CLOSE-01

**Estado: COMPLETE · VERIFIED · FROZEN.** El cierre independiente verificó el
producto en `de4c526cdb1a1e7723d5bab117ccecdde2d76d14` sin P0/P1. Quedan
registrados los marcadores:

```text
BODY_MATERIALIZATION_FULLY_FROZEN
MUTATION_EXECUTION_RECONCILIATION_FULLY_FROZEN
PERSONA_C_FULLY_FROZEN
```

El freeze cubre Remote Boundary, Native Mail product contract,
RemoteApplication, Coordinator, Body Materialization, integración receive E2EE,
Send Security Mode, Mutation Execution, Mutation Reconciliation y el lifecycle
account-scoped de sesión/capabilities. Domain D-01→D-10, P-01/P-02/P-03, E2EE
V1, los 25 comandos `local_*` y los diez comandos `native_*` permanecen
inalterados.

Servidor-Boxplot se usa únicamente como harness mínimo de referencia para
pruebas IMAP/SMTP protocolarias y verticales. No es backend productivo,
componente de Persona C ni contrato congelado; el producto depende solamente de
IMAP/SMTP estándar.

`ALICE-BOB-E2E-01` queda omitido de los criterios de cierre de Persona C por
decisión del proyecto y no es un blocker pendiente.

### PERSONA A HANDOFF

Persona A puede asumir que SQLCipher es la fuente de verdad de UI;
`ReadRepository`, `SyncPort`, el lifecycle de `RemoteApplication`,
`BodyMaterializer`, `MutationRunner`, `SendIntent.securityMode`, los envíos plain
y E2EE, la reconciliación durable y el aislamiento por cuenta son estables. La
Presentación debe consumir Application y los read models locales; nunca estado
remoto directo.

Persona A no puede importar ni usar `RemoteSession`, `RemoteMail` o `Submission`
directamente desde Presentación; inferir el modo E2EE; custodiar private keys;
evitar `SyncPort`; escribir SQLCipher manualmente; inventar Emails de Sent;
redefinir el lifecycle de mutaciones; abrir sesiones IMAP separadas ni modificar
Domain/Ports congelados. Una necesidad incompatible requiere
`PERSONA_C_CONTRACT_REVIEW_REQUIRED` con evidencia concreta.

Puede continuar con Presentation, Composer UX, UI de cuenta/mailbox/list/detail,
body-open y send UX, feedback de mutaciones, selección explícita del modo E2EE,
trust manual ya contratado y estados loading/error/offline.

## SPRINT 2 

| ID                                       | Archivos principales                                                                                                | Tarea exacta                                                                                                                                                                                                                                            | Impacto / DONE                                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **C2-01 `REMOTE-RUNTIME-01`**            | **NEW** `src/remote/runtime/remote-session.ts`, `src/remote/runtime/remote-runtime.ts`, `src/remote/index.ts`       | Mantener la sesión remota autenticada en memoria y seleccionar `RemoteMail` + `Submission` según la cuenta configurada. Password/token solo memory-only. No Vue/Pinia.                                                                                  | Une el login de A con los adapters de C sin contaminar UI con IMAP/JMAP/SMTP.                                               |
| **C2-02 `COORDINATOR-CORE-01`**          | **NEW** `src/sync/coordinator.ts`, `src/sync/types.ts`                                                              | Crear Coordinator dependiente únicamente de `ReadRepository`, `SyncPort` y `RemoteMail`. Debe ser idéntico para JMAP e IMAP.                                                                                                                            | Es la pieza central de remoto → SQLCipher. Si necesita `if protocol === "imap"` en su lógica central, la abstracción falló. |
| **C2-03 `ACCOUNT-BOOTSTRAP-01`**         | **NEW** `src/sync/account-bootstrap.ts`, `src/sync/coordinator.ts`                                                  | Tras autenticación exitosa, registrar Account remoto e Identity mediante `SyncPort`. JMAP obtiene Identity remotamente; IMAP/Boxplot Local deriva Identity del usuario autenticado. Llamar también `E2eePort.ensureLocalIdentity()` para esa identidad. | Después del login aparece una cuenta local real y existe su keypair E2EE, sin fake account desde Vue.                       |
| **C2-04 `INITIAL-MAILBOX-SYNC-01`**      | **NEW** `src/sync/mailbox-sync.ts`, `src/sync/coordinator.ts`                                                       | JMAP: `Mailbox/get`. IMAP: `LIST` + información necesaria de mailbox. Normalizar INBOX/Sent/Trash y persistir por P-02.                                                                                                                                 | Hace que Sidebar de A provenga del servidor pasando siempre por SQLCipher.                                                  |
| **C2-05 `INITIAL-EMAIL-SYNC-01`**        | **NEW** `src/sync/email-sync.ts`, `src/sync/mailbox-view-sync.ts`                                                   | JMAP: query/get. IMAP: `SELECT → UID SEARCH → UID FETCH metadata`. Convertir a Domain Email + memberships + `MailboxView`; preservar orden remoto.                                                                                                      | Bob puede pulsar Refresh y ver el correo de Alice en la lista real de la aplicación.                                        |
| **C2-06 `IMAP-SYNC-STATE-01`**           | **NEW** `src/sync/imap-state.ts` o en adapter si corresponde, tests asociados                                       | Mantener `UIDVALIDITY`, UID/UIDNEXT y demás estado IMAP dentro del `CollectionSyncCursor.state` **opaco**. Si cambia UIDVALIDITY, invalidar/reconstruir ese mailbox. No QRESYNC/MODSEQ/CONDSTORE.                                                       | Permite refresh incremental razonable sin contaminar Domain con conceptos IMAP.                                             |
| **C2-07 `REFRESH-SYNC-01`**              | `src/sync/coordinator.ts`, **NEW** `src/sync/refresh.ts`                                                            | Implementar el caso de uso que consumirá el botón **Actualizar** de A. JMAP usa changes/queryChanges; IMAP usa el mecanismo mínimo de UID. Al terminar, solo escribe con SyncPort; A recibe P-03 y relee.                                               | Nuestro servidor no tiene IDLE, así que esta tarea es la que permite recibir correo durante la demo.                        |
| **C2-08 `BODY-MATERIALIZATION-E2EE-01` · FROZEN** | `src/sync/body-materializer.ts`, `src/remote/mime/boxplot-e2ee.ts`, composición aditiva `src/app/remote/` | Ante `EmailBody = notCached`, usa la sesión activa, materializa plaintext o descifra E2EE con metadata committed y persiste solo mediante `cacheEmailBody`. | Implementado, verificado y congelado con cache local autoritativa, invalidación account-scoped y cero auto-trust/auto-key. |
| **C2-09 `OUTBOX-RUNNER-01`**             | **NEW** `src/outbox/outbox-runner.ts`, `src/outbox/types.ts`                                                        | Leer `listPendingMutations()`, despachar `SendMutation`, `KeywordMutation` y `MailboxMembershipMutation`, aplicar lifecycle ya definido por B y soportar retry.                                                                                         | Convierte la cola durable que ya existe en acciones remotas reales.                                                         |
| **C2-10 `E2EE-SEND-01`**                 | **NEW** `src/outbox/send-executor.ts`, `src/remote/mime/boxplot-e2ee.ts`, consumir `src/e2ee/send-intent.ts`        | Para envío E2EE V1: validar destinatario único → `encryptSendIntent()` / `E2eePort` → `BoxplotE2eeEnvelope` → MIME `application/vnd.boxplot.e2ee+json` → `SmtpSubmission`. Confirmar solo tras aceptación remota.                                       | Alice puede escribir plaintext, pero SMTP/Servidor-Boxplot reciben ciphertext. Este es el corazón de la demo E2EE.          |
| **C2-11 `KEYWORD-EXECUTOR-01`**          | **NEW** `src/outbox/keyword-executor.ts`                                                                            | Ejecutar `KeywordMutation`. JMAP → keyword patch; IMAP → `UID STORE ±FLAGS (\Seen/\Flagged)`. Tras éxito, avanzar/remover PendingMutation mediante P-02 existente.                                                                                      | Seen y Flagged dejan de ser únicamente cambios optimistas locales y sobreviven a una resincronización.                      |
| **C2-12 `MEMBERSHIP-EXECUTOR-01`**       | **NEW** `src/outbox/membership-executor.ts`                                                                         | Ejecutar `MailboxMembershipMutation`. JMAP → mailboxIds; IMAP → `UID MOVE`. Reconciliar después mediante sync; no asumir que UID destino == UID origen.                                                                                                 | “Eliminar”/mover a Trash funciona realmente en Servidor-Boxplot.                                                            |
| **C2-13 `RETRY-RECONCILIATION-01`**      | `src/outbox/outbox-runner.ts`, **NEW** `src/outbox/retry.ts`, tests                                                 | Servidor apagado no puede perder Send/Seen/Move. Mantener mutación pendiente, distinguir retryable vs terminal y reintentar cuando vuelva conectividad. No crear segunda cola.                                                                          | Demuestra la propiedad local-first: la acción se conserva aunque falle la red.                                              |
| **C2-14 `E2EE-TRUST-PREFLIGHT-01`**      | **NEW** `scripts/prepare-local-e2ee-demo.*` o documentación en `docs/development/`, consumir únicamente APIs B      | Preparar la ceremonia manual: generar/leer PK Alice/Bob y establecer confianza cruzada. Nunca auto-trust del `senderPublicKey` incluido en el mensaje.                                                                                                  | Permite ejecutar la demo sin implementar todavía discovery, PKI, QR o UI de fingerprints.                                   |
| **C2-15 `LOCAL-ALICE-BOB-E2E-01` · OMITTED** | Sin implementación requerida por este cierre | Omitido de los criterios de cierre de Persona C por decisión del proyecto. | No es blocker ni trabajo pendiente del freeze. |
| **C2-16 `JMAP-REGRESSION-01`**           | tests bajo `src/jmap/__tests__/` y tests de Coordinator                                                             | Ejecutar Coordinator con `JmapAdapter` para demostrar que introducir IMAP/SMTP no volvió la capa de sincronización protocol-specific. E2EE sobre JMAP no tiene que ampliarse si exige nuevo transporte MIME no necesario para la demo.                  | Mantiene JMAP como protocolo serio del producto sin sobreconstruir el MVP local.                                            |
