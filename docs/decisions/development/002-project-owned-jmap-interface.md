# 002 — Interfaz JMAP propiedad del proyecto

**Status:** Accepted; adapter candidate resolved by [ADR-006](../architecture/ADR-006-jmap-client-choice.md)

## Context

`jmap-jam 0.13.3` es un candidato pre-1.0 bien alineado, pero todavía requiere conformance contra Stalwart.

## Decision

Coordinator y Outbox dependen de una interfaz JMAP propia (`src/jmap/client.ts::JmapClient`). `jmap-jam` no se instala durante el bootstrap y sus tipos no pueden filtrarse al dominio.

## Consequences

El candidato se añadirá únicamente durante el spike. Puede reemplazarse si falla la cobertura de Session, Mailbox/Email, changes, batching, submission o reconnect push.

## Actualización — ADR-006 y ADR-007

ADR-006 evaluó `jmap-jam 0.13.3` contra los vectores JM-01…JM-06 y lo adoptó: se movió a `dependencies` con versión exacta, encapsulado por completo en `src/jmap/`. La interfaz `JmapClient` sigue siendo propiedad del proyecto y ahora tiene una segunda implementación, `ImapJmapAdapter` (ADR-007), que traduce IMAP/SMTP a la misma forma sin exponer ningún tipo de transporte a Coordinator/Outbox.
