# Bloque mínimo de componentes del cliente

## 1. Alcance y reglas de dependencia

Este bloque sostiene cuatro recorridos: recibir cambios, abrir un correo, redactar y encolar un envío, y reconciliar SQLite con el servidor. El MVP actual se acepta únicamente en **Tauri v2**. Web/PWA conserva su lugar como adaptador futuro, pero OPFS, wa-sqlite, `SharedWorker`, multi-tab y credenciales Web están fuera del camino crítico actual.

Este documento define responsabilidades de componentes. Las reglas normativas sobre ubicación, imports y dirección de dependencias viven en [layers.md](layers.md).

La regla central es local-first: Vue y Pinia solo obtienen correo mediante `ReadRepository`, que consulta estado local committed. Las futuras solicitudes de materialización remota pertenecen a orquestación Application → Coordinator; los datos se vuelven observables después del commit y de una invalidación de `LocalChangeSource` P-03.

La frontera local se divide en `ReadRepository`, compartido por Application, Coordinator y Outbox para lecturas, `SyncPort`, consumido por sus casos de escritura semántica, y `LocalChangeSource`, consumido por Application para invalidar proyecciones después de commits. Coordinator y Outbox corren en el Worker pero dependen de la frontera protocol-neutral de ADR-008. Solo el adapter JMAP habla JMAP directo mediante `fetch` y WebSocket; toda persistencia cruza exclusivamente por `SyncPort`.

El ciclo local y el remoto son independientes. `LocalReady + RemoteAnonymous` es válido: la DEK del SQLite local procede del secure store del sistema operativo, mientras el token JMAP solo vive en memoria del Worker. Passkey/WebAuthn autentica al servidor y no deriva la clave SQLCipher.

Las actualizaciones firmadas siguen siendo una defensa obligatoria, pero no se añaden como noveno componente porque no participan en estos cuatro recorridos.

## 2. Presentación segura (Vue 3)

El shell visual desktop de tres columnas ya está materializado en `src/components/`. Es estructura estática únicamente: la lógica de Application, Pinia, Repository y JMAP todavía no está implementada en estos componentes.

* **Responsabilidad:** Renderizar lista, lector y compositor con Vue 3 Composition API; capturar intenciones; presentar estados locales, remotos y de conectividad; sanitizar el HTML crudo con DOMPurify en cada render y mostrarlo en un contexto `iframe sandbox` aislado bajo CSP restrictiva.
* **Qué NO hace:** No ejecuta SQL, no llama JMAP, no usa `fetch` para obtener correo, no recibe HTML como confiable, no navega el webview principal desde enlaces de un correo y no conserva secretos. No descarga, guarda, sube ni envía adjuntos en el MVP.
* **Dependencias:** Stores de Pinia, DOMPurify, política de sanitización, sandbox de render y CSP de Tauri.
* **Consumidores:** Usuario final.
* **Datos de entrada:** Proyecciones reactivas, estados `runtime`, `Email`, `EmailBody` cuando esté cacheado y metadata `AttachmentRef` cuando esté disponible, siempre leídos desde `ReadRepository` a través de Pinia. La ausencia de `EmailBody` no equivale a cuerpo vacío; la disponibilidad de la colección de attachments se definirá en el futuro contrato de lectura/cache sin añadir flags al value object.
* **Datos de salida:** Intenciones de selección, lectura, cambio de keywords/mailboxes, edición del compositor, confirmación de descarte y encolado de envío.
* **Estado:** Solo estado visual de vida corta. El HTML sanitizado preparado para un render no es una copia durable.
* **Persistencia:** Ninguna. No usa `localStorage`; no persiste drafts ni HTML sanitizado.
* **Networking:** Ninguno. Los recursos remotos del correo están bloqueados por defecto y los enlaces `http`/`https` se abren mediante código controlado.

---

## 3. Estado de aplicación (Pinia)

