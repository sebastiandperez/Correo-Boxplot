Pinia es la capa de estado efímero de Application para Vue 3; no es una segunda base de datos.

Pinia pertenece a Application; sus dependencias permitidas y prohibidas están definidas en [layers.md](layers.md).

Stores mínimos del MVP Tauri:

runtime
- local: opening | ready | error
- auth: anonymous | authenticating | authenticated | expired
- connectivity: online | offline

mail
- selección semántica: `AccountKey`, `ScopedMailboxId` y `ScopedEmailId`
- visiblePage
- loadState: idle | loading | ready | error

composer
- campos temporales, mutables y todavía no resueltos de redacción
- phase: idle | editing | queueing | error

Regla de actualización P-03:

SQLite commit → LocalChangeSource → invalidation → ReadRepository re-read → Pinia refresh → Vue

`LocalChangeSource` P-03 es un contrato cerrado. Es una señal post-commit no durable y puede coalescer o duplicar hints. Permite subscriptions independientes y no transporta la nueva autoridad: Application siempre relee el estado committed mediante `ReadRepository` y no interpreta el orden como estado de negocio. Un no-op puro exitoso puede no notificar; cualquier invalidación conservadora válida sigue siendo aceptable.

El orden obligatorio de inicialización y reanudación es `subscribe → read current state → render`. Hacer `read → subscribe` abriría una carrera en la que un commit podría ocurrir entre ambas operaciones y perderse su notificación no durable. No existe replay; después de reconnect/resume se vuelve a suscribir y releer.

Las necesidades de materialización remota se dirigirán mediante futura orquestación Application → Coordinator; no son operaciones de `ReadRepository`, `SyncPort` ni `LocalChangeSource`.

La selección actual no redefine la identidad de Account y no se mezcla con `runtime.auth`. Pinia puede seleccionar una `AccountKey` durable mientras `auth = anonymous`; `LocalReady + RemoteAnonymous` continúa siendo válido.

Composer pertenece exclusivamente a Application. No es `SendIntent` ni `PendingMutation`: al pulsar Send, Application valida, resuelve los defaults de Identity y crea un `SendIntent` inmutable; solo después de persistir correctamente su `SendMutation` se limpia Composer.

Pinia no persiste correo, token JMAP, DEK, `CollectionSyncCursor`, `PendingMutation` ni drafts.
