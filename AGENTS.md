# AGENTS.md

## Propósito de este repositorio

Este repositorio contiene el **cliente** de un sistema de correo local-first cliente/servidor. El servidor vive aparte y está fuera de alcance aquí — no implementes lógica de servidor, IMAP/SMTP entrante, ni nada que corresponda al VPS.

Si este es tu primer paso y el repositorio está vacío o casi vacío, tu tarea es **proponer la estructura base** siguiendo exactamente el stack ya decidido más abajo — no elegir un stack alternativo, por conocido o cómodo que te resulte.

## Fuentes de verdad (léelas antes de escribir código)

Estos documentos son autoritativos, con prioridad sobre cualquier inferencia que hagas del código existente — el proyecto está en etapa temprana y el código todavía no refleja todas las decisiones:

- `docs/architecture/overview.md` — filosofía y decisiones de arquitectura del cliente.
- `docs/architecture/security.md` — modelo de amenazas y capas de defensa obligatorias.
- `docs/diagrams/layers-components.mmd`, `docs/architecture/domain.md`, `docs/architecture/components.md` — detalle de capas, dominio y componentes; genera código que los implemente, no que los reinterprete.
- `docs/planning/roadmap.md` — secuencia de implementación vigente y estado formal de Gates.
- `docs/development/stack.md` — baseline exacta de versiones, dependencias y PoCs abiertos; deriva de `docs/research/secure-compatible-version-baseline.md`.

Si encuentras una decisión que no está en ninguno de estos documentos, márcala como pregunta abierta en tu respuesta — no la resuelvas inventando algo nuevo.

## Alcance

- Solo cliente. Sin lógica de servidor.
- El MVP actual es **Tauri-only**. Web/PWA está diferido: conserva su arquitectura futura, pero no se implementa ni bloquea la aceptación actual.
- La Fase 2 (compute-at-the-edge: clasificación de spam, embeddings de búsqueda) queda fuera de alcance salvo que se pida explícitamente en la tarea puntual — no la implementes "por si acaso" ni dejes stubs sin que se solicite.

## Stack tecnológico ya decidido

- **UI y estado:** Vue 3, Composition API, TypeScript y Pinia.
- **Entrega del MVP — Tauri v2:** backend en Rust, acceso nativo a SQLite + SQLCipher (sin WASM ni OPFS).
- **Entrega futura — Web/PWA:** conserva la dirección `wa-sqlite`/OPFS, pero sus decisiones de cifrado, credenciales, multi-tab y `SharedWorker` están diferidas.
- **Abstracción de storage:** `ReadRepository` sirve a Pinia/UI y `SyncPort` a Coordinador/Outbox. El código Vue/Pinia nunca importa directamente el motor.
- **Protocolo hacia el servidor:** JMAP real sobre HTTPS + WebSocket para push. No implementes un RPC propio ni asumas otro protocolo.
- **Runtime de red/sync:** Cliente JMAP, Coordinador y Outbox son TypeScript en un Worker normal del webview Tauri; hablan JMAP directo. Rust solo administra SQLite, SQLCipher y secretos locales.

## Seguridad — invariantes que no se negocian

- Todo HTML de correo se sanitiza con DOMPurify en cada render y se muestra dentro de un `iframe sandbox` bajo CSP restrictiva; no se persiste HTML sanitizado ni se habilitan recursos remotos.
- Las ventanas de Tauri se configuran con el mínimo de capabilities necesario — nunca agregues un permiso "por si se necesita después".
- La DEK SQLCipher es aleatoria, reside en el secure store del SO y solo la usa Rust; no se deriva del Passkey ni cruza IPC.
- Passkeys/WebAuthn autentican remotamente desde el navegador del sistema. El token JMAP vive solo en memoria del Worker, nunca en Pinia, SQLite, `localStorage`, archivos o logs.
- No existe fallback a SQLite en texto plano.
- Antes de cerrar cualquier tarea que toque autenticación, storage local o renderizado de contenido externo, revisa que siga cumpliendo `docs/architecture/security.md`.

## Convenciones de código

- TypeScript estricto en toda la capa Vue/Pinia.
- Los métodos de `ReadRepository`/`SyncPort` se mantienen compatibles con la suite de conformidad. En el MVP se implementan en Tauri; cualquier cambio debe seguir siendo expresable por el futuro adaptador Web sin obligar a implementarlo ahora.
- TypeScript/Vue usa ESLint flat config y Prettier; Rust usa rustfmt y Clippy con warnings como error.
- Las dependencias directas se fijan exactamente y los lockfiles se versionan. No autorices scripts de instalación ni debilites protecciones de pnpm globalmente.
- SQLCipher es externo `4.17.0` mediante el feature `rusqlite/sqlcipher`; no uses `bundled-sqlcipher` ni SQLite plaintext.
- `jmap-jam 0.13.3` es candidato de PoC, no dependencia autorizada hasta completar conformance contra Stalwart.

## Entorno de desarrollo y comandos

Usa `docs/development/setup.md`. La interfaz humana principal es `pnpm check`; desarrollo completo usa `pnpm dev` y frontend aislado `pnpm dev:frontend`.

## Pruebas

Ejecuta `pnpm check`. Incluye formato, typecheck, lint, Vitest, rustfmt, Clippy y Cargo tests. Mientras el PoC de provisioning SQLCipher esté abierto, reporta los comandos nativos bloqueados; nunca los sustituyas por un backend plaintext. La futura entrega Web definirá su propia matriz cuando entre en alcance.

## Nota operativa de modelo

Este archivo está pensado para agentes corriendo sobre GPT-5.6 en Codex. Para tareas de diseño/arquitectura (como generar o revisar los entregables de capas, dominio y componentes) usa el tier **Sol**. Para implementación rutinaria una vez el diseño ya está fijado, **Terra** es suficiente y más rápido.
