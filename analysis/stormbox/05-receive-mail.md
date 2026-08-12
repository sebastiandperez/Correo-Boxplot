# 05 - Recibir correo

[COMPROBADO]

El cliente recibe correos usando una combinación de **WebSockets para notificaciones Push** y sincronización incremental de JMAP (StateChange).

## Explicación Conceptual
El servidor de correo nunca empuja el contenido del correo directamente por la red. En JMAP, el cliente mantiene un WebSocket abierto esperando un evento llamado `StateChange`. Este evento es simplemente un grito que dice: "¡La entidad de tipo Email ha cambiado su estado de '123' a '124'!". 
Al escuchar esto, el cliente hace una petición pidiendo solo las novedades desde el estado '123' (Incremental Sync). Si descubre que hay un correo nuevo, actualiza la base de datos local y, si la UI está mirando esa carpeta, también le pide el cuerpo del mensaje.

## Análisis Técnico Detallado

El flujo completo es el siguiente:

1.  **Conexión persistente:** Durante el inicio (en el SharedWorker), el `JmapBackend` llama a `transport.openWebSocket()`. Este socket se usa tanto para hacer peticiones como para recibir notificaciones (Push).
2.  **Notificación Push (StateChange):** Cuando llega un correo nuevo al servidor JMAP, el servidor envía un frame de WebSocket al cliente: `{ "@type": "StateChange", "changed": { "urn:ietf:params:jmap:mail": { "Email": "new_state_token" } } }`.
3.  **Captura del evento:** El método `_onStateChange()` en `jmap/backend.ts` recibe este frame. Para evitar condiciones de carrera (dos correos llegando casi al mismo tiempo), los mete en una cola `_stateChangePending` y usa un temporizador de debounce.
4.  **Sincronización Incremental (`syncEmailChanges`):** El cliente mira en SQLite cuál fue el último `sync_state` de la entidad `Email`. Luego, realiza una llamada JMAP `Email/changes` pasándole ese estado viejo. El servidor le responde con una lista de `created`, `updated`, y `destroyed` IDs.
5.  **Descarga de Metadatos:** Para los correos creados (`created`), el cliente llama a `Email/get` pidiendo propiedades ligeras (`threadId`, `mailboxIds`, `subject`, `from`, `receivedAt`, etc.). **Nota importante:** en este punto NO se descarga el cuerpo (body) completo.
6.  **Persistencia Local:** Los metadatos de los mensajes nuevos se guardan en SQLite mediante `upsertMessages`. SQLite ahora conoce el correo.
7.  **Reconstrucción de Vistas:** El cliente actualiza las vistas locales asociadas a las carpetas (Mailboxes) que recibieron el correo mediante `syncFolderWindow`.
8.  **Prefetch del Body (Opcional):** Si la carpeta afectada por el correo nuevo está siendo vista en la UI en este momento (`_foregroundFolderWindowCount > 0`), el Backend puede intentar hacer un *Eager Fetch* del cuerpo del mensaje llamando a `fetchEmailBodies` por adelantado.
9.  **Aviso a la UI:** El `Repository` en el SharedWorker emite un evento `TABLES_TOUCHED` a través de un `BroadcastChannel` que cruza a las ventanas del navegador.
10. **Re-renderizado UI:** El `mail-store.ts` en la UI escucha que la tabla `messages` cambió, reejecuta su consulta sobre SQLite (con la función RPC `listMessagesForView`), extrae la nueva fila de metadatos de la caché y Vue renderiza la lista actualizada de correos.

### Qué ocurre offline
Si la conexión se corta, el WebSocket muere y los pushes no llegan. Cuando la conexión se recupera, el supervisor de reconexión del `JmapBackend` lo reinicia. Como el JMAP es State-based, el cliente simplemente pide `Email/changes` con su estado antiguo; el servidor sabe exactamente todo lo que ocurrió en el ínterin (nuevos correos, borrados) y se sincroniza sin perder nada, evitando duplicados, ya que los identificadores de JMAP (`remote_id`) son la fuente primaria.