* **Responsabilidad:** Mantener estado efímero de Application, selección y proyecciones visibles; coordinar lecturas locales; conservar el compositor temporal; releer `ReadRepository` cuando reciba invalidaciones de `LocalChangeSource`.
* **Qué NO hace:** No es fuente durable, no persiste stores, no importa JMAP, no interpreta respuestas remotas y no duplica `CollectionSyncCursor` ni `PendingMutation` como autoridad propia.
* **Dependencias:** `ReadRepository`; futuros casos de escritura consumen `SyncPort` y las invalidaciones consumen `LocalChangeSource` P-03.
* **Consumidores:** Componentes y composables Vue.
* **Datos de entrada:** Intenciones de UI, resultados locales de `ReadRepository` y futuras invalidaciones post-commit.
* **Datos de salida:** Estado reactivo para Vue, consultas a `ReadRepository` e intenciones semánticas de escritura/orquestación.
* **Estado:** Tres stores mínimos: `runtime` con `local: opening | ready | error`, `auth: anonymous | authenticating | authenticated | expired`, `connectivity: online | offline`; `mail` con cuenta/mailbox/email seleccionados, página visible y `loadState: idle | loading | ready | error`; `composer` con campos en edición y `phase: idle | editing | queueing | error`. Estados de sync y Outbox se proyectan desde SQLite.
* **Persistencia:** Ninguna. El draft es **memory only**: sin tabla, autosave ni JMAP Draft sync. El compositor se limpia únicamente después de persistir con éxito la `PendingMutation`; si falla, conserva todo el contenido. Un cierre o crash previo a Enviar puede perder la redacción y es una limitación explícita del MVP.
* **Networking:** Ninguno.

---

## 4. Ports locales (`ReadRepository`, `SyncPort`, `LocalChangeSource`)

