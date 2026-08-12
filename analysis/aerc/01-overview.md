# 01 - Overview (Visión General)

[COMPROBADO]

Aerc es un cliente de correo electrónico **TUI (Terminal User Interface)** escrito en **Go**. A diferencia de Himalaya (CLI stateless que muere tras cada comando) o Stormbox (web app), aerc vive permanentemente en tu terminal como un proceso interactivo con un bucle de eventos, parecido en concepto a aplicaciones como `vim` o `htop`.

## Filosofía

*   **TUI con estado persistente:** Aerc tiene un bucle de eventos central que corre indefinidamente mientras el usuario lo use. Mantiene conexiones abiertas con los servidores de correo, gestiona múltiples cuentas simultáneamente, y reacciona a notificaciones en tiempo real.
*   **Arquitectura Actor/Worker (Goroutines + Canales de Go):** La UI y los backends de red son actores independientes que se comunican únicamente a través de mensajes tipados enviados por canales de Go (`chan WorkerMessage`). Esto es el núcleo arquitectónico del proyecto.
*   **Multi-protocolo por diseño:** Igual que Himalaya, define una interfaz interna de mensajes (`worker/types/messages.go`) que todos los backends deben saber manejar. Soporta IMAP, JMAP, Maildir, Notmuch y mbox.
*   **Push real:** Al ser un proceso vivo, aerc puede mantener conexiones de larga duración:
    *   IMAP: usa la extensión **IMAP IDLE** (RFC 2177) para que el servidor notifique al cliente de correos nuevos sin polling.
    *   JMAP: usa **Server-Sent Events (EventSource)** para notificaciones Push de `StateChange`.
*   **Caché opcional:** El backend JMAP tiene una caché en disco basada en **LevelDB** para metadatos de correos y estados de sincronización, permitiendo una carga más rápida en reconexiones.

## Lenguaje y Dependencias Clave
*   **Go** (sin frameworks web, con `go-imap`, `go-jmap`).
*   Librería TUI: `tcell` y una capa propia en `lib/ui/`.
*   JMAP Push: `go-jmap/core/push` (Server-Sent Events).
*   IMAP IDLE: `go-imap` con la extensión de sorteo y threading.
*   Caché JMAP: `github.com/syndtr/goleveldb/leveldb`.
