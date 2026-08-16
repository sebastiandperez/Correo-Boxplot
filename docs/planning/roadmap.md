# Roadmap ejecutable del MVP Tauri

## 1. Propósito y estado

Este roadmap ordena dependencias reales; no asigna fechas ni confunde una decisión cerrada con código implementado. El MVP actual es **Tauri-only**. Web/PWA sigue siendo una dirección arquitectónica futura, pero no forma parte de sus fases ni de su aceptación.

### Gate status

| Gate | Estado | Qué quedó cerrado |
| --- | --- | --- |
| **0-A** | **CLOSED** | Cliente JMAP + Coordinador + Outbox: una implementación TypeScript en Worker; red directa; Rust solo persistencia/cifrado/secure store. |
| **0-B** | **CLOSED** | Modelo lógico D-01…D-08: identities scoped, Email completo, addresses, Identity/SendIntent, Mailbox, MailboxView, CollectionSyncCursor y familia PendingMutation. |
| **0-C** | **CLOSED FOR TAURI MVP** | DEK aleatoria en Rust/secure store, auth Passkey separada, token memory-only, ciclos local/remoto independientes, recuperación por reset/resync y frontera Tauri. |
| **0-D** | **CLOSED FOR TAURI MVP** | Pinia efímero, drafts memory-only, solo `PendingMutation` para send, metadata de adjuntos y render HTML en defensa en profundidad. |

El Gate 0 arquitectónico está cerrado y el diagnóstico previo a Domain confirmó que puede implementarse aislado. La documentación canónica ya refleja D-01…D-08; D-09 permanece abierta. Domain, Ports, adapters, motores y suites siguen siendo **trabajo de implementación** y no se agrupan en un único paso.

La baseline de toolchains/dependencias del **13 de agosto de 2026** también está congelada en `docs/development/stack.md`. Esto cierra selección y pinning, no los PoCs de provisioning SQLCipher, conformance JMAP ni matriz WebView/OS.

## 2. Orden de construcción vigente

La secuencia obligatoria del core es:

1. Architecture/Domain decisions — completadas.
2. Repository diagnostic — completado.
3. Documentation freeze — completado por esta revisión.
4. Isolated Domain implementation.
5. Domain verification/freeze.
6. Ports.
7. Adapters y conformance doubles.
8. Rust Local Engine y persistence integration.
9. JMAP, Coordinator y Outbox integration.

Domain no espera SQLite, Rust, JMAP, Pinia ni Ports. Ports sí esperan un Domain implementado y verificado. Adapters esperan Ports. La persistencia y los algoritmos remotos se integran después sin redefinir identidades ni entidades.

Application y Presentation siguen siendo capas consumidoras independientes; este orden no convierte a Persona B en intermediario organizativo entre A y C. Solo expresa dependencias de artefactos compartidos.

## 3. Topología vigente del MVP

| Elemento | Decisión Tauri MVP |
| --- | --- |
| Runtime de JMAP/Coordinator/Outbox | Worker normal TypeScript dentro del webview |
| Persistencia | `SyncPort`/`ReadRepository` → adaptadores Tauri TypeScript → `invoke()` validado → Rust → SQLite + SQLCipher |
| Red JMAP | `fetch` + WebSocket directos desde TypeScript; nunca por Rust |
| Cambios locales | Sistema de eventos de Tauri → `onChange` → relectura local |
| Clave local | DEK aleatoria 32 bytes, creada/recuperada y usada solo en Rust |
| Sesión remota | Passkey en navegador del sistema; token solo en memoria del Worker |
| Background | Política Tauri `backgroundThrottling: "throttle"`; riesgo acotado aceptado |

## 4. Diagrama de fases y paralelismo

```mermaid
flowchart TD
    Decisions["Architecture + D-01…D-08<br/>CLOSED"]
    Diagnostic["Pre-Domain diagnostic<br/>COMPLETE"]
    Docs["Documentation freeze<br/>COMPLETE"]
    Domain["Isolated Domain implementation"]
    DomainGate["Domain verification/freeze"]
    Ports["Ports"]
    Adapters["Adapters + conformance doubles"]
    Engine["Rust Local Engine<br/>persistence integration"]
    Remote["JMAP + Coordinator + Outbox<br/>integration"]
    App["Application + Presentation<br/>consumer work"]
    Acceptance["Integrated Tauri acceptance"]
    FutureWeb["Future Web/PWA iteration<br/>DEFERRED"]

    Decisions --> Diagnostic --> Docs --> Domain --> DomainGate --> Ports --> Adapters --> Engine --> Remote --> Acceptance
    DomainGate --> App
    Ports --> App
    App --> Acceptance
    Ports -.->|"future compatible boundary"| FutureWeb
    Acceptance -.->|"later iteration"| FutureWeb

    classDef closed fill:#e7f7ea,stroke:#297a38,color:#222;
    classDef active fill:#eef7ff,stroke:#336b99,color:#222;
    classDef deferred fill:#f4f4f4,stroke:#777,stroke-dasharray:5 5,color:#444;
    class Decisions,Diagnostic,Docs closed;
    class Domain,DomainGate,Ports,Adapters,Engine,Remote,App,Acceptance active;
    class FutureWeb deferred;
```

