# AGENTS.md

## Propósito de este repositorio

Este repositorio contiene el **cliente** de un sistema de correo local-first cliente/servidor. El servidor vive aparte y está fuera de alcance aquí — no implementes lógica de servidor, IMAP/SMTP entrante, ni nada que corresponda al VPS.

Si este es tu primer paso y el repositorio está vacío o casi vacío, tu tarea es **proponer la estructura base** siguiendo exactamente el stack ya decidido más abajo — no elegir un stack alternativo, por conocido o cómodo que te resulte.

## Fuentes de verdad (léelas antes de escribir código)

Estos documentos son autoritativos, con prioridad sobre cualquier inferencia que hagas del código existente — el proyecto está en etapa temprana y el código todavía no refleja todas las decisiones:

- `cliente-01-overview.md` — filosofía y decisiones de arquitectura del cliente.
- `security.md` — modelo de amenazas y capas de defensa obligatorias.
- `capas-componentes-diagrama.mmd`, `dominio.md`, `componentes.md` — si ya existen, son el detalle de capas, dominio y componentes especificado; genera código que los implemente, no que los reinterprete.

Si encuentras una decisión que no está en ninguno de estos documentos, márcala como pregunta abierta en tu respuesta — no la resuelvas inventando algo nuevo.

## Alcance

- Solo cliente. Sin lógica de servidor.
- La Fase 2 (compute-at-the-edge: clasificación de spam, embeddings de búsqueda) queda fuera de alcance salvo que se pida explícitamente en la tarea puntual — no la implementes "por si acaso" ni dejes stubs sin que se solicite.

## Stack tecnológico ya decidido

- **UI y estado:** Vue 3, Composition API, TypeScript, Pinia. Compartido íntegramente entre las dos formas de entrega.
- **Entrega 1 — Tauri:** backend en Rust, acceso nativo a SQLite (sin WASM, sin OPFS).
- **Entrega 2 — Web/PWA:** `wa-sqlite` sobre OPFS, instalable.
- **Abstracción de storage:** ambas entregas quedan detrás de una interfaz común tipo Repository (ej. `listMessagesForView`, `ensureFolderWindow`). El código de UI/Pinia nunca importa directamente el motor de storage — siempre pasa por esa interfaz.
- **Protocolo hacia el servidor:** JMAP real sobre HTTPS + WebSocket para push. No implementes un RPC propio ni asumas otro protocolo.

## Seguridad — invariantes que no se negocian

- Todo HTML de correo se sanitiza con DOMPurify antes de insertarse en el DOM, sin excepción.
- Las ventanas de Tauri se configuran con el mínimo de capabilities necesario — nunca agregues un permiso "por si se necesita después".
- Las credenciales usan el mecanismo definido en `security.md` (keychain nativo en Tauri, passkeys/WebAuthn para login) — nunca en texto plano ni en `localStorage`.
- Antes de cerrar cualquier tarea que toque autenticación, storage local o renderizado de contenido externo, revisa que siga cumpliendo `security.md`.

## Convenciones de código

- TypeScript estricto en toda la capa Vue/Pinia.
- Los métodos de la interfaz Repository se mantienen consistentes entre ambas entregas — si agregas uno nuevo, impleméntalo en los dos motores (Tauri/Rust y Web/OPFS), no en uno solo.
- `[PENDIENTE]` Linter, formatter y reglas de estilo específicas aún no se han decidido. Si el repo ya tiene configuración de ESLint/Prettier/Clippy, esta línea queda obsoleta: sigue lo que el repositorio ya define, no lo que dice aquí.

## Entorno de desarrollo y comandos

`[PENDIENTE]` — se completa cuando exista el primer `package.json` / `src-tauri/Cargo.toml`. Si te toca crearlos, documenta aquí mismo los comandos reales (`dev`, `build`, `test`) una vez existan, para que la siguiente sesión de agente no tenga que redescubrirlos.

## Pruebas

`[PENDIENTE]`. Mínimo no negociable una vez exista infraestructura de build: cualquier cambio debe compilar correctamente en **ambas** entregas (Tauri y Web/PWA) antes de darse por terminado — no es válido que funcione en una y quede roto en la otra.

## Nota operativa de modelo

Este archivo está pensado para agentes corriendo sobre GPT-5.6 en Codex. Para tareas de diseño/arquitectura (como generar o revisar los entregables de capas, dominio y componentes) usa el tier **Sol**. Para implementación rutinaria una vez el diseño ya está fijado, **Terra** es suficiente y más rápido.