# 10 - IMAP

**No aplica.**

## Motivo
El proyecto (Stormbox) es un cliente puramente JMAP-first. Al analizar sus dependencias, capas de red y adaptadores de protocolo (`src/sync/backends/`), solo existe implementación para JMAP (`src/sync/backends/jmap/`).

No posee conectores para IMAP. No comparte interfaces comunes (como un `MailProvider` genérico) que discriminen entre IMAP y JMAP; toda la arquitectura interna del código y el esquema de la base de datos (SQLite) reflejan directamente la ontología y las especificaciones de JMAP (RFC 8620, RFC 8621), como el manejo de identificadores `remoteId`, `state`, y `sinceState`.
