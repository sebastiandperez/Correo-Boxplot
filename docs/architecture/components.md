# Bloque mínimo de componentes del cliente

## 1. Alcance y reglas de dependencia

Este bloque sostiene cuatro recorridos: recibir cambios, abrir un correo, redactar y encolar un envío, y reconciliar SQLite con el servidor. El MVP actual se acepta únicamente en **Tauri v2**. Web/PWA conserva su lugar como adaptador futuro, pero OPFS, wa-sqlite, `SharedWorker`, multi-tab y credenciales Web están fuera del camino crítico actual.

Este documento define responsabilidades de componentes. Las reglas normativas sobre ubicación, imports y dirección de dependencias viven en [layers.md](layers.md).

La regla central es local-first: Vue y Pinia solo obtienen correo mediante `ReadRepository`, que responde desde SQLite local. Una operación `ensure…` registra o deduplica una necesidad y resuelve su `Promise` sin esperar a la red; los datos llegan después mediante `onChange`.

La frontera Repository se divide en `ReadRepository`, consumido por Application/Pinia, y `SyncPort`, consumido por Coordinador/Outbox. Cliente JMAP, Coordinador y Outbox tienen una única implementación TypeScript que, para el MVP, corre en un Worker normal dentro del webview Tauri. Habla JMAP directo por `fetch`/WebSocket y cruza a la persistencia exclusivamente mediante `SyncPort`; su adaptador Tauri concentra `invoke()`.

El ciclo local y el remoto son independientes. `LocalReady + RemoteAnonymous` es válido: la DEK del SQLite local procede del secure store del sistema operativo, mientras el token JMAP solo vive en memoria del Worker. Passkey/WebAuthn autentica al servidor y no deriva la clave SQLCipher.

Las actualizaciones firmadas siguen siendo una defensa obligatoria, pero no se añaden como noveno componente porque no participan en estos cuatro recorridos.

## 2. Presentación segura (Vue 3)

El shell visual desktop de tres columnas ya está materializado en `src/components/`. Es estructura estática únicamente: la lógica de Application, Pinia, Repository y JMAP todavía no está implementada en estos componentes.

* **Responsabilidad:** Renderizar lista, lector y compositor con Vue 3 Composition API; capturar intenciones; presentar estados locales, remotos y de conectividad; sanitizar el HTML crudo con DOMPurify en cada render y mostrarlo en un contexto `iframe sandbox` aislado bajo CSP restrictiva.
* **Qué NO hace:** No ejecuta SQL, no llama JMAP, no usa `fetch` para obtener correo, no recibe HTML como confiable, no navega el webview principal desde enlaces de un correo y no conserva secretos. No descarga, guarda, sube ni envía adjuntos en el MVP.
* **Dependencias:** Stores de Pinia, DOMPurify, política de sanitización, sandbox de render y CSP de Tauri.
* **Consumidores:** Usuario final.
* **Datos de entrada:** Proyecciones reactivas, estados `runtime`, metadatos de adjuntos y cuerpos leídos desde `ReadRepository` a través de Pinia.
* **Datos de salida:** Intenciones de selección, lectura, cambio de keywords/mailboxes, edición del compositor, confirmación de descarte y encolado de envío.
* **Estado:** Solo estado visual de vida corta. El HTML sanitizado preparado para un render no es una copia durable.
* **Persistencia:** Ninguna. No usa `localStorage`; no persiste drafts ni HTML sanitizado.
* **Networking:** Ninguno. Los recursos remotos del correo están bloqueados por defecto y los enlaces `http`/`https` se abren mediante código controlado.

---

## 3. Estado de aplicación (Pinia)