Web/PWA no participa en la aceptación del MVP. Su nodo documenta continuidad futura, no trabajo concurrente ni gate presente.

## 5. Fase 0 — decisiones y documentation freeze

### Gate de entrada

Fuentes de verdad disponibles y aceptación de que el informe técnico reciente sustituye las decisiones provisionales de 0-C/0-D para el MVP Tauri.

### Frentes de decisión cerrados

#### 0-A — topología

Una implementación TypeScript de Cliente JMAP, Coordinador y Outbox. En Tauri corre en Worker normal, usa JMAP directo y cruza a Rust solo mediante los adaptadores Tauri que satisfacen `ReadRepository`/`SyncPort`. Rust no aloja JMAP.

#### 0-B — Domain D-01…D-08

Quedaron congelados `AccountKey`/`RemoteAccountRef`, scoped IDs, Email mínimo completo, `EmailAddress`, `Identity`/`SendIntent`, Mailbox/rights, la identidad semántica de `MailboxView`, `CollectionSyncCursor` y la familia discriminada `PendingMutation`. D-09 (`EmailBody`) permanece abierta. Ports y su representación TypeScript se diseñan después del Domain verificado.

`0001_initial.sql` es una migración histórica y mínima: sus gaps no redefinen Domain ni implican que el Local Engine esté implementado.

#### 0-C — seguridad para Tauri

Passkey en navegador del sistema autentica la sesión remota. SQLCipher usa una DEK aleatoria guardada en el secure store y accesible solo por Rust. El token JMAP es memory-only. `LocalReady + RemoteAnonymous` es válido. La pérdida de DEK se recupera mediante reset explícito de caché, nueva DEK y full resync, advirtiendo sobre `PendingMutation` locales.

PRF-derived DB unlock, SQLCipher Web/OPFS y custodia Web están **DEFERRED / MOVED TO FUTURE WEB ITERATION**.

#### 0-D — Application y alcance

Pinia guarda proyecciones y estado efímero; SQLite es la fuente durable. Drafts son memory-only. Send pendiente existe solo como `PendingMutation` con identidad estable. Attachments conservan metadata, no bytes ni operaciones. HTML raw se cifra y se sanitiza en cada render dentro de sandbox + CSP, sin copia sanitizada persistente.

La idempotencia ante respuesta ambigua está **MOVED TO PHASE 2 · OUTBOX**; no bloquea el cierre arquitectónico de 0-D.

### Criterio de salida

Cumplido: los cuatro gates tienen decisiones inequívocas, el diagnóstico del repositorio está completo y la documentación canónica refleja D-01…D-08. Esto no afirma que Domain ni Ports existan como código.

## 6. Fase 1 — Domain aislado

### Gate de entrada

Documentation freeze D-01…D-08 completado.

### 1-A — Materialización de Domain

Implementar exclusivamente `src/domain/` siguiendo `docs/architecture/domain.md`, sin importar Vue, Pinia, Tauri, SQLite, Rust, transporte JMAP ni librerías externas. El orden interno es D-01, primitives D-03, D-02, D-04, D-05, D-06, D-07 y D-08. D-09 no se materializa hasta su decisión.

### 1-B — Verificación y freeze de Domain

Comprobar identidades scoped, ausencia de row IDs, completitud de Email, null semántico de addresses, separación Composer/SendIntent/PendingMutation, rights exactos, ViewKey semántica, separación collection/query state e inFlight con outcome incierto. Solo después de superar este gate Domain queda disponible para consumers.

### Criterio de salida

* Domain compila y se verifica de forma aislada.
* No contiene infraestructura, DTOs de transporte ni estados Application.
* No adapta sus invariantes a `0001`.
* D-09 y las representaciones concretas deliberadamente abiertas permanecen sin improvisar.

## 7. Fase 2 — Ports y adapters

### Gate de entrada

Domain implementado y verificado.

### 2-A — Ports

Diseñar y materializar `ReadRepository` y `SyncPort` sobre el vocabulario Domain ya congelado. Las firmas no pueden introducir row IDs, DTOs JMAP, Emails parciales, hashes como identidad de View ni payloads semánticamente arbitrarios.

### 2-B — Adapters y conformance doubles

