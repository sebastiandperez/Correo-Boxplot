# 04 - Capas de la Arquitectura

[COMPROBADO]

Aerc tiene una separación muy clara de responsabilidades entre capas. El mecanismo central es la comunicación asíncrona por canales (`chan`) de Go.

## La regla de oro
La UI **nunca** llama directamente a funciones de red. La red **nunca** modifica directamente widgets de la UI.
Toda comunicación cruza la frontera a través de mensajes tipados (`WorkerMessage`) en canales de Go.

## Las Capas

### Capa 1: Presentación (Hilo Principal)
La TUI. Widgets como `msglist.go`, `msgviewer.go`, `compose.go`. Solo leen datos que ya están en memoria (structs de `models.MessageInfo`, `models.Directory`) y dibujan en el terminal usando `tcell`. Responden a eventos de teclado.

### Capa 2: Aplicación / Comandos
`app/account.go` y el sistema de `commands/`. Cuando el usuario pulsa una tecla mapeada a un comando (ej. `:flag`), el sistema de comandos construye un mensaje de Action tipado (ej. `FlagMessages`) y lo envía al Worker por el canal de acciones.

### Capa 3: Bus de Mensajes (`worker/types/`)
El contrato entre capas 2 y 4. Un conjunto de structs Go tipados que definen cada operación posible. Funciona como un protocolo interno de alto nivel.
*   Dirección descendente (UI → Worker): `types.FetchDirectoryContents`, `types.DeleteMessages`…
*   Dirección ascendente (Worker → UI): `types.MessageInfo`, `types.MessagesDeleted`, `types.Done`, `types.Error`…

### Capa 4: Backend Workers (Goroutines)
Cada protocolo (IMAP, JMAP, Maildir) corre en su propia goroutine. Implementa:
*   `Run()`: Bucle `select` que espera mensajes del canal `Actions()`.
*   `handleMessage(msg)`: Un `switch` sobre el tipo de mensaje recibido.
*   Llama a la biblioteca de red subyacente (`go-imap`, `go-jmap`).
*   Devuelve resultados como mensajes al canal `Messages`.

### Capa 5: Transporte de Red
Las librerías Go puras que manejan el protocolo de red crudo. No tienen conciencia de aerc.
*   `github.com/emersion/go-imap/client` para IMAP.
*   `git.sr.ht/~rockorager/go-jmap` para JMAP.

## Paralelismo
Varias cuentas pueden estar abiertas simultáneamente, cada una con su propia goroutine de Worker. Todos los Workers comparten el mismo canal de mensajes de vuelta (`app.WorkerMessages`), y el bucle principal del `main.go` los procesa secuencialmente en el hilo de UI (evitando condiciones de carrera en los widgets).