* **Responsabilidad:** Mantener estado efímero de Application, selección y proyecciones visibles; coordinar lecturas locales; conservar el compositor temporal; releer `ReadRepository` cuando recibe `onChange`.
* **Qué NO hace:** No es fuente durable, no persiste stores, no importa JMAP, no interpreta respuestas remotas y no duplica `CollectionSyncCursor` ni `PendingMutation` como autoridad propia.
* **Dependencias:** `ReadRepository`.
* **Consumidores:** Componentes y composables Vue.
* **Datos de entrada:** Intenciones de UI, resultados locales de `ReadRepository` y señales `onChange`.
* **Datos de salida:** Estado reactivo para Vue y llamadas semánticas a `ReadRepository`.
* **Estado:** Tres stores mínimos: `runtime` con `local: opening | ready | error`, `auth: anonymous | authenticating | authenticated | expired`, `connectivity: online | offline`; `mail` con cuenta/mailbox/email seleccionados, página visible y `loadState: idle | loading | ready | error`; `composer` con campos en edición y `phase: idle | editing | queueing | error`. Estados de sync y Outbox se proyectan desde SQLite.
* **Persistencia:** Ninguna. El draft es **memory only**: sin tabla, autosave ni JMAP Draft sync. El compositor se limpia únicamente después de persistir con éxito la `PendingMutation`; si falla, conserva todo el contenido. Un cierre o crash previo a Enviar puede perder la redacción y es una limitación explícita del MVP.
* **Networking:** Ninguno.

---

## 4. Interfaz Repository (`ReadRepository` + `SyncPort`)

* **Responsabilidad:** Separar consumidores sin exponer el motor. `ReadRepository` ofrece lecturas locales, registro atómico de cambios optimistas y envíos, `ensureFolderWindow`/`ensureMessageBody` y `onChange`. `SyncPort` permite al Coordinador/Outbox aplicar lotes, avanzar cursores y transicionar `PendingMutation`.
* **Qué NO hace:** No expone SQL, tablas, `invoke()`, rutas de archivo ni tipos de transporte JMAP. `ensure…` nunca promete que los datos remotos ya llegaron. No usa `viewId`, `filterHash` o `sortHash` como autoridad de igualdad: la identidad de `MailboxView` procede de Account, Mailbox y sus FilterSpec/SortSpec canónicos.
* **Dependencias:** Tipos del dominio y errores propios del contrato. En el MVP, adaptadores TypeScript Tauri satisfacen estos contratos y cruzan por IPC hacia el Motor Rust.
* **Consumidores:** Application/Pinia consume solo `ReadRepository`; Coordinador y Outbox consumen solo `SyncPort`.
* **Datos de entrada:** `AccountKey`, scoped IDs, ViewSpec semántica, `position + limit`, filtro/orden, cambios semánticos, `SendIntent`, lotes normalizados, `CollectionSyncCursor` y transiciones de `PendingMutation`.
* **Datos de salida:** Entidades/proyecciones locales, comprobantes transaccionales, `onChange` y errores `not_found | conflict | storage_unavailable | encryption_locked | migration_failed`.
* **Estado:** El contrato no posee autoridad de dominio. Una implementación puede mantener suscripciones y solicitudes `ensure…` en vuelo.
* **Persistencia:** Ninguna por sí misma. Sus futuras implementaciones deben preservar `cambio optimista + PendingMutation` y `cambios remotos + nuevo collection state` como transacciones atómicas.
* **Networking:** Ninguno. El kit de contrato por implementar incluye mock en memoria de ambos puertos y suite de conformidad reutilizable contra el mock y los adaptadores Tauri respaldados por el Motor Rust; Motor Web se añadirá a esa misma suite en su iteración futura.

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

## 6. Motor Web/PWA — diferido

* **Responsabilidad:** En una iteración futura, implementar los mismos contratos sobre `wa-sqlite`/OPFS dentro de `SharedWorker` y notificar por `BroadcastChannel`.
* **Qué NO hace:** No forma parte del MVP Tauri, de Gate 0-C actual ni de sus criterios de aceptación. No se considera descartado.
* **Dependencias:** **DEFERRED:** OPFS, wa-sqlite, estrategia de cifrado Web, custodia de credenciales, multi-tab y `SharedWorker`.
* **Consumidores:** Futuros adaptadores Web de `ReadRepository`/`SyncPort`.
* **Datos de entrada:** Los mismos contratos lógicos cuando se implemente.
* **Datos de salida:** Resultados observables conformes a la suite compartida futura.
* **Estado:** **MOVED TO FUTURE WEB ITERATION.**
* **Persistencia:** No diseñada ni validada para el MVP actual. Sigue prohibido aceptar texto plano como fallback cuando se retome.
* **Networking:** La topología prevista conserva Cliente JMAP/Coordinador/Outbox TypeScript en `SharedWorker`, pero su operación se valida en la iteración Web futura.

---

## 7. Coordinador de sincronización

