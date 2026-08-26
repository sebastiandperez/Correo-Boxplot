# ADR-007 — Traductor IMAP→JMAP in-process en Rust

**Status:** SUPERSEDED BY ADR-008

> Registro histórico. ADR-008 reemplaza el traductor IMAP→JMAP por
> `RemoteMail` + `Submission`. Esta decisión ya no autoriza implementación.

## Context

El proyecto requiere, como parte de su alcance obligatorio, dos protocolos de correo: JMAP (ya implementado en TypeScript, Fase 0-A/3-B) e IMAP/SMTP. No es una alternativa a JMAP ni un backend futuro — es un segundo camino que el cliente Tauri debe hablar realmente, ahora.

La arquitectura vigente antes de este ADR declara unánimemente que el networking de correo de Rust es *ninguno*: `AGENTS.md`, `docs/architecture/layers.md`, `docs/architecture/components.md`, `docs/architecture/security.md` y `docs/development/stack.md` afirman que JMAP corre íntegramente en TypeScript vía `fetch`/WebSocket desde el Worker, que Rust "no es proxy HTTP", y `stack.md` prohíbe explícitamente incorporar "Tokio directo" o plugins HTTP/WebSocket de Tauri.

Dos restricciones técnicas hacen insostenible seguir así para IMAP/SMTP:

1. **CSP del webview.** `src-tauri/tauri.conf.json` fija `connect-src 'self' ipc: http://ipc.localhost`, sin ningún origen `https:`/`wss:`, heredado sin cambios por los perfiles `dev`/`demo1`/`demo2`. El webview —y por tanto cualquier Worker TypeScript— no puede abrir una conexión de red externa aunque quisiera (documentado como hallazgo CSP-01 en `docs/architecture/security.md` §4 y `docs/planning/roadmap.md`).
2. **No existe API de sockets TCP en un webview.** IMAP y SMTP son protocolos de línea con estado sobre TCP/TLS. No hay forma de hablarlos desde JavaScript/TypeScript en un navegador o webview bajo ninguna circunstancia, con o sin CSP.

La única ubicación posible para un cliente IMAP/SMTP en esta arquitectura es un proceso nativo: Rust.

`docs/architecture/overview.md` ya reconoce que el servidor propio (Servidor-Boxplot) expone IMAP y SMTP estándar, "para que Apple Mail, apps de Android o cualquier cliente de terceros puedan usar la misma cuenta sin pasar por esta app". La novedad de esta decisión es que ahora **este mismo cliente** también los habla, como segunda vía junto a JMAP.

## Decision

Se añade un módulo Rust nuevo, `src-tauri/src/net/`, que implementa un traductor IMAP→JMAP: abre conexiones TCP/TLS hacia el servidor IMAP/SMTP y expone operaciones por comandos IPC que producen DTOs con la **misma forma** que las respuestas JMAP ya definidas en `src/jmap/types.ts`. El diseño detallado del módulo (estructura de archivos, modelo de concurrencia, mapeo de IDs UID↔JMAP) se resuelve por separado, no en este ADR.

En TypeScript, `src/jmap/client.ts::JmapClient` sigue siendo el **único puerto** que Coordinator y Outbox conocen. IMAP se implementa como un adaptador más de ese puerto (`ImapJmapAdapter implements JmapClient`), simétrico a `JamClientAdapter`. Coordinator y Outbox no contienen ni una rama por protocolo — no saben, ni necesitan saber, cuál de los dos adapters está detrás del puerto en un momento dado.

Excepción explícita a las invariantes de red existentes, a citar consistentemente donde se documente:

> Rust puede abrir conexiones TCP/TLS hacia servidores IMAP/SMTP **exclusivamente** como implementación del traductor IMAP→JMAP. Rust sigue sin hablar JMAP, sin custodiar el token JMAP y sin actuar como proxy HTTP genérico. La credencial IMAP vive solo en memoria del proceso Rust, nunca se persiste ni vuelve por IPC.

