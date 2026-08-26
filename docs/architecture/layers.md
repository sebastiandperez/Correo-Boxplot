# Layers and dependency rules

## Purpose

Este documento es la referencia canónica para decidir **dónde vive el código y qué puede importar**. No redefine las responsabilidades descritas en [components.md](components.md), el modelo de [domain.md](domain.md) ni las invariantes de [security.md](security.md).

El MVP actual es Tauri-only. Las rutas que todavía no contienen código indican la ubicación esperada cuando se implemente; no obligan a crear stubs ni directorios vacíos.

Capas y componentes no son sinónimos. Una capa establece reglas de dependencia y organización; un componente es una unidad de responsabilidad que pertenece a una capa.

## Architectural view

```text
Presentation (Vue)
        ↓ intenciones / proyecciones
Application (Pinia + orchestration)
        ↓
Domain + Ports
        ↑ implementados por
Tauri adapters TypeScript
        ↓ invoke() semántico
Rust commands → Local Engine → SQLite + SQLCipher

Coordinator → RemoteMail → JMAP adapter → JMAP Server
Outbox → RemoteMail + Submission → protocol adapters
     ↓
 SyncPort → Tauri adapter → Rust Local Engine
```

Las dependencias de código apuntan hacia contratos y tipos internos. En ejecución, las llamadas cruzan desde esos contratos hacia adaptadores e infraestructura. Los adaptadores TypeScript satisfacen `ReadRepository` y `SyncPort`; Rust no implementa literalmente interfaces TypeScript, sino la semántica de persistencia expuesta mediante IPC Tauri semántico.

## Layers

### Presentation

**Ruta principal:** `src/components/`; estilos en `src/styles/`.

Renderiza Vue, captura intenciones, presenta proyecciones de Application y aplica la política de render seguro. Puede depender de la API pública de `src/app/`, de tipos/proyecciones de `src/domain/` cuando corresponda y de utilidades estrictamente visuales o de seguridad de render.

No ejecuta SQL, no consulta SQLite, no conoce SQLCipher o la DEK, no llama JMAP ni usa `fetch` para obtener correo. Tampoco invoca directamente comandos Tauri de persistencia ni conserva secretos. Presentation expresa intención; no implementa infraestructura.

### Application

**Ruta:** `src/app/`.

Contiene Pinia, selección, composer temporal, proyecciones visibles y coordinación de lecturas locales. Convierte intenciones de UI en operaciones de Application, consume `ReadRepository`, reacciona a invalidaciones mediante `LocalChangeSource` P-03 y produce estado reactivo para Vue.

Puede depender de Domain, Ports y Pinia. No depende directamente de SQLite, SQL, SQLCipher, comandos Tauri concretos, transporte JMAP, `jmap-jam`, `fetch` o WebSocket. Pinia no es persistencia, segunda base de datos ni autoridad durable.

### Domain

**Ruta implementada:** `src/domain/`. Los bloques D-01→D-10 están completos y el Domain Final Audit #2 aprobó el freeze final. Domain está cerrado.

Define conceptos y semántica del cliente —identidades scoped, `Account`, `Mailbox`, `Email`, `Identity`, `SendIntent`, `EmailBody`, `AttachmentRef`, `MailboxView`, `PendingMutation` y `CollectionSyncCursor`— sin decisiones de infraestructura.

Domain no depende de Vue, Pinia, Tauri, `@tauri-apps/api`, SQLite, SQL, Rust, `rusqlite`, SQLCipher, `jmap-jam`, `fetch`, WebSocket ni DOMPurify. Los adaptadores transforman entre tipos de transporte, persistencia y dominio; los tipos de una librería JMAP nunca se convierten en tipos de dominio.

### Ports

**Ruta:** `src/ports/`.

`ReadRepository` es el contrato TypeScript P-01 cerrado para consultas puras sobre estado local committed. No escribe, no agenda trabajo remoto y no emite notificaciones. Distingue ausencia local, ausencia del owner, valor owned opcional y caché no materializada mediante `LocalEntityRead`, `OwnedSnapshotRead`, `OwnedOptionalRead` y `OwnedCacheRead`.

