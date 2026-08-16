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

Coordinator / Outbox → JMAP Client → JMAP Server
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

`SyncPort` P-02 está cerrado como frontera de transiciones semánticas atómicas consumida por casos de escritura de Application, Coordinator y Outbox. `LocalChangeSource` P-03 también está cerrado como port separado para invalidaciones post-commit: sus señales no son autoridad, pueden coalescerse o duplicarse y hacen que el consumidor relea mediante `ReadRepository`. P-01→P-03 están cerrados individualmente, pero Ports como fase todavía exige las suites runtime y el audit final definidos en [port-contract-testing.md](../testing/port-contract-testing.md). Las solicitudes `ensure…` o de materialización remota pertenecen a futura orquestación Application → Coordinator, no a ninguno de estos ports.

Ports puede depender únicamente de tipos de Domain y errores propios del contrato. No depende de Tauri, `invoke`, SQLite, SQL, Rust, `rusqlite`, JMAP transport ni `jmap-jam`. Un port es un contrato, no almacenamiento.

### Adapters

**Ruta Tauri esperada al implementarse:** `src/adapters/tauri/`.

Los adaptadores TypeScript, por ejemplo `TauriReadRepository` y `TauriSyncPort`, satisfacen los ports internos y traducen sus operaciones a comandos Tauri explícitos. Pueden depender de Ports, Domain y las APIs Tauri mínimas necesarias para IPC.

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

**Rutas:** `src-tauri/src/commands/`, `src-tauri/src/db/`, `src-tauri/src/security/` y `src-tauri/src/errors/`.

Rust posee SQLite/SQLCipher, migraciones, queries, transacciones, secure store, DEK, validación de la frontera IPC, comandos semánticos y eventos locales necesarios. `commands/` delimita IPC; `db/` implementa el Local Engine; `security/` custodia secretos locales; `errors/` contiene errores nativos tipados.

No implementa JMAP, Coordinator u Outbox; no obtiene correo por red, no actúa como proxy HTTP/WebSocket, no almacena el token JMAP, no renderiza UI y no maneja Pinia. El networking de correo de Rust es ninguno.

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
| Sync | Domain; `SyncPort`; interfaz JMAP; sesión/conectividad |
| JMAP | Web APIs de networking; protocolo y adaptador JMAP aprobado |
| Rust commands | Local Engine; seguridad y errores Rust; Tauri mínimo |
| Rust Local Engine | `rusqlite`/SQLCipher y servicios nativos de seguridad necesarios |

Una conveniencia local no justifica invertir o saltar esta dirección.

## Forbidden dependencies

| Origen | Dependencia prohibida |
| --- | --- |
| Presentation/UI | SQLite, SQL, JMAP Client, transporte JMAP, `fetch("/jmap")`, o `invoke()` directo de persistencia |
| Application | SQLite, SQL, SQLCipher, comandos Tauri concretos, transporte JMAP, `fetch` o WebSocket JMAP |
| Domain | Vue, Pinia, Tauri, `rusqlite`, SQLCipher, DOMPurify o `jmap-jam` |
| Ports | Cualquier infraestructura: Tauri/`invoke`, Rust, SQL/SQLite o transporte JMAP |
| Coordinator / Outbox | SQLite o SQL directos; deben usar `SyncPort` |
| JMAP Client | Pinia, Vue, modelos UI, SQLite, Rust Local Engine o persistencia Tauri |
| Rust Local Engine | JMAP, autenticación remota, almacenamiento del token JMAP o proxy de red |

## State ownership

| Categoría | Estado | Propietario |
| --- | --- | --- |
| Durable | Account cache, Mailbox, Email, Identity, EmailBody, metadata `AttachmentRef`, `MailboxView`, `PendingMutation` y `CollectionSyncCursor` | SQLite + SQLCipher mediante Rust Local Engine |
| Ephemeral | selección, página visible, runtime, conectividad, proyección de auth y composer en curso | Application / Pinia |
| Secret | DEK | Rust + secure store del SO |
| Secret | Token JMAP | Memoria del Worker TypeScript |

Estas categorías no se mezclan. `LocalReady + RemoteAnonymous` es válido.

## Networking ownership

Presentation, Application, Domain, Ports y los adaptadores Tauri tienen networking de correo **ninguno**. Coordinator y Outbox lo orquestan solo mediante JMAP Client. JMAP Client es la única pieza que habla JMAP por `fetch`/WebSocket. Rust Local Engine tiene networking de correo **ninguno**.

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
| `src/app/` | Application state/orchestration | Store `runtime` inicial presente; resto se implementará por sprint |
| `src/domain/` | Domain independiente de infraestructura | D-01→D-10 implementados; freeze completo; Domain cerrado |
| `src/ports/` | Contratos locales | P-01→P-03 cerrados; conformance runtime y audit final de Ports pendientes |
| `src/adapters/tauri/` | Implementaciones Tauri de ports TypeScript | Ubicación esperada cuando se implemente |
| `src/adapters/memory/` | Primer IUT de conformance (`MemoryLocalEngine`) | Ubicación esperada después de implementar las suites TEST-01 |
| `src/jmap/` | Cliente y protocolo JMAP | Ubicación esperada cuando se implemente |
| `src/sync/` | Coordinator + Outbox | Ubicación esperada cuando se implemente |
| `src/security/` | Políticas frontend de render seguro | Ubicación esperada cuando se implemente |
| `src/workers/` | Bootstrap del Worker cuando sea necesario | Ubicación esperada cuando se implemente |
| `src-tauri/src/commands/` | Frontera IPC semántica | Ubicación esperada cuando se implemente |
| `src-tauri/src/db/` | SQLite/SQLCipher Local Engine | Solo schema `0001_initial.sql` presente; runtime pendiente |
| `src-tauri/src/security/` | DEK / secure store | Ubicación esperada cuando se implemente |
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
5. ¿Networking de correo apareció fuera de JMAP Client?
6. ¿SQL o IPC apareció dentro de UI/Application?
