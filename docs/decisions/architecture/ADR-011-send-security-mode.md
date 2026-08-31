# ADR-011 — Modo de seguridad durable por SendIntent

**Status:** ACCEPTED · READY FOR EXECUTION

## Context

Una `SendMutation` puede ejecutarse después de un reinicio, cuando la
conectividad, las claves disponibles o el estado de confianza ya cambiaron.
Inferir en ese momento si el envío debe ser plaintext o E2EE haría que una
decisión autorizada por el usuario dejara de ser determinista y permitiría un
downgrade silencioso.

## Decision

- `SendSecurityMode` tiene exactamente los valores `plain` y
  `boxplotE2eeV1`.
- Cada `SendIntent` contiene un `securityMode` readonly y obligatorio. Es una
  decisión por envío; no pertenece a Account, Identity, sesión, Pinia ni a una
  preferencia global.
- Todo constructor TypeScript nuevo debe declarar el modo explícitamente. El
  flujo de Composer existente declara `plain` hasta que Presentation incorpore
  una selección específica.
- `SendMutation.intent.securityMode` se conserva por IPC, SQLCipher, reinicio,
  CAS y todas las transiciones de lifecycle.
- Ninguna heurística de dominio, recipient, keys, trust o conectividad puede
  elegir o reescribir el modo.
- El convertidor plaintext heredado rechaza `boxplotE2eeV1` antes de producir
  un `SubmissionMessage`; la ejecución E2EE corresponde al siguiente bloque.

## Compatibility

Las filas históricas de `pending_mutations` pueden contener un SendIntent JSON
sin `securityMode`. Solo el decoder persistente interpreta esa ausencia como
`plain`. Los valores desconocidos se consideran estado corrupto. Toda escritura
nueva serializa el campo de forma explícita; no se necesita una migración SQL.

## Consequences

- Reinicios y cambios posteriores de trust no alteran el modo autorizado.
- Dos snapshots que solo difieren en `securityMode` tienen payloads semánticos
  distintos y CAS no puede convertir uno en otro.
- Los inventarios de P-01/P-02/P-03 y de IPC permanecen sin métodos nuevos.

## Deferred

- Selector E2EE en Presentation.
- Ejecución plaintext/E2EE, cifrado y reconciliación durable mediante
  `MUTATION-EXECUTION-RECONCILIATION-01`.
- Verificación independiente combinada de materialización y ejecución remota.
