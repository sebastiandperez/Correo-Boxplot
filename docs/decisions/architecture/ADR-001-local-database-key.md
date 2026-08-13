# ADR-001 — Clave de la base local

**Status:** Accepted for Tauri MVP

## Context

La propuesta provisional derivaba la clave SQLCipher desde WebAuthn PRF. Eso acoplaba la apertura offline de la caché a la autenticación remota y al soporte de Passkeys del webview.

## Decision

Rust genera una DEK criptográficamente aleatoria de 32 bytes durante el primer provisioning, la guarda en el secure store del sistema operativo y la aplica directamente a SQLCipher. La DEK no se deriva del Passkey, no cruza IPC y no tiene fallback plaintext.

## Why

Autenticación remota y confidencialidad local resuelven problemas distintos. Esta separación permite abrir la caché offline y mantiene la clave fuera de la frontera webview.

## Consequences

El Motor Tauri falla cerrado si el secure store o la clave no están disponibles. La implementación debe probar reapertura, clave incorrecta, cifrado activo e integridad.

## Deferred work

El uso eventual de PRF para cifrado local requeriría una nueva decisión. El cifrado de la futura entrega Web/PWA no se resuelve aquí.