Esta es la **única** excepción autorizada a `AGENTS.md`; todo lo demás que el documento fija permanece vigente sin cambios: token JMAP memory-only en el Worker, DEK Rust-only, DOMPurify + iframe sandbox para HTML de correo, sin fallback a SQLite plaintext, capabilities mínimas, tipos estrictos, dependencias pinneadas exactas.

### Alternativas descartadas

1. **Proxy externo en un repositorio aparte** (documentado como blueprint en `Claude_context/imap_jmap_translator_plan.md`, escrito antes de esta decisión). Descartado porque deja al cliente Tauri hablando solo JMAP, incumpliendo el requisito explícito de que el propio cliente implemente los dos protocolos.
2. **Puente de sockets TCP crudos por IPC**, con IMAP/SMTP implementados íntegramente en TypeScript sobre un transporte genérico expuesto por Rust. Descartado porque traslada a TypeScript la complejidad de parsear un protocolo de línea con estado, sin reducir el área de cambio en `AGENTS.md` (Rust igual necesita abrir sockets) y complicando framing/backpressure sobre un canal IPC que no está pensado para eso.
3. **No implementar IMAP.** Descartado: contradice el requisito del proyecto.

## Why

La CSP y la ausencia de sockets TCP en el webview no dejan otra opción de ubicación para un cliente IMAP/SMTP que Rust. Hacerlo como traductor detrás del puerto `JmapClient` existente —en vez de introducir una abstracción paralela tipo `RemoteMail`— evita que Coordinator, Outbox y toda la capa de sincronización necesiten conocer el protocolo subyacente, y permite verificar ambos caminos con la misma suite de contrato (C2-16).

## Consequences

Documentos que pasan de "Rust no habla red de correo" a la excepción anterior:

| Archivo | Sección afectada |
| --- | --- |
| `AGENTS.md` | §Alcance, §Stack tecnológico, §Seguridad |
| `docs/architecture/layers.md` | Responsabilidades del Rust Local Engine; sección "Networking ownership" |
| `docs/architecture/components.md` | Descripción de "Qué NO hace" del Rust Local Engine |
| `docs/development/stack.md` | Descripción del reparto TypeScript/Rust; lista de dependencias no incorporadas por anticipación |
| `docs/architecture/security.md` | Frontera IPC/adaptadores; networking JMAP |
| `docs/architecture/overview.md` | Descripción del runtime JMAP/Coordinator/Outbox |

Obligaciones nuevas, concretas y verificables:

- `src-tauri/src/net/` es la única capa Rust que abre sockets salientes; no adquiere el `EngineLease` del motor de persistencia ni conoce `SyncPort`/`ReadRepository` — solo habla red y devuelve DTOs.
- Sin TLS solo se permite contra `127.0.0.1`/`localhost`; cualquier otro host exige TLS y falla cerrado.
- La credencial IMAP/SMTP nunca cruza de vuelta al Worker TypeScript más que como un handle opaco de sesión; no se serializa a JSON hacia el frontend.
- Cualquier dependencia Rust nueva (TLS, parsing IMAP/MIME) se fija con versión exacta (`=`) y se ejecuta con `--locked`, igual que el resto de `Cargo.toml`.
- `capabilities/main.json` y la CSP de `tauri.conf.json` no necesitan tocarse: toda la red pasa por comandos IPC ya cubiertos por los permisos existentes.

## Deferred work

- Estructura interna de `src-tauri/src/net/`, modelo de concurrencia, y el esquema de mapeo UID↔JMAP ID estable: se resuelven en un ADR o documento de diseño separado antes de escribir el módulo (C2-C).
- Conformance real contra un servidor IMAP/SMTP (Servidor-Boxplot) queda pendiente de que ese servidor exista; hasta entonces la traducción se valida con fakes deterministas.
- CSP-01 (permitir el origen JMAP real en `connect-src`) es un hallazgo relacionado pero independiente de este ADR — se resuelve cuando exista una URL concreta de servidor JMAP contra la que apuntar.