* **Responsabilidad:** Mantener SQLite al día en background; reaccionar a inicio autenticado, reconexión, `ensure…` y `StateChange`; leer `CollectionSyncCursor`, pedir deltas, normalizar/mergear DTOs JMAP parciales hasta producir entidades Domain completas, aplicar lotes por `SyncPort` y avanzar cada collection state en la misma transacción que sus cambios.
* **Qué NO hace:** No participa en la lectura de primer plano, no entrega respuestas JMAP a Pinia, no implementa servidor/IMAP/SMTP y no interpreta un push como contenido completo.
* **Dependencias:** Cliente JMAP, `SyncPort`, conectividad y sesión remota autenticada.
* **Consumidores:** Worker TypeScript Tauri; un futuro `SharedWorker` reutilizará la implementación.
* **Datos de entrada:** `CollectionSyncCursor`, ViewSpecs con su `queryState`, solicitudes `ensure…`, eventos de conectividad/sesión y push.
* **Datos de salida:** Invocaciones JMAP, lotes normalizados, nuevos collection states, cambios de `MailboxView` y señales locales indirectas.
* **Estado:** Coordinación y deduplicación en vuelo. `CollectionSyncCursor` contiene solo el checkpoint `AccountKey + DataType + opaque state`; `queryState` pertenece a la ViewSpec exacta. Status, lastError y timestamps son diagnóstico operacional separado cuya forma definitiva todavía no se diseña.
* **Persistencia:** Solo por `SyncPort`; datos remotos y nuevo collection state se confirman atómicamente.
* **Networking:** Solo mediante Cliente JMAP. `cannotCalculateChanges` provoca refetch/rebase del scope afectado, no reset automático completo de DB. Prioridades, batching, backoff, `queryChanges`, movimientos de posiciones y el algoritmo de rebase son trabajo posterior del Coordinator.

---

## 8. Procesador de Pending Mutations (Outbox)

* **Responsabilidad:** Tomar exclusivamente la familia discriminada de intenciones durables —`SendMutation`, `KeywordMutation` y `MailboxMembershipMutation`—, traducirlas a JMAP, reconciliar outcomes inciertos y registrar confirmación o fallo terminal. La primera conserva `SendIntent`; las otras actúan sobre `ScopedEmailId`.
* **Qué NO hace:** No crea un `Email` falso o placeholder con ID temporal, no guarda drafts, no considera éxito el clic en Enviar, no descarta payload ante fallo de red, no implementa SMTP y no sube adjuntos en el MVP.
* **Dependencias:** `SyncPort`, Cliente JMAP y la operación acordada para solicitar reconciliación al Coordinador.
* **Consumidores:** Worker TypeScript y, por proyección local vía `onChange`, Pinia.
* **Datos de entrada:** `PendingMutation` cifradas, identificadas por `AccountKey + MutationId`, conectividad y resultados JMAP.
* **Datos de salida:** Operaciones JMAP, transiciones durables, errores presentables y solicitud de resincronización.
* **Estado:** En vuelo y timers efímeros; el ciclo durable conserva `pending`, `inFlight`, `retrying`, `confirmed` y `failedTerminal`. `inFlight` puede significar que el request llegó al servidor pero el outcome remoto sigue sin resolverse.
* **Persistencia:** Solo mediante `SyncPort`. El encolado y cualquier cambio optimista son atómicos. `confirmed` puede permanecer durable hasta reconciliar la autoridad relevante; la política exacta de cleanup queda para Outbox.
* **Networking:** Solo mediante Cliente JMAP. Después de crash no reintenta ciegamente una `SendMutation` inFlight: debe reconciliar antes de decidir si otra submission es segura. El algoritmo de idempotencia, orden, backoff y conflictos se cierra durante la implementación de Outbox.

---

## 9. Cliente JMAP

