# Estrategia de testing

## Contract testing de Ports

TEST-00→TEST-04 están **COMPLETE** y MEM-01 está **IMPLEMENTED**. `MemoryLocalEngine` pasa 159/159 escenarios: 45 de `ReadRepository`, 91 de `SyncPort` y 23 de `LocalChangeSource`. La arquitectura normativa vive en [port-contract-testing.md](../testing/port-contract-testing.md). P-01, P-02 y P-03 están cerrados individualmente; Ports como fase todavía no está cerrado porque TEST-05 y el audit final permanecen diferidos.

La especificación ejecutable se escribe antes de la implementación: contract specification → abstract harness → reusable suites → implementation-under-test. `MemoryLocalEngine` es el primer IUT conformant y no redefine las suites.

Los niveles congelados son:

1. type contracts de Domain y Ports;
2. runtime contracts reutilizables por Port;
3. contrato sistémico P-02 commit → P-03 invalidation → P-01 reread;
4. controles opcionales de faults/races/restart/corruption;
5. integración adapter/persistencia;
6. E2E Tauri.

TEST-01 materializó harness, fixtures, assertions y notification recorder. TEST-02 materializó `defineReadRepositoryContract(...)`; TEST-03A/TEST-03B materializaron las dos suites de `SyncPort` y su agregador final; TEST-04 materializó `defineLocalChangeSourceContract(...)`. MEM-01 implementa los tres Ports sobre un único estado in-memory compartido y está conformant con las suites actuales. Esto no prueba durabilidad de disco, SQLCipher, transacciones SQLite, crash safety, IPC/Tauri, JMAP, fault injection ni scheduler interleavings deterministas.

## TypeScript y Vue

Vitest es el runner unitario. Vue Test Utils se usa para component tests que necesiten el DOM; no se añade jsdom ni otro runtime DOM hasta que exista ese caso concreto.

Además de los seis niveles contractuales, continúan los tests unitarios de Domain, stores, Coordinator y Outbox, y los smoke/component tests de Vue + Pinia cuando exista un consumidor real.

```bash
pnpm test
pnpm test:watch
pnpm typecheck
```

El smoke actual monta un componente de prueba con un renderer de Vue sin DOM externo, inicializa Pinia y comprueba una proyección de runtime. `App.vue` queda cubierto por `vue-tsc` y el build de Vite hasta que un caso real justifique añadir un runtime DOM.

## Rust

Rust usa el test harness de Cargo:

```bash
pnpm test:rust
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

Debe cubrir crate, errores tipados, queries, migraciones y las invariantes:

```text
cambio optimista + PendingMutation = una transacción
cambios remotos + nuevo SyncCursor = una transacción
```

## SQLCipher

La capacidad del entorno de desarrollo se prueba sin mocks:

* `PRAGMA cipher_version` devuelve un valor no vacío de SQLCipher `4.x`;
* `sqlite_version()` se consulta y muestra como diagnóstico, sin igualdad exacta local;
* apertura con la clave correcta y rechazo con una incorrecta;
* archivo no reconocible como SQLite plaintext;
* close/reopen conservando datos;
* `cipher_integrity_check`;
* rollback/atomicidad;
* migraciones sobre fixtures cifradas de versiones anteriores.

La aceptación del artefacto de **release** añade la comprobación exacta SQLCipher `4.17.0` + SQLite `3.53.3`. Su provisioning reproducible continúa **OPEN — SQLCipher provisioning PoC**. El test local está en `src-tauri/tests/sqlcipher_baseline.rs`; no se cambia a SQLite plaintext para hacerlo pasar.

## JMAP

`jmap-jam` no está instalado. Su spike deberá ejecutarse contra Stalwart antes de adoptarlo y cubrir Session, Mailbox, Email, `*/changes`, batching/result references, EmailSubmission y reconexión push. Los tipos del candidato no pueden aparecer en dominio ni puertos propios.

## E2E

Playwright, Selenium y Cypress están diferidos. Se elegirá infraestructura E2E cuando exista un recorrido vertical y una matriz mínima de WebView/OS. Hasta entonces no resuelven un problema actual.

## Verificación completa

```bash
pnpm check
```

Este comando encadena formato, typecheck, lint, tests TypeScript, rustfmt, Clippy y tests Rust. Un bloqueo de SQLCipher debe reportarse expresamente; no equivale a éxito.
