# 002 — Interfaz JMAP propiedad del proyecto

**Status:** Accepted; adapter candidate OPEN

## Context

`jmap-jam 0.13.3` es un candidato pre-1.0 bien alineado, pero todavía requiere conformance contra Stalwart.

## Decision

Coordinator y Outbox dependen de una interfaz JMAP propia. `jmap-jam` no se instala durante el bootstrap y sus tipos no pueden filtrarse al dominio.

## Consequences

El candidato se añadirá únicamente durante el spike. Puede reemplazarse si falla la cobertura de Session, Mailbox/Email, changes, batching, submission o reconnect push.