* **Responsabilidad:** Separar tres conversaciones sin exponer el motor. `ReadRepository` P-01 ofrece únicamente consultas sobre estado local committed. `SyncPort` P-02 expresa transiciones semánticas atómicas. `LocalChangeSource` P-03 entrega invalidaciones post-commit no durables para provocar relecturas. P-01, P-02 y P-03 están cerrados individualmente; Ports como fase todavía requiere conformance runtime y audit final.
* **Semántica P-01:** `LocalEntityRead` distingue entidad local ausente/presente; `OwnedSnapshotRead` distingue owner ausente de snapshot presente, incluso vacío; `OwnedOptionalRead` añade ausencia conocida del valor owned; `OwnedCacheRead` distingue `ownerAbsent`, `notCached` y `cached`. Para `EmailBody`, `AttachmentRef[]` y `MailboxView`, `notCached` no equivale a `cached`; en attachments, `cached []` es una caché completa vacía. D-06 continúa gobernando la cobertura parcial de `MailboxView`.
* **Semántica P-02:** cada método confirma una transición completa o no hace visible ningún estado parcial. Sus diez capacidades exactas son `registerAccount`, `applyCollectionSync`, `cacheEmailBody`, `replaceAttachmentRefs`, `replaceMailboxView`, `stageSendMutation`, `applyOptimisticKeywordMutation`, `applyOptimisticMailboxMembershipMutation`, `replacePendingMutationIfCurrent` y `removeConfirmedMutation`.
* **Semántica P-03:** `LocalChangeSource` posee una única capacidad `subscribe(listener)`. Un batch contiene uno o más hints semánticos de las familias `accounts`, `mailboxes`, `identities`, `emails`, `emailMemberships`, `emailBody`, `attachmentRefs`, `mailboxView`, `syncCursor` y `pendingMutations`. Es una unidad de entrega, no una transacción, identidad de commit ni entrada de log, y puede cubrir uno o varios commits. Los hints contienen solo la clave Domain mínima del scope invalidado: nunca transportan Email, body, addresses, filenames, mutation payloads, valores previos/nuevos, revisión, secuencia, origen ni timestamp.
* **Entrega P-03:** una suscripción exitosa ya está activa cuando `subscribe` resuelve y pueden coexistir varias subscriptions independientes sin reemplazarse. Mientras estén activas y operativas, los cambios observables relevantes quedan cubiertos eventualmente; pueden agruparse o duplicarse y no hay replay, exactly-once ni orden de negocio. Un no-op puro exitoso puede omitir el hint o emitir uno conservador. Un write fallido, revertido o en conflicto no produce hint. La entrega ocurre después del commit y su fallo nunca revierte ese commit. Una relectura inmediata observa ese estado ya committed o uno posterior, no un snapshot exacto del commit. El listener es síncrono, solo invalida/agenda y no introduce backpressure. Una excepción de un listener no afecta a las demás subscriptions ni a la autoridad local. `unsubscribe` es idempotente, no lanza y, al retornar, impide que comiencen nuevas invocaciones del listener.
* **Inicialización P-03:** Application debe ejecutar `subscribe → read current state → render`, también al reanudar o reconectar el change source. `read → subscribe` está prohibido porque perdería un commit ocurrido entre ambas operaciones. P-03 no conserva un log durable ni reproduce cambios anteriores a la suscripción, ocurridos sin suscripción, durante restart ni posteriores a `unsubscribe`.
* **Collection sync:** Coordinator normaliza JMAP en uno de seis commits cerrados: Email/Mailbox/Identity × delta/replace. `applyCollectionSync` requiere que `nextCursor.accountKey` identifique una Account local existente al commit, valida el cursor esperado por igualdad exacta, aplica cambios y nuevo `CollectionSyncCursor` en un commit, trata state como opaco y nunca modifica `MailboxView` implícitamente. Owner ausente produce `conflict`, sin cambios, cursor ni hint. `cannotCalculateChanges` y `hasMoreChanges` siguen en Coordinator; un refetch completo produce mode `replace`.
* **Escrituras locales:** Send persiste únicamente `SendMutation`; no crea Email optimista. Keyword y membership aplican el delta sobre el snapshot committed y persisten la `PendingMutation` exacta atómicamente. El resultado de membership no puede quedar vacío. Outbox cambia lifecycle mediante CAS contra el snapshot durable completo: `expected` stale por cualquier diferencia de kind, target o payload produce `conflict`, y `next` conserva identidad y contenido inmutable mientras realiza solo una transición D-08 válida. `inFlight` se conserva después de crash y solo se eliminan mutaciones actualmente `confirmed`.
* **Errores de escritura:** `conflict` expresa una precondición semántica del command que no coincide con el estado committed. `corruptState` se reserva para estado ya persistido que no puede rehidratarse como Domain válido o viola una invariante durable. `unavailable` significa que el Local Engine no puede prestar el servicio; no clasifica input inválido del command.
* **Qué NO hace:** Ningún port expone SQL, tablas, `invoke()`, rutas de archivo ni DTOs JMAP. `ReadRepository` no escribe, agenda, hace red ni notifica. `SyncPort` no absorbe solicitudes `ensure…`; esas intenciones pertenecen a futura orquestación Application → Coordinator. `LocalChangeSource` no es fuente de verdad, no lee, no publica mediante API pública, no filtra suscripciones y no sustituye una relectura.
* **Dependencias:** Tipos del dominio y errores propios del contrato. En el MVP, adaptadores TypeScript Tauri satisfacen estos contratos y cruzan por IPC hacia el Motor Rust.
* **Consumidores:** Application, Coordinator y Outbox pueden leer mediante `ReadRepository`; los casos de escritura de Application, Coordinator y Outbox usan `SyncPort`. Application consume `LocalChangeSource` para invalidar y releer.
* **Datos de entrada:** IDs y specs Domain para lectura; transiciones Domain completas y normalizadas para escritura.
* **Datos de salida:** `ReadResult` para consultas y `WriteResult` para commits. P-02 usa únicamente `unavailable | corruptState | conflict | unexpected`; P-03 devuelve únicamente `unavailable | unexpected`, sin payload de error, y después entrega invalidaciones por listener.
* **Estado:** Los contratos no poseen autoridad de dominio ni mantienen trabajo remoto en vuelo.
* **Persistencia:** Ninguna por sí misma. Sus futuras implementaciones deben preservar `cambio optimista + PendingMutation` y `cambios remotos + nuevo collection state` como transacciones atómicas. El éxito solo se devuelve después del commit.
* **Networking:** Ninguno. La arquitectura congelada de suites y harness vive en [port-contract-testing.md](../testing/port-contract-testing.md). Esas suites se implementan antes del primer `MemoryLocalEngine` y se reutilizan después contra Tauri; Motor Web se añadirá en su iteración futura.

