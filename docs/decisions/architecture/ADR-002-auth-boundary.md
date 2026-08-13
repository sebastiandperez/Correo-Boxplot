# ADR-002 — Frontera de autenticación remota

**Status:** Accepted for Tauri MVP

## Context

El cliente debe seguir mostrando la caché cuando no hay red o sesión JMAP. Unir login y desbloqueo local rompería esa propiedad local-first.

## Decision

Passkeys/WebAuthn se ejecuta en el navegador del sistema. El ciclo remoto es independiente del ciclo SQLCipher y `LocalReady + RemoteAnonymous` es válido. El token JMAP vive únicamente en memoria del Worker TypeScript; no entra en Pinia, SQLite, `localStorage`, archivos ni logs.

## Why

El navegador del sistema ofrece la frontera WebAuthn apropiada y un token memory-only minimiza secretos durables. Logout o expiración pueden detener la red sin cerrar la base.

## Consequences

Relanzar la aplicación exige autenticarse otra vez para sincronizar, pero no para leer la caché. El callback exacto de autenticación queda OPEN como contrato de integración con el servidor y debe cerrarse antes del E2E, sin asumir un protocolo no acordado.

## Deferred work

Persistencia de sesión remota y recuperación de cuenta/passkey quedan fuera del cliente MVP. La custodia Web se decide en su iteración futura.