`SyncPort` P-02 está cerrado como frontera de transiciones semánticas atómicas consumida por casos de escritura de Application, Coordinator y Outbox. `LocalChangeSource` P-03 también está cerrado como port separado para invalidaciones post-commit: sus señales no son autoridad, pueden coalescerse o duplicarse y hacen que el consumidor relea mediante `ReadRepository`. P-01→P-03 y la suite reusable del Local Engine están cerrados para el alcance MVP actual según [port-contract-testing.md](../testing/port-contract-testing.md). Las solicitudes `ensure…` o de materialización remota pertenecen a futura orquestación Application → Coordinator, no a ninguno de estos ports.

Ports puede depender únicamente de tipos de Domain y errores propios del contrato. No depende de Tauri, `invoke`, SQLite, SQL, Rust, `rusqlite`, JMAP transport ni `jmap-jam`. Un port es un contrato, no almacenamiento.

### Adapters

**Ruta Tauri implementada:** `src/adapters/tauri/`.

Los adaptadores TypeScript, por ejemplo `TauriReadRepository` y `TauriSyncPort`, satisfacen los ports internos y traducen sus operaciones a comandos Tauri explícitos. Pueden depender de Ports, Domain y las APIs Tauri mínimas necesarias para IPC.

PROD-CONFORMANCE-01 valida los tres adapters con 179/179 escenarios portables a través de `LocalEngineIpcClient`, Tauri IPC/eventos, handlers Rust y SQLite/SQLCipher reales en el runtime probado. El lifecycle temporal de conformance se compila por feature y no amplía los 25 comandos de la aplicación normal.

No contienen lógica de UI, stores Pinia, protocolo JMAP, queries SQL escritas en TypeScript ni secretos. El `invoke()` de persistencia se concentra aquí; no se dispersa en componentes, stores, Domain, Sync o JMAP. Cualquier otra operación nativa requiere una frontera de infraestructura dedicada y explícitamente autorizada.

Un adaptador Web/PWA futuro podrá satisfacer los mismos ports, pero su diseño e implementación están diferidos y fuera del MVP.

### Sync

**Ruta esperada al implementarse:** `src/sync/`.

Aloja Coordinator y Outbox. Orquesta sincronización, `ensure…`, reconciliación y procesamiento durable de `PendingMutation`.

Puede depender de Domain, `SyncPort`, la interfaz del JMAP Client y abstracciones de conectividad/sesión. No depende de componentes Vue, no usa Pinia como fuente de dominio, no ejecuta SQL ni accede directamente a SQLite. Coordinator y Outbox persisten exclusivamente mediante `SyncPort`.

### JMAP

**Ruta esperada al implementarse:** `src/jmap/`, separando cliente, transporte, tipos de protocolo y errores cuando exista código real.

Es la única área que habla JMAP mediante `fetch`/WebSocket. Implementa sesión, serialización, validación, normalización y errores de protocolo. Puede depender de Web APIs de networking y, solo tras el PoC previsto, de una librería JMAP detrás de una interfaz propia.

No depende de Vue, Pinia, SQLite, SQL, Rust Local Engine ni persistencia Tauri. No produce modelos de UI ni escribe directamente en la base: entrega resultados a Coordinator/Outbox, que persisten mediante `SyncPort`.

### Tauri / Rust Local Engine

**Rutas implementadas:** `src-tauri/src/ipc/`, `src-tauri/src/persistence/`, `src-tauri/src/db/`, `src-tauri/src/security/` y `src-tauri/src/bootstrap/`.

Rust posee SQLite/SQLCipher, migraciones, queries, transacciones, secure store, DEK, validación de la frontera IPC, comandos semánticos y eventos locales necesarios. `ipc/` delimita los 25 comandos IPC-00 y `local-state-changed`; `persistence/` implementa el motor semántico PERSIST-01; `db/` aplica migraciones; `security/` selecciona el credential store nativo y custodia la DEK; `bootstrap/` coordina lifecycle, markers crash-safe, reset interno y lock entre procesos. Véase [secure-local-cache.md](secure-local-cache.md).

