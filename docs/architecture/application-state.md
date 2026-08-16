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

Regla de actualización:

SQLite changes → onChange → ReadRepository → Pinia refresh → Vue

La selección actual no redefine la identidad de Account y no se mezcla con `runtime.auth`. Pinia puede seleccionar una `AccountKey` durable mientras `auth = anonymous`; `LocalReady + RemoteAnonymous` continúa siendo válido.

Composer pertenece exclusivamente a Application. No es `SendIntent` ni `PendingMutation`: al pulsar Send, Application valida, resuelve los defaults de Identity y crea un `SendIntent` inmutable; solo después de persistir correctamente su `SendMutation` se limpia Composer.

Pinia no persiste correo, token JMAP, DEK, `CollectionSyncCursor`, `PendingMutation` ni drafts.