* **Responsabilidad:** Implementar en TypeScript JMAP estándar: descubrimiento/sesión, métodos por `fetch`, push `StateChange` por WebSocket, serialización, validación y errores. Mantiene DTOs parciales dentro de la frontera de transporte y los normaliza/mergea antes de producir entidades Domain completas. Normaliza body parts sin exponer un MIME tree crudo; D-09 decidirá la representación final de `EmailBody`.
* **Qué NO hace:** No implementa servidor ni proveedor real, no habla IMAP/SMTP, no ejecuta SQL, no entrega modelos de UI, no pasa la red por Rust y no maneja binarios de adjuntos en el MVP.
* **Dependencias:** HTTPS, WebSocket, capacidades JMAP y token de sesión obtenido por el flujo Passkey en navegador del sistema.
* **Consumidores:** Coordinador y Outbox.
* **Datos de entrada:** Invocaciones JMAP, cursores/state, IDs, parches y cuerpo saliente sin adjuntos.
* **Datos de salida:** Respuestas validadas y normalizadas, metadata `AttachmentRef`, contenido de body conforme a la futura D-09, errores clasificados y `StateChange`.
* **Estado:** JMAP Session, WebSocket, solicitudes y token. El token vive solo en memoria del Worker, nunca en Pinia/SQLite/`localStorage`/logs, y se elimina al logout, expiración o cierre.
* **Persistencia:** Ninguna directa. Correo, cursores y pendientes pasan por `SyncPort`.
* **Networking:** Sí; corre en Worker normal dentro del webview Tauri y habla directo con el servidor JMAP. El runtime `SharedWorker` queda para la futura iteración Web.

## 10. Explicación del diagrama de componentes: abres la bandeja de entrada

Imagina que arrancas la aplicación sin conexión. Rust recupera la DEK del secure store y abre SQLCipher; aunque todavía estés `RemoteAnonymous`, la combinación `LocalReady + RemoteAnonymous` te permite entrar a la caché.

1. **Tú eliges Bandeja de entrada en Vue.** La presentación registra la intención y se la comunica a Pinia. No llama a la red.
2. **Pinia actualiza la selección.** El store pide la primera ventana mediante `ReadRepository` y marca la carga local, no una espera JMAP.
3. **`ReadRepository` cruza la frontera Tauri.** El adaptador usa un comando `invoke()` explícito; Rust consulta SQLite cifrado sin exponer SQL ni la DEK al webview.
4. **Ves inmediatamente lo disponible.** La `MailboxView` y sus `Email` vuelven a Pinia, que publica la proyección para Vue. Todo lo visible procede de SQLite, también offline.
5. **Completar la ventana no bloquea la pantalla.** `ensureFolderWindow` registra o deduplica la necesidad y resuelve. Si no hay sesión remota, el trabajo espera sin impedir la lectura local.
6. **Cuando te autenticas, empieza el ciclo remoto.** El Passkey se ejecuta en el navegador del sistema. El token resultante entra solo en la memoria del Worker; no desbloquea la DB ni pasa por Pinia.
7. **El Worker habla JMAP directamente.** El Coordinador lee el cursor por `SyncPort`; Cliente JMAP usa `fetch`/WebSocket contra el servidor. `StateChange` solo dispara la consulta incremental.
8. **Los cambios se vuelven locales antes de ser visibles.** El Worker entrega el lote normalizado a `SyncPort`; `TauriSyncPort` concentra `invoke()` y Rust confirma datos y nuevo cursor en una transacción SQLCipher antes de emitir un evento Tauri.
9. **Pinia vuelve a leer.** `ReadRepository.onChange` recibe el evento, Pinia repite la lectura y Vue actualiza la bandeja desde SQLite, nunca desde la respuesta de red.
10. **Al abrir un mensaje se repite la regla.** Si falta el cuerpo, `ensureMessageBody` lo agenda. Cuando llega contenido normalizado conforme a D-09, Rust lo cifra y el evento provoca otra lectura; la ausencia previa del body nunca volvía incompleto al Email de metadata.
11. **El HTML se trata como hostil.** Vue sanitiza el raw en cada render, elimina contenido activo y remoto y lo muestra dentro del sandbox bajo CSP; no persiste el resultado sanitizado.
12. **Si redactas, el contenido vive solo en memoria hasta Enviar.** Al pulsar Send, Application valida Composer, resuelve los defaults de Identity y congela un `SendIntent`; el motor persiste una `SendMutation` con ese snapshot antes de limpiar Composer. Si falla, conserva la edición. Outbox no relee defaults ni fabrica un Email; el mensaje autoritativo aparece tras la reconciliación JMAP.

## 11. Extensiones futuras fuera de alcance

Web/PWA se retoma en una iteración posterior mediante un adaptador conforme a los mismos puertos. Drafts durables/JMAP, binarios y operaciones de adjuntos también quedan fuera del MVP. Compute-at-the-edge —spam y embeddings— permanece como punto de extensión opcional apagado por defecto; aquí no se definen componentes, entidades ni APIs para él.