No implementa JMAP, Coordinator u Outbox; no obtiene correo por red, no actúa como proxy HTTP/WebSocket, no almacena el token JMAP, no renderiza UI y no maneja Pinia. El networking de correo del Rust Local Engine es ninguno.

### Red nativa IMAP/SMTP — diferida (ADR-008)

**Ruta futura:** `src-tauri/src/net/`.

Cuando se implemente, abrirá TCP/TLS únicamente para protocolos nativos que lo requieren. Será una capa distinta del Rust Local Engine: no adquirirá `EngineLease`, no conocerá `SyncPort`/`ReadRepository`/SQLite/SQLCipher y no traducirá IMAP a DTOs JMAP. No existe todavía implementación IMAP/SMTP en este repositorio.

## Dependency direction

Las dependencias de código apuntan hacia Domain y Ports; los adaptadores e infraestructura dependen de esos contratos, nunca al revés.

### Allowed dependencies

Las dependencias permitidas son:

| Desde | Puede depender de |
| --- | --- |
| Presentation | Application pública; tipos/proyecciones de Domain; seguridad de render |
| Application | Domain; Ports; Pinia |
| Domain | Nada específico de infraestructura |
| Ports | Domain; errores propios de contrato |
| Tauri adapters | Ports; Domain; API Tauri mínima para IPC |
| Sync | Domain; `SyncPort`; `ReadRepository`; `RemoteMail`; `Submission` |
| Remote core | Tipos mail protocol-neutral y compatibility bridge al Domain congelado |
| Remote JMAP adapter | `RemoteMail`/`Submission`; `JmapClient`; DTOs y errores JMAP |
| JMAP | Web APIs de networking; protocolo y librería JMAP aprobada |
| Rust commands | Local Engine; seguridad y errores Rust; Tauri mínimo |
| Rust Local Engine | `rusqlite`/SQLCipher y servicios nativos de seguridad necesarios |
| Rust net futuro (ADR-008) | Crates TLS/IMAP/SMTP pinneados con versión exacta; Tauri mínimo para IPC |

Una conveniencia local no justifica invertir o saltar esta dirección.

## Forbidden dependencies

| Origen | Dependencia prohibida |
| --- | --- |
| Presentation/UI | SQLite, SQL, JMAP Client, transporte JMAP, `fetch("/jmap")`, o `invoke()` directo de persistencia |
| Application | SQLite, SQL, SQLCipher, comandos Tauri concretos, transporte JMAP, `fetch` o WebSocket JMAP |
| Domain | Vue, Pinia, Tauri, `rusqlite`, SQLCipher, DOMPurify o `jmap-jam` |
| Ports | Cualquier infraestructura: Tauri/`invoke`, Rust, SQL/SQLite o transporte JMAP |
| Coordinator / Outbox | JMAP/IMAP/SMTP concretos, SQLite o SQL directos; deben usar Remote Boundary y `SyncPort` |
| JMAP Client | Pinia, Vue, modelos UI, SQLite, Rust Local Engine o persistencia Tauri |
| Rust Local Engine | JMAP, autenticación remota, almacenamiento del token JMAP o proxy de red |
| Rust net futuro (ADR-008) | JMAP; DTOs JMAP falsos; `EngineLease`; `SyncPort`/`ReadRepository`; SQLite/SQLCipher; almacenamiento del token JMAP |

## State ownership

| Categoría | Estado | Propietario |
| --- | --- | --- |
| Durable | Account cache, Mailbox, Email, Identity, EmailBody, metadata `AttachmentRef`, `MailboxView`, `PendingMutation` y `CollectionSyncCursor` | SQLite + SQLCipher mediante Rust Local Engine |
| Ephemeral | selección, página visible, runtime, conectividad, proyección de auth y composer en curso | Application / Pinia |
| Secret | DEK | Rust + secure store del SO |
| Secret | Token JMAP | Memoria del Worker TypeScript |

Estas categorías no se mezclan. `LocalReady + RemoteAnonymous` es válido.

## Networking ownership

