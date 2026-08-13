# 001 — SQLCipher externo, no bundled

**Status:** Accepted; provisioning OPEN

## Context

La ruta `bundled-sqlcipher` disponible para `rusqlite 0.40.2` puede quedar detrás de SQLCipher `4.17.0`, la baseline de seguridad investigada.

## Decision

El crate usa `rusqlite = 0.40.2` con feature `sqlcipher` y enlaza SQLCipher externo. Desarrollo admite SQLCipher `4.x` si supera las pruebas funcionales de cifrado; la distribución apunta a SQLCipher `4.17.0`, basado en SQLite `3.53.3`. No existe fallback plaintext.

## Consequences

El bootstrap nativo puede fallar donde la biblioteca no esté provisionada. Desarrollo verifica `PRAGMA cipher_version`, cifrado y claves correctas/incorrectas sin exigir el patch exacto. Debemos crear un PoC reproducible en Windows, macOS y Linux y afirmar ambas versiones exactas en los artefactos de release.
