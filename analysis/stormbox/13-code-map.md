# 13 - Mapa del Código

Si quieres entender cómo Stormbox está construido, te recomiendo seguir estas rutas de lectura en orden:

### Para entender el Flujo de la Interfaz (UI)
Comienza por los Stores de Pinia; son los que exponen el estado para Vue.
1. `src/stores/mail-store.ts` (Dónde se define el estado de los correos y las carpetas).
2. `src/stores/compose-store.ts` (Dónde ocurre la magia de redactar y encolar el envío de mensajes).
3. `src/main.ts` y `src/App.vue` (El punto de entrada clásico de Vue).

### Para entender el Sistema Local-First y el Worker
El Hilo Principal y el Worker están separados; este es el puente entre ambos.
1. `src/db/repository.ts` (El cliente RPC en el Hilo Principal que las Stores usan para hablar con el Worker).
2. `src/db/shared-worker.ts` (El punto de entrada del SharedWorker que arranca SQLite y la red).
3. `src/db/rpc-dispatch.ts` (Cómo los mensajes se enrutan de un hilo a otro).
4. `src/db/handlers.ts` (El lugar donde el Worker ejecuta el SQL directamente sobre `wa-sqlite`).

### Para entender la Sincronización JMAP
Aquí está la carne del protocolo y la optimización de red.
1. `src/sync/backends/jmap/backend.ts` (El controlador principal de JMAP, maneja conexiones y WebSocket).
2. `src/sync/backends/jmap/messages.ts` (Busca `syncFolderWindow`, aquí verás cómo se traen los mensajes nuevos con JMAP Batching).
3. `src/sync/backends/jmap/transport.ts` (Cómo el cliente maneja las llamadas en bruto, JSON por HTTP o WS).

### Para entender el Envío y Mutaciones Offline
Entender cómo puedes "enviar" o "borrar" un correo sin internet.
1. `src/sync/backends/jmap/outbox-runner.ts` (El loop asíncrono que procesa las tareas pendientes).
2. `src/sync/backends/jmap/outbox.ts` (Busca `runSend`. Verás cómo Stormbox traduce una orden de "Enviar" a `Email/set` y `EmailSubmission/set`).
