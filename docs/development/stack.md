# Stack técnico canónico

Este documento conserva la decisión operativa del stack; el razonamiento exhaustivo permanece en el informe de investigación enlazado abajo.

> Version baseline derived from:  
> `docs/research/secure-compatible-version-baseline.md`  
> Baseline date: **2026-08-13**

## Alcance actual

El MVP es **Tauri-only**. Web/PWA, OPFS, wa-sqlite, `SharedWorker` y multi-tab están diferidos y no son requisitos ni dependencias de esta iteración.

```text
Vue / Pinia → ReadRepository → Tauri adapter → semantic invoke → Rust → SQLite + SQLCipher

JMAP → Coordinator → SyncPort → Tauri adapter → semantic invoke → Rust → SQLite
SQLite → onChange → ReadRepository → Pinia → Vue

Composer → PendingMutation → Outbox → JMAP
```

TypeScript contiene Vue, Pinia, contratos, Application, cliente JMAP, Coordinator y Outbox. Rust contiene Tauri, SQLite/SQLCipher, migraciones, queries, transacciones, secure store, IPC mínimo y, exclusivamente como traductor IMAP→JMAP (ADR-007), el cliente TCP/TLS saliente de `src-tauri/src/net/`. JMAP usa `fetch`/WebSocket desde TypeScript; Rust no es proxy HTTP genérico y la UI no ejecuta SQL. La excepción de ADR-007 no convierte a Rust en un proxy HTTP: solo traduce IMAP/SMTP a la forma JMAP detrás del mismo puerto `JmapClient`.

## Baseline exacta

| Área | Componente | Versión | Clasificación |
| --- | --- | ---: | --- |
| Toolchain | Node.js | `24.19.0` LTS | REQUIRED NOW |
| Toolchain | pnpm | `11.20.0` | REQUIRED NOW |
| Frontend | Vue | `3.5.41` | REQUIRED NOW |
| Frontend | Pinia | `4.0.3` | REQUIRED NOW |
| Frontend | `@vue/devtools-api` | `8.1.5` | REQUIRED NOW; peer de Pinia |
| Frontend | DOMPurify | `3.4.13` | REQUIRED NOW |
| Build | Vite | `8.2.1` | REQUIRED NOW |
| Build | `@vitejs/plugin-vue` | `6.0.8` | REQUIRED NOW |
| Language | TypeScript | `6.0.3` | REQUIRED NOW |
| Typecheck | `vue-tsc` | `3.3.9` | REQUIRED NOW |
| Tests | Vitest | `4.1.10` | REQUIRED NOW |
| Tests | Vue Test Utils | `2.4.11` | REQUIRED NOW |
| Lint | ESLint | `10.8.1` | REQUIRED NOW |
| Lint | `typescript-eslint` | `8.67.0` | REQUIRED NOW |
| Lint | `eslint-plugin-vue` | `10.10.0` | REQUIRED NOW |
| Format | Prettier | `3.9.6` | REQUIRED NOW |
| Tauri JS | `@tauri-apps/api` | `2.11.1` | REQUIRED NOW |
| Tauri CLI | `@tauri-apps/cli` | `2.11.4` | REQUIRED NOW |
| Native | Rust | `1.97.1` | REQUIRED NOW |
| Native | `tauri` | `2.11.5` | REQUIRED NOW |
| Native build | `tauri-build` | `2.6.3` | REQUIRED NOW; genera el contexto Tauri |
| Database | `rusqlite` | `0.40.2` | REQUIRED NOW |
| Serialization | `serde` | `1.0.228` | REQUIRED NOW |
| Errors | `thiserror` | `2.0.20` | REQUIRED NOW |
| Encryption | SQLCipher | `4.17.0 community` | PINNED/BUNDLED; Linux verified, Windows acceptance pending |
| Database | SQLite dentro de SQLCipher | `3.53.3` | PINNED/BUNDLED; Linux verified, Windows acceptance pending |
| JMAP | `jmap-jam` | `0.13.3` | OPEN / REQUIRES POC; no instalado |

Los patches de Tauri Rust, API JS y CLI son distintos de forma deliberada: se publican independientemente.

## SQLCipher