Implementar adapters memory y la suite observable. Después se materializan los adapters Tauri contra la misma semántica, sin diseñar SQL ni JMAP dentro de TypeScript adapters.

### Criterio de salida

* Ports dependen solo de Domain y errores propios del contrato.
* Adapters satisfacen Ports sin alterar las identidades o invariantes.
* Domain permanece sin dependencias hacia consumers.

## 8. Fase 3 — Local Engine e integración remota

### 3-A — Rust Local Engine y persistencia

Implementar SQLCipher lifecycle, migrations posteriores a `0001` cuando correspondan, mapping entre identities Domain y surrogates físicas, queries, transacciones, comandos semánticos y eventos. `0001` no se reescribe para simular alineación.

Las dos atomicidades obligatorias son:

* optimistic local projection + `PendingMutation`;
* remote batch + nuevo `CollectionSyncCursor.state`.

### 3-B — JMAP, Coordinator y Outbox

El JMAP Client normaliza DTOs parciales antes de producir Domain. Coordinator separa collection state de View queryState y trata `cannotCalculateChanges` mediante refetch/rebase scoped. Outbox procesa las tres familias discriminadas, conserva `SendIntent` y reconcilia un Send inFlight antes de cualquier retry potencialmente duplicado.

### 3-C — Application y Presentation integration

Conectar Vue/Pinia con `ReadRepository`, Tauri adapters y Local Engine. La UI relee SQLite mediante `onChange`, mantiene Composer efímero y nunca consume respuestas JMAP directamente.

## 9. Fase 4 — aceptación Tauri

Validar recibir/abrir/sync, redactar/encolar/enviar, offline/restart/logout, cache reset advertido, SQLCipher fail-closed, token memory-only y render HTML seguro.

### Criterio de salida del MVP

* Toda lectura visible procede de SQLite local; JMAP nunca bloquea la UI.
* Las dos atomicidades y la reconciliación segura de Send están probadas.
* No existe fake Email, row ID en Domain ni fallback plaintext.
* DEK, token, HTML hostil, drafts y attachments respetan sus fronteras vigentes.

## 10. Tabla de trazabilidad de los componentes

| Componente | Construcción principal | Integración / aceptación |
| --- | --- | --- |
| Domain | **Fase 1 · 1-A/1-B** | Base de Ports y todas las integraciones |
| `ReadRepository` + `SyncPort` | **Fase 2 · 2-A** | Adapters; Fase 3; aceptación |
| Memory/Tauri adapters | **Fase 2 · 2-B** | Local Engine y conformance |
| Presentación segura (Vue 3) | Consumidor posterior a Domain/Ports | Fase 3-C; aceptación |
| Estado de aplicación (Pinia) | Consumidor posterior a Domain/Ports | Fase 3-C; aceptación |
| Motor Tauri/Rust | **Fase 3 · 3-A** | 3-B/3-C; aceptación |
| Motor Web/OPFS | **MOVED TO FUTURE WEB ITERATION** | No participa en el MVP Tauri |
| Cliente JMAP | **Fase 3 · 3-B** | Aceptación remota |
| Coordinador de sincronización | **Fase 3 · 3-B** | Aceptación receive/sync |
| Procesador de Pending Mutations | **Fase 3 · 3-B** | Aceptación send |

## 11. Registro de decisiones vigente

### De `docs/architecture/components.md`

| ID | Estado actual | Resultado / destino |
| --- | --- | --- |
| C-01 | **RESOLVED · 0-A** | JMAP/Coordinator/Outbox TypeScript únicos. |
| C-02 | **RESOLVED · 0-C FOR TAURI MVP** | Ciclos local/remoto independientes y recuperación local definida. |
| C-03 | **RESOLVED · 0-D** | Vocabulario de `runtime`, `mail` y `composer` fijado. |
| C-04 | **RESOLVED · 0-D** | Draft memory-only; sin autosave/JMAP/persistencia. |
| C-05 | **BOUNDARY RESOLVED · PORTS PENDING** | Consumers y dirección de Ports están fijados; firmas, errores y suite se materializan después del Domain freeze. |
| C-06 | **SPLIT** | Lifecycle local resuelto en 0-C; modelo de tareas/hilos es detalle de implementación del Local Engine. |
| C-07 | **PHYSICAL BASELINE PRESENT** | `0001_initial.sql` es histórico y mínimo; migrations futuras, runner y runtime siguen en Fase 3-A. |
| C-08 | **RESOLVED · 0-A** | JMAP Tauri corre en Worker TS directo. |
| C-09 | **MOVED TO FUTURE WEB ITERATION** | Coordinación Web/multi-tab no bloquea MVP. |
| C-10 | **MOVED TO FUTURE WEB ITERATION** | SQLCipher/OPFS, cuotas y corrupción Web diferidos. |
| C-11 | **MOVED TO FUTURE WEB ITERATION** | Runtime JMAP `SharedWorker` futuro conservado. |
| C-12 | **MOVED TO 3-B** | Prioridades, batching, backoff, queryChanges y rebase scoped. |
| C-13 | **RESOLVED · D-08** | Ciclo durable conserva outcome incierto; cleanup exacto queda para reconciliación Outbox. |
| C-14 | **OPEN · 3-B** | Algoritmo de idempotencia/reconciliación de Send pertenece a Outbox. |
| C-15 | **RESOLVED · 0-C** | Token JMAP solo en memoria del Worker. |

