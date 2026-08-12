# 13 - Mapa del Código

Rutas recomendadas para explorar el código de aerc:

### El Bucle de Vida del Proceso
1. `main.go`: El `select` del bucle principal. Aquí se ven todos los canales que aerc vigila simultáneamente.
2. `app/account.go`: Cómo se gestiona una cuenta individual: manejo de errores de conexión, reintento, y despacho de acciones al Worker.

### El Bus de Mensajes (Corazón de la Arquitectura)
1. `worker/types/messages.go`: Leer todos los tipos. Es el "protocolo interno" de aerc. Entiéndelo y entiendes el flujo completo.
2. `worker/types/worker.go`: El struct `Worker` con `PostAction` y `PostMessage`. Aquí está la lógica de los canales y callbacks.

### El Backend IMAP (El más complejo)
1. `worker/imap/worker.go`: El `Run()` con su `select`. El `handleMessage()` con el gran `switch` de tipos. El `handleImapUpdate()` que traduce updates del servidor.
2. `worker/imap/idler.go`: Cómo funciona IDLE con debounce y goroutines.
3. `worker/imap/fetch.go`: Cómo se construyen las peticiones FETCH con las propiedades necesarias.

### El Backend JMAP (El más instructivo para nuestro proyecto)
1. `worker/jmap/push.go`: La goroutine de EventSource y el `handleChange()`. Aquí está el corazón del sistema de sincronización diferencial.
2. `worker/jmap/worker.go`: El gran `switch` de mensajes de JMAP.
3. `worker/jmap/cache/`: La interfaz con LevelDB para persistencia de estados.

### El Modelo de Datos
1. `models/`: Los structs `MessageInfo`, `Envelope`, `Flags`, `Directory`. Todo lo que la UI necesita conocer.
