# Arquitectura de Aerc - Resumen Pedagógico

Aerc es un cliente de correo para la terminal (TUI) escrito en Go. Mientras que Himalaya es una herramienta de un solo disparo que muere al terminar, aerc vive permanentemente en tu terminal como un proceso interactivo, mostrando tus correos en tiempo real.

---

### 1. Qué hace este cliente
Aerc es una aplicación de terminal que imita el comportamiento de clientes de escritorio tradicionales pero desde la línea de comandos. Muestra un árbol de carpetas a la izquierda, una lista de correos en el centro y el contenido del correo a la derecha. Responde a atajos de teclado en lugar de clics de ratón. Soporta IMAP, JMAP, Maildir y otros formatos simultáneamente, incluso con múltiples cuentas abiertas al mismo tiempo en pestañas.

### 2. El Secreto: Actor/Worker con Canales de Go
La decisión arquitectónica más valiosa de aerc es que **la UI y la Red nunca se tocan directamente**. Funcionan como actores independientes que solo se comunican a través de mensajes tipados en canales (similares a buzones de correo entre departamentos).

Cuando pulsas `d` para borrar un correo:
1. La interfaz construye un sobre (`DeleteMessages{uids: [42]}`) y lo mete en el buzón del backend.
2. El backend IMAP (corriendo en su propio hilo de Go) lo recoge, traduce a `UID STORE +FLAGS \Deleted` + `UID EXPUNGE`, espera el OK del servidor, y pone en el buzón de vuelta: `MessagesDeleted{uids: [42]}`.
3. La UI recoge ese sobre de respuesta y elimina la fila de la pantalla.

Nunca hay llamadas directas entre capas. Nunca hay bloqueos. Todo es asíncrono.

### 3. Correos Nuevos en Tiempo Real
Aerc no tiene que pulsar F5 para ver correos nuevos.

*   Con **IMAP**, usa la extensión IMAP IDLE: mantiene una conexión TCP abierta indefinidamente. El servidor le "grita" cuando llega algo nuevo. Aerc recibe el aviso, descarga el correo nuevo y lo muestra automáticamente.
*   Con **JMAP**, usa Server-Sent Events: una conexión HTTP de larga duración por la que el servidor envía pequeñas notificaciones de texto. Al recibir una, aerc pregunta solo por los cambios desde la última vez, actualizando la pantalla en milisegundos.

### 4. Caché para JMAP
El backend JMAP de aerc guarda en disco (usando LevelDB, una base de datos de clave-valor) los "tokens de estado" de JMAP y los metadatos de correos. Esto significa que la próxima vez que abras aerc, la lista de carpetas y mensajes aparece instantáneamente desde la caché local mientras se actualiza en background.

### 5. IMAP al Máximo
A diferencia de Himalaya (donde IMAP es un adaptador más), aerc conoce las profundidades de IMAP: usa IMAP SORT para ordenar en el servidor, IMAP THREAD para agrupar conversaciones, LIST-STATUS para obtener conteos en un solo viaje, y maneja la complejidad del mapa de números de secuencia (SeqMap) que necesita cualquier cliente IMAP serio.

### 6. Qué nos llevamos para nuestro cliente Python
Aerc nos enseña la lección más importante de los tres clientes:

**El bus interno de eventos es el eje central.** Define tus eventos de dominio una sola vez (`MessageReceived`, `FolderUpdated`, `MessageDeleted`) y conecta todos los backends (JMAP, IMAP, cualquier otro) para que emitan esos mismos eventos. La UI solo habla con el bus, nunca con los backends directamente.

En Python, esto se traduce en un diseño `asyncio` con `asyncio.Queue` como bus de mensajes, corrutinas como Workers por backend, y el event loop como árbitro. El patrón es exactamente el mismo que el de aerc con goroutines y canales de Go.