Los flujos contractuales quedan separados:

```text
JMAP → Coordinator → normalization → CollectionSyncCommit
     → SyncPort.applyCollectionSync → Local Engine

Application → Domain PendingMutation → SyncPort optimistic operation
            → atomic projection + mutation → committed success
            → ReadRepository observes committed state

Read PendingMutation → D-08 lifecycle transition
                     → replacePendingMutationIfCurrent(expected, next)
                     → remote attempt
crash with inFlight → preserve → reconcile; never blind reset

SyncPort operation → commit → LocalChangeSource
                   → Application invalidates → ReadRepository re-read
```

`registerAccount` permite éxito idempotente para el mismo `AccountKey` y `RemoteAccountRef`, pero un binding distinto produce `conflict`: P-02 no permite rebind silencioso. `cacheEmailBody`, `replaceAttachmentRefs` y `replaceMailboxView` escriben snapshots completos; attachments acepta `[]` como caché completa vacía y `queryState` nunca se ordena. El futuro motor valida owners, scopes y unicidad dentro del mismo commit.

La cobertura mínima P-02 → P-03 para operaciones exitosas que cambian estado observable es semántica, no un conteo de eventos:

| Commit P-02 exitoso | Hints P-03 que deben cubrir el cambio |
| --- | --- |
| `registerAccount` | `accounts` |
| `applyCollectionSync` de Email | `emails(account)`, `emailMemberships(account)`, `syncCursor(account, email)` |
| `applyCollectionSync` de Mailbox | `mailboxes(account)`, `syncCursor(account, mailbox)` |
| `applyCollectionSync` de Identity | `identities(account)`, `syncCursor(account, identity)` |
| `cacheEmailBody` | `emailBody(email)` |
| `replaceAttachmentRefs` | `attachmentRefs(email)` |
| `replaceMailboxView` | `mailboxView(spec)` |
| `stageSendMutation` | `pendingMutations(account)` |
| `applyOptimisticKeywordMutation` | `emails(account)`, `pendingMutations(account)` |
| `applyOptimisticMailboxMembershipMutation` | `emailMemberships(account)`, `pendingMutations(account)` |
| `replacePendingMutationIfCurrent` | `pendingMutations(account)` |
| `removeConfirmedMutation` | `pendingMutations(account)` |

`emails(account)` también invalida lecturas cuya validez depende del owner Email, incluidas memberships, body y refs que puedan pasar a `ownerAbsent`; `mailboxes(account)` hace lo propio con la validez del owner de una `MailboxView`. Un adapter puede coalescer estos efectos en menos entregas o repetir hints sin alterar la obligación de cobertura.

Un success que sea un no-op puro puede no emitir hint o emitir invalidación conservadora. Las suites de contrato verifican cobertura como subset semántico y nunca exigen un conteo u orden exactos. Las aclaraciones normativas y los escenarios ejecutables requeridos están congelados en [port-contract-testing.md](../testing/port-contract-testing.md).

---

## 5. Motor Tauri/Rust

