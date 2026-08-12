# 09 - JMAP

[COMPROBADO]

JMAP (JSON Meta Application Protocol) es el corazón y alma de Stormbox. Todo el código backend de este cliente (`src/sync/backends/jmap/`) está diseñado específicamente para consumir la API de JMAP definida en los RFC 8620 y RFC 8621.

No hay capas de traducción intermedias genéricas hacia un formato agnóstico; SQLite almacena casi uno-a-uno la estructura de objetos de JMAP (`remote_id`, `state`, `blob_id`, `thread_id`).

## Cómo el proyecto encapsula JMAP

La UI de Vue nunca realiza una llamada JMAP.
El encapsulamiento sigue esta cadena:
```text
UI
 ↓
Application Store (Pinia)
 ↓
RPC Dispatcher (MessagePort)
 ↓
Sync Host (Worker)
 ↓
JmapBackend (`jmap/backend.ts`)
 ↓
JmapTransport (`jmap/transport.ts` - HTTP/WS)
```

El `JmapBackend` agrupa las llamadas en *batches* utilizando el soporte nativo de JMAP para llamadas múltiples (`methodCalls` array) e incluso referencias hacia atrás (`#ids`: `resultOf`), logrando resolver dependencias cruzadas en un solo viaje de red.

## Operaciones mapeadas

| Operación del cliente | Método JMAP | Componente que lo ejecuta | Resultado |
| --------------------- | ----------- | ------------------------- | --------- |
| **Descubrir servidor** | `GET /.well-known/jmap` | `JmapTransport.fetchSession` | Obtiene la URL de API, soporte WS, capabilities y accounts disponibles. |
| **Obtener carpetas** | `Mailbox/get` | `syncMailboxes` | Pobla el árbol de carpetas locales en SQLite. |
| **Cargar ventana de correos** | `Email/query` + `Email/get` | `syncFolderWindow` | Obtiene lista de IDs paginada y luego descarga los metadatos de esos correos, todo en un solo RTT. |
| **Actualizar ventana** | `Email/queryChanges` + `Email/get` | `syncFolderWindowChanges` | Sincronización incremental hiper rápida; solo trae lo que cambió. |
| **Sincronización global** | `Email/changes` + `Email/get` | `syncEmailChanges` | Actualiza estados de lectura (`$seen`), borrados, etc. |
| **Descargar cuerpo/HTML**| `Email/get` (properties: bodyValues) | `ensureMessageBodyForDisplay` | Descarga el cuerpo pesado del mensaje para leerlo. |
| **Mover a carpeta** | `Email/set` (patch `mailboxIds`) | `runMoveToFolders` en `outbox.ts` | Actualiza la pertenencia del mensaje a una carpeta. |
| **Marcar como leído** | `Email/set` (patch `keywords/$seen`) | `runSetKeywords` en `outbox.ts` | Cambia las flags del mensaje. |
| **Enviar correo** | `Email/set` + `EmailSubmission/set` | `runSend` en `outbox.ts` | Crea el mensaje y lo envía. Mueve a enviados (Sent) usando `onSuccessUpdateEmail`. |
| **Subir Adjuntos/Imágenes**| `Blob/upload` | `uploadInlineImages` | Convierte datos binarios en un Blob ID de JMAP antes de enviar un correo. |

## Batching y Sincronización

Stormbox aprovecha JMAP al máximo:
*   El Worker procesa cambios en lotes limitados (`maxObjectsInGet`) para no saturar la memoria local del hilo de Worker ni del servidor.
*   El uso del WebSocket (si el servidor lo soporta) elimina el *overhead* de HTTP (handshakes, headers), pasando a intercambiar JSON crudo rápidamente para notificaciones Push (`StateChange`) y respuestas.
