# 08 - Sincronización

[COMPROBADO]

Aerc tiene dos modelos de sincronización según el protocolo, que coexisten en el mismo proceso.

## IMAP: IDLE + Re-fetch reactivo

El estado local de aerc en IMAP es la lista de UIDs y sus flags actualmente en memoria RAM (no hay SQLite ni LevelDB para IMAP). 

*   **Cuando llega un mensaje nuevo:** El Idler recibe `client.MailboxUpdate`. El Worker envía una `CheckMail` action a sí mismo, que lanza un `LIST-STATUS` (si el servidor lo soporta) o un `STATUS` para refrescar los conteos de carpetas. Además, pide los headers del nuevo mensaje.
*   **Cuando cambian flags:** El Idler recibe `client.MessageUpdate` con los nuevos flags y los envía a la UI directamente.
*   **Cuando se borra un mensaje:** El Idler recibe `client.ExpungeUpdate`. El Worker resuelve el UID a partir de su `SeqMap` (mapa de número de secuencia → UID) y envía `MessagesDeleted` a la UI.
*   **Reconexión:** Si la conexión IMAP cae, el `observer.go` detecta el estado desconectado y emite un `ConnError`. El `app/account.go` recibe el error y reintenta la conexión con backoff. Al reconectar, aerc refuerza la lista completa de UIDs con un nuevo `FETCH 1:*`.

## JMAP: EventSource + States diferenciales

Aerc tiene el sistema de sincronización más completo en su backend JMAP, siendo el único de los tres clientes que usa **caché en disco (LevelDB)** para estados JMAP.

*   **Sincronización Diferencial:** Al recibir `StateChange`, compara el nuevo estado con el guardado en LevelDB. Si difieren, invoca `*/changes` con el estado viejo para pedir solo el delta.
*   **Reconexión:** Si el EventSource cae, el Worker hace `time.Sleep(5s)` y vuelve a llamar `events.Listen()`. Al reconectar, el mismo mecanismo de `StateChange` garantiza que no se pierdan cambios (el servidor conoce todos los cambios desde cualquier estado pasado).
*   **Caché de Carpetas:** La caché LevelDB guarda también el contenido de las carpetas (`FolderContents`), con la lista de IDs de mensajes y el `queryState`. Cuando el usuario vuelve a abrir la carpeta, aerc puede mostrar los correos cacheados instantáneamente y actualizar en segundo plano.