* **Responsabilidad:** Implementar en Rust la semántica y persistencia que los adaptadores TypeScript exponen mediante `ReadRepository` y `SyncPort`; ejecutar consultas, transacciones y migraciones sobre SQLite nativo + SQLCipher; generar/recuperar la DEK aleatoria de 32 bytes mediante el secure store del sistema operativo; exponer comandos `invoke()` explícitos y validados; emitir cambios mediante eventos Tauri. Rust no implementa literalmente interfaces TypeScript: IPC conecta ambas fronteras.
* **Qué NO hace:** No renderiza, no aloja Cliente JMAP/Coordinador/Outbox, no retransmite `fetch`/WebSocket, no expone SQL, shell, filesystem ni secure store genéricos, no usa WASM/OPFS y no recibe la DEK desde TypeScript.
* **Dependencias:** Backend Rust, SQLite nativo, SQLCipher, secure store del SO, Tauri v2 Capabilities System default-deny e Isolation Pattern.
* **Consumidores:** Adaptadores Tauri de `ReadRepository`/`SyncPort`; el Worker TypeScript consume el segundo a través de `TauriSyncPort`, que concentra `invoke()`.
* **Datos de entrada:** Consultas y comandos semánticos validados, lotes normalizados y transiciones de mutaciones. La autenticación remota no entrega la clave local.
* **Datos de salida:** Resultados locales tipados, comprobantes atómicos, pendientes/cursores y eventos de cambio.
* **Estado:** Handle SQLCipher abierto, transacciones y suscripciones de eventos. La proyección local distingue apertura correcta de `encryption_locked` y demás errores. El modelo exacto de tareas/hilos internos se decide durante la implementación del motor.
* **Persistencia:** Base siempre cifrada. Primera ejecución crea una DEK y DB; reinicios recuperan la DEK. Si el secreto falta, falla cerrado. El reset de caché requiere aprobación y puede perder `PendingMutation`. El schema físico inicial ya está adoptado en `src-tauri/src/db/migrations/0001_initial.sql`; migration runner, queries, repositories, ubicación e inicialización runtime siguen pendientes de la fase del motor.
* **Networking:** Ninguno para correo. Tauri usa la política `backgroundThrottling: "throttle"`; el riesgo acotado de throttling del Worker es aceptado.

---

## 5A. Red nativa IMAP/SMTP — MVP loopback (ADR-008, ADR-009)

* **Responsabilidad:** Implementar transporte nativo para adapters IMAP (`RemoteMail`) y SMTP (`Submission`). IMAP no envía correo.
* **Qué NO hace:** No traduce a JMAP, no actúa como proxy genérico, no adquiere `EngineLease` y no conoce Ports locales, SQLite o SQLCipher.
* **Estado:** implementada por NATIVE-MAIL-PROTOCOLS-01 para loopback verificado. `ImapRemoteMail` y `SmtpSubmission` usan nueve comandos IPC `native_*` hacia `src-tauri/src/net/`.
* **Seguridad:** credenciales memory-only; plaintext únicamente después de verificar loopback. TLS externo permanece diferido.

---

## 6. Motor Web/PWA — diferido

* **Responsabilidad:** En una iteración futura, implementar `ReadRepository`, `SyncPort` y `LocalChangeSource` sobre `wa-sqlite`/OPFS dentro de `SharedWorker` y notificar por `BroadcastChannel`.
* **Qué NO hace:** No forma parte del MVP Tauri, de Gate 0-C actual ni de sus criterios de aceptación. No se considera descartado.
* **Dependencias:** **DEFERRED:** OPFS, wa-sqlite, estrategia de cifrado Web, custodia de credenciales, multi-tab y `SharedWorker`.
* **Consumidores:** Futuros adaptadores Web de los tres Ports locales.
* **Datos de entrada:** Los mismos contratos lógicos cuando se implemente.
* **Datos de salida:** Resultados observables conformes a la suite compartida futura.
* **Estado:** **MOVED TO FUTURE WEB ITERATION.**
* **Persistencia:** No diseñada ni validada para el MVP actual. Sigue prohibido aceptar texto plano como fallback cuando se retome.
* **Networking:** La topología prevista conserva Cliente JMAP/Coordinador/Outbox TypeScript en `SharedWorker`, pero su operación se valida en la iteración Web futura.

---

## 7. Coordinador de sincronización