### De `docs/architecture/domain.md`

| ID | Estado actual | Resultado / destino |
| --- | --- | --- |
| D-01 | **FROZEN / DOCUMENTED** | `AccountKey`, `ServiceKey`, `RemoteAccountRef`, scoped IDs y separación de row IDs. |
| D-02 | **FROZEN / DOCUMENTED** | Email remoto confirmado con metadata mínima completa; partial DTO no es Email. |
| D-03 | **FROZEN / DOCUMENTED** | `EmailAddress`, listas nullable con ausencia conocida y Message-ID family fuera del core. |
| D-04 | **FROZEN / DOCUMENTED** | Identity autorizada y flow Composer → SendIntent → SendMutation. |
| D-05 | **FROZEN / DOCUMENTED** | Mailbox scoped, parent canónico, counts remotos y seis rights MVP. |
| D-06 | **FROZEN / DOCUMENTED** | ViewSpec semántica, queryState por vista y coverage parcial válida. |
| D-07 | **FROZEN / DOCUMENTED** | `CollectionSyncCursor = AccountKey + DataType + opaque state`; diagnóstico separado. |
| D-08 | **FROZEN / DOCUMENTED** | Tres familias PendingMutation, MutationId local e inFlight con outcome incierto. |
| D-09 | **OPEN** | Completitud y representación final de `EmailBody`; no se materializa todavía. |

### De `docs/architecture/security.md` y overview

| ID | Estado actual | Resultado / destino |
| --- | --- | --- |
| S-01 | **SPLIT** | Recuperación de caché local resuelta; recuperación de cuenta/passkey queda fuera del cliente. |
| S-02 | **OUT OF CLIENT SCOPE** | Seguridad interna del servidor no bloquea este roadmap. |
| O-01 | **MOVED TO FUTURE WEB ITERATION** | Custodia de credenciales Web no bloquea el MVP Tauri. |

### OPEN de implementación que no reabren Gate 0

| ID | Debe cerrarse en | Razón |
| --- | --- | --- |
| D-09 | **Decisión posterior de Domain** | Completitud y representación final de `EmailBody`. |
| PORTS-01 | **Fase 2-A** | Firmas, errores, receipts y operaciones concretas de `ReadRepository`/`SyncPort`. |
| PERSISTENCE-01 | **Fase 3-A** | Mapping físico, migrations posteriores y codecs sin modificar `0001`. |
| OUTBOX-01 | **Fase 3-B** | Idempotencia/reconciliación de Send con outcome ambiguo y conflictos concurrentes. |
| COORD-01 | **Fase 3-B** | Aplicación de queryChanges, movimientos de posiciones y rebase scoped. |
| AUTH-01 | **Antes de aceptación** | Callback exacto navegador del sistema→aplicación; frontera y custodia ya decididas. |
| STACK-01 | **Antes de completar 3-A** | Provisioning/packaging de SQLCipher `4.17.0` en Windows, macOS y Linux. |
| STACK-02 | **Durante 3-B** | Conformance de `jmap-jam 0.13.3`; candidato no instalado ni congelado. |
| STACK-03 | **Antes de release** | Versiones mínimas OS/WebView y target explícito de Vite. |
| STACK-04 | **Durante 3-A / antes de aceptación** | Secret Service Linux y stores explícitos por plataforma. |

## 12. Trabajo deliberadamente diferido

* **Web/PWA:** wa-sqlite, OPFS, SQLCipher Web, credenciales en navegador, multi-tab, `SharedWorker` y aceptación del adaptador.
* **Producto posterior:** drafts durables/JMAP; caché, descarga, guardado, subida, envío y CID inline de adjuntos.
* **Compute-at-the-edge:** clasificación de spam y embeddings, opcional y apagado por defecto.
* **Fuera del cliente:** lógica del servidor, proveedor real, IMAP/SMTP y recuperación de cuenta Passkey.

No se crea aquí un backlog detallado para esos ámbitos y ninguno actúa como blocker del MVP Tauri.
