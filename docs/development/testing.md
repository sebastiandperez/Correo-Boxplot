# Estrategia de testing

## Contract testing de Ports

TEST-00→TEST-06 están **COMPLETE** y el audit final de MEM-01 está en **PASS**. `MemoryLocalEngine` pasa 179/179 escenarios portables —45 P-01, 91 P-02, 23 P-03 y 20 sistémicos— más 18/18 escenarios específicos de hardening. La arquitectura normativa vive en [port-contract-testing.md](../testing/port-contract-testing.md). La suite del Local Engine queda cerrada para el alcance MVP actual.

La especificación ejecutable se escribe antes de la implementación: contract specification → abstract harness → reusable suites → implementation-under-test. `MemoryLocalEngine` es el primer IUT conformant y no redefine las suites.

Los niveles congelados son:

1. type contracts de Domain y Ports;
2. runtime contracts reutilizables por Port;
3. contrato sistémico P-02 commit → P-03 invalidation → P-01 reread;
4. controles opcionales de faults/races/restart/corruption;
5. integración adapter/persistencia;
6. E2E Tauri.

TEST-01 materializó harness, fixtures, assertions y notification recorder. TEST-02 materializó P-01; TEST-03A/TEST-03B, P-02; TEST-04, P-03; TEST-05, la composición sistémica reusable; TEST-06 endurece exclusivamente Memory. MEM-01 implementa los tres Ports sobre un único estado in-memory compartido y tiene conformance final. [PERSIST-01](../architecture/persistence-01-design.md) añade pruebas Rust nativas de migración, presencia, transacciones, reinicio, corrupción y SQLCipher. [IPC-00](../architecture/ipc-contract.md) congela y verifica el wire TypeScript↔Rust, los 25 comandos y el evento post-commit. TAURI-ADAPTERS-01 completa la traducción pura de P-01/P-02/P-03 mediante `LocalEngineIpcClient`. PROD-CONFORMANCE-01 ejecuta las mismas suites contra el webview Tauri, handlers Rust y base SQLCipher temporal reales: 179/179 PASS, más 5/5 smokes productivos. JMAP continúa fuera.

La conformance productiva del runtime soportado se ejecuta con `pnpm test:production-conformance`. En Linux requiere `tauri-driver` y `WebKitWebDriver`; en Windows usa `tauri-driver` con el EdgeDriver que coincida exactamente con Microsoft Edge mediante `TAURI_NATIVE_WEBDRIVER`. SQLCipher procede del source pin del repositorio, no de un paquete del host. No usa sleeps para `settle()` ni incorpora comandos de lifecycle al binario productivo normal. WINDOWS-NATIVE-ACCEPTANCE-01 volvió a ejecutar el mismo corpus en Windows/MSVC: 45 P-01 + 91 P-02 + 23 P-03 + 20 sistémicos = 179/179, además de 5/5 smokes.

SECURE-BOOTSTRAP-01 añade pruebas Rust deterministas para la matriz DEK/DB, recuperación del marker de creación, reset reanudable en cada fase, lifecycle compartido/exclusivo, ordering commit→evento y lock real entre procesos. El smoke del credential store nativo se ejecuta separadamente con `cargo test --manifest-path src-tauri/Cargo.toml host_os_dek_store_smoke -- --ignored --nocapture`; usa un namespace de prueba único y siempre intenta cleanup. Un host sin D-Bus/Secret Service usable se registra como `ENVIRONMENT BLOCKED`, nunca activa un fallback.

LOCAL-SECURE-STORE-01 añade contratos de configuración/flavor, guards sin side effects, aislamiento de `CacheIdentity`, codec Linux V1/Legacy V0, especificación Windows Local y el binario `local-env-doctor`. En el host Arch GNOME/Wayland, doctor CHECK, smoke real, bootstrap Development, reopen y persistencia semántica están en PASS. En el host Windows/MSVC certificado, doctor CHECK, smoke aislado, persistencia Credential Manager `Local`, bootstrap/reopen Development desde build y desde NSIS instalado están en PASS.

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

* `PRAGMA cipher_version` es exactamente `4.17.0 community`;
* `sqlite_version()` es exactamente `3.53.3`;
* apertura con la clave correcta y rechazo con una incorrecta;
* archivo no reconocible como SQLite plaintext;
* close/reopen conservando datos;
* `cipher_integrity_check`;
* rollback/atomicidad;
* migraciones sobre fixtures cifradas de versiones anteriores.

SQLCIPHER-PACKAGING-01 cerró el provisioning Linux y Windows x86_64 MSVC. `src-tauri/tests/sqlcipher_baseline.rs` verifica identidad exacta/cifrado/wrong-key y `sqlcipher_compatibility.rs` abre una fixture real 4.14.0 con la misma DEK bajo 4.17.0, lee, escribe y reabre sin reset ni rekey. `scripts/check-sqlcipher-vendor.sh` valida hashes y drift del vendor. La aceptación Linux verificó el DEB y Secret Service; WINDOWS-NATIVE-ACCEPTANCE-01 verificó el NSIS instalado, Credential Manager Local, reapertura, cabecera cifrada y enlace PE estático.

## JMAP

`jmap-jam` no está instalado. Su spike deberá ejecutarse contra Stalwart antes de adoptarlo y cubrir Session, Mailbox, Email, `*/changes`, batching/result references, EmailSubmission y reconexión push. Los tipos del candidato no pueden aparecer en dominio ni puertos propios.

## E2E

Playwright, Selenium y Cypress están diferidos. Se elegirá infraestructura E2E cuando exista un recorrido vertical y una matriz mínima de WebView/OS. Hasta entonces no resuelven un problema actual.

## Verificación completa

```bash
pnpm check
```

Este comando encadena formato, typecheck, lint, tests TypeScript, rustfmt, Clippy y tests Rust. Un bloqueo de SQLCipher debe reportarse expresamente; no equivale a éxito.
