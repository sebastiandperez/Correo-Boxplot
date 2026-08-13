Pinia es la capa de estado efímero de Application para Vue 3; no es una segunda base de datos.

Stores mínimos del MVP Tauri:

runtime
- local: opening | ready | error
- auth: anonymous | authenticating | authenticated | expired
- connectivity: online | offline

mail
- selectedAccountId / selectedMailboxId / selectedEmailId
- visiblePage
- loadState: idle | loading | ready | error

composer
- campos temporales de redacción
- phase: idle | editing | queueing | error

Regla de actualización:

SQLite changes → onChange → ReadRepository → Pinia refresh → Vue

Pinia no persiste correo, token JMAP, DEK, SyncCursor, PendingMutation ni drafts. El composer solo se limpia después de que la PendingMutation de envío se haya persistido correctamente.