* **Responsabilidad:** Mantener SQLite al día en background; leer `CollectionSyncCursor`, pedir transiciones completas a `RemoteMail`, mapear Remote→Domain mediante el compatibility bridge, aplicar lotes por `SyncPort` y avanzar cada collection state atómicamente.
* **Qué NO hace:** No participa en la lectura de primer plano, no conoce DTOs, errores, paginación o métodos JMAP/IMAP y no contiene ramas por protocolo.
* **Dependencias:** `RemoteMail`, `SyncPort`, `ReadRepository` y sesión remota autenticada.
* **Consumidores:** Worker TypeScript Tauri; un futuro `SharedWorker` reutilizará la implementación.
* **Datos de entrada:** `CollectionSyncCursor`, ViewSpecs con su `queryState`, solicitudes `ensure…`, eventos de conectividad/sesión y push.
* **Datos de salida:** Lotes Domain normalizados, nuevos collection states, cambios de `MailboxView` y señales locales indirectas.
* **Estado:** Coordinación y deduplicación en vuelo. `CollectionSyncCursor` contiene solo el checkpoint `AccountKey + DataType + opaque state`; `queryState` pertenece a la ViewSpec exacta. Status, lastError y timestamps son diagnóstico operacional separado cuya forma definitiva todavía no se diseña.
* **Persistencia:** Solo por `SyncPort`; datos remotos y nuevo collection state se confirman atómicamente.
* **Networking:** Solo mediante `RemoteMail`. El adapter concreto resuelve paging, invalidación de state y replace exhaustivo; Coordinator trata state como opaco.

---

## 8. Procesador de Pending Mutations (Outbox)

* **Responsabilidad:** Tomar la familia discriminada de intenciones durables, convertir Send a `SubmissionMessage`, usar `Submission` para envío y `RemoteMail` para mutaciones remotas de correo, y registrar confirmación o fallo terminal.
* **Qué NO hace:** No crea un Email falso, no conoce `JmapEmailDraft`, EmailSubmission, IMAP o SMTP y no reintenta a ciegas outcomes ambiguos.
* **Dependencias:** `RemoteMail`, `Submission`, `SyncPort` y `ReadRepository`.
* **Consumidores:** Worker TypeScript y, por proyección local releída tras una invalidación P-03, Pinia.
* **Datos de entrada:** `PendingMutation` cifradas, identificadas por `AccountKey + MutationId`, conectividad y resultados remotos.
* **Datos de salida:** Operaciones remotas protocol-neutral, transiciones durables y solicitud de reconciliación.
* **Estado:** En vuelo y timers efímeros; el ciclo durable conserva `pending`, `inFlight`, `retrying`, `confirmed` y `failedTerminal`. `inFlight` puede significar que el request llegó al servidor pero el outcome remoto sigue sin resolverse.
* **Persistencia:** Solo mediante `SyncPort`. El encolado y cualquier cambio optimista son atómicos. `confirmed` puede permanecer durable hasta reconciliar la autoridad relevante; la política exacta de cleanup queda para Outbox.
* **Networking:** Solo mediante Remote Boundary. Una aceptación sin `RemoteEmailId` o un outcome desconocido conserva `inFlight` y produce `needsReconciliation`; MutationId se usa como idempotency key y nunca como Email ID.

---

## 9. Remote Boundary y adapter JMAP

* **Responsabilidad:** `RemoteMail` normaliza receive/sync/mutaciones; `Submission` normaliza envío. `JmapRemoteMail`, `JmapSubmission` y `JmapRemoteConnection` encapsulan `JmapClient`, sus DTOs, paging, state y errores. `RemoteConnection` selecciona protocolo únicamente en composición.
* **Qué NO hace:** El core remoto no ejecuta SQL, no produce UI, no descifra E2EE y no importa JMAP. `JmapClient` no cruza al Coordinator/Outbox.
* **Dependencias:** Core remoto: tipos protocol-neutral. Adapter JMAP: `JmapClient`, HTTPS/WebSocket, capacidades JMAP y token memory-only.
* **Consumidores:** Coordinator consume `RemoteMail`; Outbox consume `RemoteMail` + `Submission`; Worker compone la sesión.
* **Datos de entrada/salida:** `Remote*` IDs opacos, transiciones replace/delta completas, `RemoteBody`, `SubmissionMessage`, `SubmissionResult` y `RemoteError`.
* **Compatibilidad:** `src/remote/compat/` concentra Remote* ↔ nombres locales `Jmap*` congelados; no cambia Domain, IPC ni SQL.
* **Persistencia:** Ninguna directa. Correo, cursores y pendientes pasan por `SyncPort`.
* **Networking:** el adapter JMAP habla JMAP; los adapters IMAP/SMTP hablan solo con `NativeMailIpcPort`. Coordinator y Outbox siguen protocol-neutral.

