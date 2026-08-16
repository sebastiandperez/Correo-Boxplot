✓ UI Shell dejó de ser estática
✓ Pinia contiene solo estado efímero
✓ UI lee correo únicamente mediante ReadRepository
✓ ReadRepository y SyncPort tienen Memory + Tauri implementations
✓ Memory y Tauri pasan la misma suite observable
✓ SQLite + SQLCipher abre, migra, reabre y falla cerrado
✓ DEK permanece solo en Rust
✓ LocalChangeSource post-commit provoca reread local mediante ReadRepository
✓ Composer persiste PendingMutation antes de limpiar
✓ HTML se renderiza tras la frontera de seguridad
✓ JmapClient funciona aisladamente contra Stalwart
✓ JMAP Session / Mailbox / Email / changes / submission funcionan
✓ WebSocket/StateChange está validado o su bloqueo está formalmente resuelto
✓ token JMAP permanece memory-only
✓ Coordinator NO está implementado
✓ Outbox processor NO está implementado
✓ UI NO habla JMAP
✓ Rust NO habla JMAP
✓ ReadRepository / SyncPort / JmapClient / store API quedan congelados
✓ pnpm check pasa
✓ pnpm exec tauri dev abre el cliente y supera el smoke local-first
