# 09 - JMAP

[COMPROBADO — `worker/jmap/`]

El backend JMAP de aerc es el más completo de los tres clientes analizados en cuanto al uso del protocolo, combinando lo mejor de los mundos:

## Caché + Push + Diferencial

### Caché LevelDB
El Worker JMAP persiste en disco (LevelDB) los tokens de estado (`mailboxState`, `emailState`, `threadState`) y los metadatos de los objetos. Esto permite que en el próximo inicio de aerc, la lista de carpetas y mensajes aparezca instantáneamente desde la caché mientras la primera sincronización diferencial ocurre en background.

### Push via Server-Sent Events (SSE)
JMAP define un mecanismo estándar de push llamado `EventSource` (SSE). El Worker abre una conexión HTTP de larga duración, y el servidor envía frames de texto cuando hay cambios. Aerc usa la librería `go-jmap/core/push` para esto.

### Sincronización Diferencial
Al recibir un `StateChange`, el Worker construye un batch que incluye:
1. `Mailbox/changes` + `Mailbox/get` (para nuevas/eliminadas carpetas).
2. `Email/queryChanges` (para cada carpeta cuyo query view está cacheado) — esto da los IDs añadidos y eliminados de cada vista.
3. `Email/changes` + `Email/get` (para metadatos actualizados globalmente).
4. `Thread/changes` + `Thread/get` (para hilos de conversación nuevos o actualizados).

Todo en un único request HTTP batch — exactamente el mismo patrón que Stormbox, confirmando que es la forma idiomática de usar JMAP.

## Qué tiene aerc que Stormbox no tiene
*   **Soporte de Threading:** aerc puede mostrar hilos de conversación agrupados usando `Email/queryChanges` en modo `collapseThreads` y consultando `Thread/get`.
*   **Caché en disco real (LevelDB):** Más robusto que la memoria RAM; sobrevive reinicios de aerc.
