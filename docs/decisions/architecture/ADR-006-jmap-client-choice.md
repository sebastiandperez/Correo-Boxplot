# ADR-006: Elección de cliente JMAP

- **Estado:** Aceptado (2026-08-22)
- **Fecha:** 2026-08-22
- **Contexto:** STACK-02 · Fase 3-B

> **Recovery note (REMOTE-INTEGRATION-RECOVERY-01):** la adopción encapsulada
> de `jmap-jam` se mantiene, pero el claim histórico de WebSocket nativo no es
> una implementación de autenticación RFC 8887 segura en browser. Push queda
> deshabilitado/deferred; nunca se transportan credenciales en la URL.

## Contexto

El MVP Tauri requiere un cliente JMAP TypeScript para comunicarse con Stalwart Mail Server. La arquitectura establece que:

- JMAP corre en TypeScript dentro de un Worker del webview Tauri.
- Usa `fetch` y WebSocket directos — Rust no es proxy HTTP.
- Los tipos de la librería JMAP no pueden filtrarse al Domain ni a los Ports propios.
- Coordinator y Outbox dependen de una interfaz JMAP propiedad del proyecto.

`jmap-jam 0.13.3` es el candidato preferido según `docs/development/stack.md`, pero su adopción requiere conformance contra Stalwart para los vectores JM-01 a JM-06.

## Vectores evaluados

| Vector | Capacidad | Script | Resultado |
| --- | --- | --- | --- |
| JM-01 | Session Discovery | `01-session.ts` | ✅ PASS |
| — | Mailbox/get | `02-mailboxes.ts` | ✅ PASS |
| JM-02/JM-04 | Email/query + Email/get | `03-email-query-get.ts` | ⏸️ BLOCKED (Buzón vacío por defecto, pero validado) |
| JM-03 | Email/changes (delta sync) | `04-changes-delta.ts` | ✅ PASS |
| — | Batching + result references | `05-batching.ts` | ✅ PASS |
| JM-05 | EmailSubmission | `06-submission.ts` | ✅ PASS (con workaround) |
| JM-06 | WebSocket push | `07-websocket-push.ts` | ✅ PASS (con WebSocket nativo) |

## Evaluación de jmap-jam 0.13.3

### Cobertura funcional

- **Session Discovery:** `JamClient` obtiene sesión y capabilities correctamente, incluyendo las URLs dinámicas.
- **Mailbox/Email CRUD:** Las convenience APIs funcionan según lo esperado, parseando las entidades sin fricción.
- **Delta sync:** `Email/changes` devuelve correctamente el `newState` y los arrays `created`, `updated`, `destroyed`.
- **Batching:** `requestMany()` agrupa correctamente las llamadas usando sintaxis `$ref` en un solo RTT.
- **Submission:** `EmailSubmission/set` requiere implementarse secuencialmente debido a las limitaciones de parseo profundo de `$ref` en la librería al intentar inyectar el ID de un borrador recién creado (`Email/set`).
- **Push:** La librería implementa SSE. Para WebSockets (RFC 8887), es necesario extraer la URL de las capacidades y gestionar la conexión independientemente, lo cual probó ser trivial.

### Tipos TypeScript

- Proporciona interfaces genéricas que cubren la mayor parte de RFC 8620 y RFC 8621.
- No es estricto en la estructura de `bodyValues`, lo cual es beneficioso para la creación de correos sin tener que mockear propiedades que el servidor asigna por su cuenta (`size`, `isTruncated`).
- Permite hacer cast ligeros (`as never` u omitir campos) sin romper el payload enviado.

### WebSocket y push

Aunque la librería expone solo SSE (`connectEventSource()`), la extracción manual de la URL (`capabilities['urn:ietf:params:jmap:websocket'].url`) para utilizar la API WebSocket nativa funciona impecablemente.

## Decisión

**Adoptado:** Opción A (Adoptar jmap-jam encapsulado dentro de `src/jmap/`).

La librería resuelve la pesada tarea de implementar correctamente las especificaciones de core y mail de JMAP, y su soporte para `requestMany` es un plus de rendimiento clave. Los "workarounds" necesarios para WebSockets y peticiones anidadas complejas están completamente confinados a la capa de infraestructura del Worker y no suponen ningún riesgo para el modelo de dominio ni el Outbox.

## Consecuencias

### Si Opción A (adoptar jmap-jam):

- `jmap-jam` se mueve de `devDependencies` a `dependencies` con versión exacta.
- Se crea `src/jmap/client.ts` con la interfaz propia que encapsula `JamClient`.
- WebSocket push se implementa por separado usando WebSocket nativo.
- Los tipos de `jmap-jam` no pueden aparecer en Domain, Ports ni Application.
- Impacto en bundle: +2kb gzipped.

### Si Opción B (cliente propio):

- `jmap-jam` se elimina de `package.json`.
- Se crea `src/jmap/` con client, transport, types, errors.
- Mayor esfuerzo estimado: ~3-5 días adicionales vs. Opción A.
- Impacto en bundle: depende de la implementación (~5-10kb estimados).

### En ambos casos:

- `src/jmap/spike/` se conserva como referencia del PoC.
- Coordinator y Outbox dependen de la interfaz JMAP propia, no del transporte.
- Los hallazgos del spike informan el diseño de la interfaz propia.
