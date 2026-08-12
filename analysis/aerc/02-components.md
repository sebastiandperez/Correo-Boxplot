# 02 - Componentes Principales

[COMPROBADO]

Aerc organiza su código en capas bien definidas. Los componentes más importantes son:

### 1. Bucle de Eventos Principal (`main.go`)
Es el corazón del proceso. Corre indefinidamente en el hilo principal de Go usando un `select` sobre varios canales:
*   `ui.Events`: Eventos de teclado/ratón del usuario.
*   `app.WorkerMessages`: Mensajes de respuesta de cualquier backend Worker (correos nuevos, flags actualizados, errores de red, etc.).
*   `ui.Callbacks` y `ui.Redraw`: Peticiones de actualización de pantalla.

### 2. Capa de Aplicación / UI (`app/`)
Los widgets visuales de la TUI. Los más relevantes son:
*   `aerc.go`: El contenedor principal, gestiona múltiples pestañas.
*   `account.go`: Vista de una cuenta. Coordina el árbol de carpetas y la lista de mensajes.
*   `msglist.go`: El widget que muestra los sobres de mensajes (lista de correos).
*   `msgviewer.go`: El widget que muestra el contenido de un correo abierto.
*   `compose.go`: El widget compositor (redactar/responder).
*   `dirlist.go` / `dirtree.go`: Árbol de carpetas.

### 3. Bus de Mensajes Worker (`worker/types/`)
Define el protocolo de comunicación interno entre la UI y los Backends.
Todos los mensajes implementan la interfaz `WorkerMessage`. Hay dos categorías:
*   **Actions** (UI → Worker): `FetchDirectoryContents`, `OpenDirectory`, `FlagMessages`, `DeleteMessages`, `StartSendingMessage`.
*   **Responses** (Worker → UI): `MessageInfo`, `DirectoryContents`, `MessagesDeleted`, `Done`, `Error`.

### 4. Backends Worker (`worker/imap/`, `worker/jmap/`, `worker/maildir/`, etc.)
Cada backend corre en su propia goroutine de Go. Implementan la interfaz `Backend` (método `Run()`). El método `Run()` es un bucle `select` que espera mensajes en el canal `worker.Actions()`, los procesa contra el protocolo correspondiente y emite mensajes de vuelta al canal `worker.Messages`.

### 5. El Idler IMAP (`worker/imap/idler.go`)
Un componente especializado del Worker IMAP. Cuando no hay acciones pendientes, activa el comando `IMAP IDLE` de Go en una goroutine separada. Esto mantiene una conexión TCP bloqueada en el servidor esperando notificaciones Push. En cuanto llega una, el canal de `updates` del cliente de go-imap recibe la notificación y el Worker la convierte en un mensaje de vuelta a la UI.

### 6. Monitor de Cambios JMAP (`worker/jmap/push.go`)
Equivalente al Idler pero para JMAP. Lanza una goroutine que escucha un **Server-Sent Events (EventSource)** HTTP de larga duración. Al recibir un `StateChange`, construye un batch de peticiones JMAP (`Mailbox/changes`, `Email/queryChanges`, `Email/changes`) de forma atómica y envía los resultados a la UI.

### 7. Caché JMAP (`worker/jmap/cache/`)
Un módulo basado en LevelDB que persiste en disco:
*   Los `state` tokens de JMAP (para sincronización diferencial).
*   Los metadatos de emails y mailboxes.
*   El contenido de carpetas (lista de IDs de correos por carpeta).
