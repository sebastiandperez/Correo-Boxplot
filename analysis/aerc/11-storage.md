# 11 - Almacenamiento local

[COMPROBADO]

Aerc tiene dos modelos de persistencia según el backend activo.

## Backend IMAP/SMTP: Sin persistencia en disco
El estado en memoria RAM durante la sesión:
*   Lista de UIDs y flags de la carpeta actualmente seleccionada.
*   Metadatos de mensajes visibles (los del `FetchMessageHeaders` reciente).
*   `SeqMap`: mapa SeqNum → UID.

Al cerrar aerc, toda esta información se pierde. La próxima vez que abras, se refrescará desde el servidor IMAP.

Aerc también admite una caché en disco para headers IMAP basada en LevelDB (`imapConfig.cacheEnabled`). Si está habilitada, los headers de mensajes ya vistos no se vuelven a descargar, acelerando el listado de carpetas grandes.

## Backend JMAP: LevelDB (`worker/jmap/cache/`)
El Worker JMAP persiste en disco (en el directorio de caché del sistema operativo) una base de datos LevelDB con:

| Clave | Valor | Propósito |
|-------|-------|-----------|
| `mailbox:<id>` | JSON del Mailbox | Carpetas cacheadas |
| `email:<id>` | JSON del Email | Metadatos del correo |
| `thread:<id>` | JSON del Thread | Grupos de conversación |
| `foldercontents:<id>` | Lista de IDs + queryState | Vista de carpeta paginada |
| `state:mailbox` | String | Estado JMAP de mailboxes |
| `state:email` | String | Estado JMAP de emails |
| `state:thread` | String | Estado JMAP de threads |

Los blobs (cuerpos de mensajes) pueden cachearse en un directorio de archivos separado si `cacheBlobs = true`.

## Backend Maildir
El sistema de archivos **es** la base de datos. Aerc lee y escribe archivos en formato Maildir directamente en el disco. No hay ninguna base de datos adicional.

## Comparación
| | Aerc (IMAP) | Aerc (JMAP) | Stormbox | Himalaya |
|---|---|---|---|---|
| Persistencia | RAM (+ LevelDB opt.) | LevelDB | wa-SQLite (OPFS) | Ninguna |
| Cuerpos cacheados | Opt. en LevelDB | Opt. en filesystem | Sí (SQLite) | No |
| Estados diferenciales | Sólo SeqMap | Sí (JMAP States) | Sí (JMAP States) | No |