`rusqlite 0.40.2` usa `bundled-sqlcipher-vendored-openssl` sobre el patch local mínimo de `libsqlite3-sys 0.38.2`. El patch sustituye exclusivamente los artefactos SQLCipher por el source oficial `v4.17.0`, bindings pregenerados correspondientes y el backport oficial del issue `#600`. Está prohibido sustituir el motor por SQLite plaintext o descubrir SQLCipher/OpenSSL del host.

**Development capability:** Development y release seleccionan el mismo source/provider pinned. El opener exige exactamente `4.17.0 community` y SQLite `3.53.3`; la suite demuestra cifrado real, reapertura, rechazo de clave incorrecta y compatibilidad con una DB 4.14.

**Release baseline:** el artefacto distribuible debe afirmar:

```text
PRAGMA cipher_version = 4.17.0 community
sqlite_version()      = 3.53.3
```

**Packaging status:** Linux x86_64 build, DEB, dependency audit y package-level acceptance están verificados. Windows x86_64 MSVC conserva build/package/runtime/Credential Manager acceptance pendiente en un host Windows real. macOS packaging está fuera del alcance de SQLCIPHER-PACKAGING-01.

## JMAP

`jmap-jam 0.13.3` es el candidato preferido, no una dependencia congelada. Se añadirá solo al iniciar el spike contra Stalwart para Session, Mailbox/Email, `*/changes`, batching/result references, EmailSubmission y reconexión push.

Coordinator y Outbox dependen siempre de una interfaz JMAP propiedad del proyecto. Ningún tipo de `jmap-jam` puede filtrarse al dominio.

## Testing

* TypeScript: Vitest para unitarios y conformidad; Vue Test Utils para componentes cuando exista una necesidad de DOM concreta.
* Rust: `cargo test` para crate, DB, migraciones y atomicidad.
* SQLCipher: versión, clave correcta/incorrecta, encabezado no plaintext, close/reopen, integridad, transacciones y migraciones.
* E2E pesado: diferido hasta existir un recorrido integrado y una matriz de WebViews; no se instala Playwright/Selenium/Cypress ahora.

## Pinning y supply chain

* Toolchains y dependencias directas usan versiones exactas.
* `pnpm-lock.yaml` y `Cargo.lock` se versionan y no se editan manualmente.
* CI usa `pnpm install --frozen-lockfile` y Cargo con `--locked`.
* No se desactivan las protecciones de release age, lockfile ni scripts de instalación de pnpm 11.
* Un install script solo se autoriza tras revisión y con una excepción específica documentada.
* Upgrades ocurren en PRs deliberados; SQLCipher/rusqlite exige fixtures cifradas y builds en los tres sistemas.

## Política de dependencias

Una dependencia debe resolver un problema actual. No se incorporan por anticipación Axios, Lodash, RxJS, TanStack Query, Vue Router, UI frameworks, ORMs, SQLx, Tokio directo, `anyhow`, `serde_json`, plugins HTTP/WebSocket de Tauri, frameworks E2E pesados ni validadores de schema. Excepción ADR-007: `src-tauri/src/net/` puede incorporar crates de TLS/IMAP/SMTP/parsing MIME con versión exacta pinneada y justificación en este documento cuando se elijan; sigue sin autorizarse un plugin HTTP/WebSocket de Tauri ni Tokio como runtime async del resto del backend.

Secure-store crates se difieren hasta implementar el ciclo DEK. La estrategia prevista antes de release es `keyring-core` con stores explícitos por plataforma; Linux Secret Service requiere PoC propio.

## OPEN técnicos

* Provisioning/packaging reproducible de SQLCipher `4.17.0` en las tres plataformas.
* Conformance de `jmap-jam 0.13.3` contra Stalwart.
* Versiones mínimas Windows/macOS/Linux, WebView y target de Vite.
* Disponibilidad/desbloqueo del secure store en las distribuciones Linux soportadas.
* Callback de autenticación desde navegador del sistema hacia Tauri.
* Elección y pinning exacto de crates TLS/IMAP/SMTP para `src-tauri/src/net/` (ADR-007); conformance de la traducción contra un servidor IMAP/SMTP real cuando exista.