## 10. Explicación del diagrama de componentes: abres la bandeja de entrada

Imagina que arrancas la aplicación sin conexión. Rust recupera la DEK del secure store y abre SQLCipher; aunque todavía estés `RemoteAnonymous`, la combinación `LocalReady + RemoteAnonymous` te permite entrar a la caché.

1. **Tú eliges Bandeja de entrada en Vue.** La presentación registra la intención y se la comunica a Pinia. No llama a la red.
2. **Pinia actualiza la selección.** El store pide la primera ventana mediante `ReadRepository` y marca la carga local, no una espera JMAP.
3. **`ReadRepository` cruza la frontera Tauri.** El adaptador usa un comando `invoke()` explícito; Rust consulta SQLite cifrado sin exponer SQL ni la DEK al webview.
4. **Ves inmediatamente lo disponible.** La `MailboxView` y sus `Email` vuelven a Pinia, que publica la proyección para Vue. Todo lo visible procede de SQLite, también offline.
5. **Completar la ventana no bloquea la pantalla.** Una futura intención de Application solicita materialización al Coordinator. La API exacta de esa orquestación sigue diferida y no forma parte de `ReadRepository` ni se traslada automáticamente a `SyncPort`.
6. **Cuando te autenticas, empieza el ciclo remoto.** El Passkey se ejecuta en el navegador del sistema. El token resultante entra solo en la memoria del Worker; no desbloquea la DB ni pasa por Pinia.
7. **El Worker habla JMAP directamente.** El Coordinador lee el cursor por `ReadRepository`; Cliente JMAP usa `fetch`/WebSocket contra el servidor. `StateChange` solo dispara la consulta incremental.
8. **Los cambios se vuelven locales antes de ser visibles.** El Worker normaliza la respuesta como `CollectionSyncCommit` y llama `SyncPort.applyCollectionSync`; el futuro `TauriSyncPort` concentrará `invoke()` y Rust confirmará datos y nuevo cursor en una transacción SQLCipher antes de emitir un evento Tauri.
9. **Pinia vuelve a leer.** Después del commit, `LocalChangeSource` emite una invalidación; Pinia repite la lectura y Vue actualiza la bandeja desde SQLite, nunca desde la respuesta de red.
10. **Al abrir un mensaje se repite la regla.** Si el cuerpo está `notCached`, Application puede solicitarlo al `BodyMaterializer`, que usa la sesión activa protocol-neutral y persiste mediante `SyncPort.cacheEmailBody`. El caller relee P-01: nunca recibe el body remoto directamente. Un `EmailBody` completo y normalizado conforme a D-09 se cifra en Rust y la invalidación post-commit provoca otra lectura; la ausencia previa del body nunca vuelve incompleto al Email de metadata y ambos `text`/`html` null siguen siendo un resultado completo válido. HTML permanece raw/untrusted hasta el boundary de render.
11. **El HTML se trata como hostil.** Vue sanitiza el raw en cada render, elimina contenido activo y remoto y lo muestra dentro del sandbox bajo CSP; no persiste el resultado sanitizado.
12. **Si redactas, el contenido vive solo en memoria hasta Enviar.** Al pulsar Send, Application valida Composer, resuelve los defaults de Identity y congela un `SendIntent`; `SyncPort.stageSendMutation` persiste la `SendMutation` antes de limpiar Composer. Si falla, conserva la edición. Outbox no relee defaults ni fabrica un Email; el mensaje autoritativo aparece tras la reconciliación JMAP.

## 11. Extensiones futuras fuera de alcance

Web/PWA se retoma en una iteración posterior mediante un adaptador conforme a los mismos puertos. Drafts durables/JMAP, binarios y operaciones de adjuntos también quedan fuera del MVP. Compute-at-the-edge —spam y embeddings— permanece como punto de extensión opcional apagado por defecto; aquí no se definen componentes, entidades ni APIs para él.
