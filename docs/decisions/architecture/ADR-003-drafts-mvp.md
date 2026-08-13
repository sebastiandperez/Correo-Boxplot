# ADR-003 — Alcance de drafts

**Status:** Accepted for Tauri MVP

## Context

Un draft durable o JMAP introduce entidad, migración, autosave, IDs remotos, sync y conflictos. Nada de eso es necesario para validar redactar y encolar un envío.

## Decision

La redacción vive solo en memoria de Pinia. No hay tabla `Draft`, autosave, `localStorage` ni sincronización JMAP `$draft`. Al cerrar con contenido se pide confirmación.

## Why

Mantiene el MVP en el flujo mínimo y evita una autoridad durable paralela.

## Consequences

Un crash o cierre antes de Enviar puede perder el texto. Al pulsar Enviar, el compositor solo se limpia después de persistir con éxito la `PendingMutation`; si falla, conserva el contenido.

## Deferred work

Drafts durables y sincronizados requieren una decisión y diseño posteriores.
