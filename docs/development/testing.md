# Estrategia de testing

## TypeScript y Vue

Vitest es el runner unitario. Vue Test Utils se usa para component tests que necesiten el DOM; no se añade jsdom ni otro runtime DOM hasta que exista ese caso concreto.

La suite debe crecer en cuatro niveles:

1. unitarios de dominio, stores, Coordinator y Outbox;
2. smoke/component tests de Vue + Pinia;
3. conformance tests reutilizables para `ReadRepository` y `SyncPort`;
4. integración Tauri cuando exista el adaptador real.

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