Presentation, Application, Domain, Ports y los adaptadores Tauri tienen networking de correo **ninguno**. Coordinator consume `RemoteMail`; Outbox consume `RemoteMail` + `Submission`, sin ramas de protocolo. Solo `src/remote/jmap/` y la composición explícita conocen `JmapClient`; este último habla JMAP por `fetch`/WebSocket. Rust Local Engine tiene networking de correo **ninguno**. La futura red nativa IMAP/SMTP quedará detrás de adapters propios y separada del Local Engine.

## Persistence ownership

Presentation y Domain no persisten; Application no tiene persistencia durable. `ReadRepository` y `SyncPort` describen operaciones, pero no almacenan. Los adaptadores Tauri cruzan IPC; Rust Local Engine posee la persistencia local y SQLite + SQLCipher es la fuente local de verdad para la UI. El servidor JMAP continúa siendo la autoridad remota:

```text
local source of truth for UI != remote authority
```

## Folder mapping

| Path | Architectural role | Estado actual |
| --- | --- | --- |
| `src/components/` | Presentation | UI Shell estático presente |
| `src/styles/` | Presentation styles | Presente |
| `src/app/` | Application state/orchestration | A-01→A-08 completos: composición explícita, proyecciones Pinia efímeras, lecturas P-01, escrituras P-02 e invalidación P-03 |
| `src/domain/` | Domain independiente de infraestructura | D-01→D-10 implementados; freeze completo; Domain cerrado |
| `src/ports/` | Contratos locales | P-01→P-03 y Local Engine contract suite cerrados para MVP actual |
| `src/adapters/tauri/` | Implementaciones Tauri de ports TypeScript | TAURI-ADAPTERS-01 completo; P-01/P-02/P-03 traducen mediante el cliente IPC-00 |
| `src/adapters/memory/` | Primer IUT de conformance (`MemoryLocalEngine`) | Implementado; final audit PASS |
| `src/jmap/` | Cliente y protocolo JMAP | Ubicación esperada cuando se implemente |
| `src/sync/` | Coordinator + Outbox | Ubicación esperada cuando se implemente |
| `src/security/` | Políticas frontend de render seguro | Ubicación esperada cuando se implemente |
| `src/workers/` | Bootstrap del Worker cuando sea necesario | Ubicación esperada cuando se implemente |
| `src/ipc/` | DTOs y cliente IPC TypeScript de bajo nivel | IPC-00 completo; todavía no implementa Ports |
| `src-tauri/src/ipc/` | Frontera IPC semántica | IPC-00 completo: 15 reads, 10 writes y un evento post-commit |
| `src-tauri/src/persistence/` | Persistent Local Engine | PERSIST-01 completo sobre SQLite/SQLCipher |
| `src-tauri/src/db/` | Migraciones SQLite/SQLCipher | PERSIST-01 completo hasta schema version 2 |
| `src-tauri/src/security/` | DEK / secure store nativo | SECURE-BOOTSTRAP-01 implementado; secreto binario Rust-only |
| `src-tauri/src/bootstrap/` | Lifecycle cifrado / recovery / reset / process lock | SECURE-BOOTSTRAP-01 implementado; sin comandos IPC nuevos |
| `src-tauri/src/errors/` | Errores nativos tipados | Base inicial presente |

## Construction principles

1. Local-first.
2. SQLite local es la fuente de verdad de la UI.
3. JMAP/servidor es la autoridad remota.
4. La UI nunca espera a la red para leer correo.
5. Depender de contratos, no de infraestructura.
6. Domain permanece independiente de infraestructura.
7. Rust posee SQLCipher y los secretos locales.
8. JMAP permanece en TypeScript.
9. Estado durable y efímero permanecen separados.
10. IPC parte de default-deny y expone solo comandos semánticos mínimos.
11. No añadir dependencias o abstracciones especulativas.
12. Construir solo la implementación mínima requerida por el sprint actual.

## How to use this document in reviews

Antes de aprobar un cambio, verificar:

1. ¿El código vive en la capa correcta?
2. ¿Sus imports apuntan en la dirección permitida?
3. ¿Cruza un port o salta una frontera?
4. ¿Estado durable terminó accidentalmente en Pinia?
5. ¿Un protocolo concreto apareció en Coordinator/Outbox? ¿Networking de correo salió de su adapter o tocó el Local Engine?
6. ¿SQL o IPC apareció dentro de UI/Application?
