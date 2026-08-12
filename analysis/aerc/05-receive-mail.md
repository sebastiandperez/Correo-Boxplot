# 05 - Recibir correo

[COMPROBADO]

Aerc puede detectar correos nuevos sin que el usuario haga nada, gracias a conexiones de larga duración. El mecanismo difiere por protocolo.

## Caso A: Backend IMAP (IDLE)

[COMPROBADO — `worker/imap/idler.go`]

1. Aerc conecta al servidor IMAP y hace un `SELECT "INBOX"` inicial para cargar la lista de mensajes.
2. Una vez que no hay acciones pendientes, el Worker IMAP llama a `startIdler()`.
3. El Idler lanza una goroutine que ejecuta `client.Idle(stop_channel, nil)`. Esta es una llamada **bloqueante**: mantiene la conexión TCP abierta enviando periódicamente un NOOP para que el servidor no la cierre, esperando pasivamente.
4. El servidor IMAP, al recibir un correo nuevo, envía un frame no solicitado. La librería `go-imap` lo parsea y lo emite en el canal `updates` como un `client.MailboxUpdate` (nuevo conteo) o `client.MessageUpdate` (flags cambiadas).
5. El Worker recibe ese update en el `case update := <-w.updates:` de su `Run()`, lo traduce a un mensaje `types.MessageInfo` (con los metadatos del nuevo correo), y lo envía al hilo principal mediante `worker.PostMessage`.
6. La UI recibe el `MessageInfo`, lo inserta en la lista de mensajes y fuerza un redibujado de la pantalla.

**Cuando llega una nueva acción**, el Idler se detiene gracefully (`idler.Stop()`) antes de enviar el comando al servidor, porque IMAP es un protocolo half-duplex: solo puedes tener un comando en curso a la vez.

## Caso B: Backend JMAP (Server-Sent Events)

[COMPROBADO — `worker/jmap/push.go`]

1. Al conectar, el Worker JMAP lanza una goroutine que abre un `EventSource` HTTP de larga duración (SSE - Server-Sent Events).
2. Al recibir un evento `StateChange` del servidor, `handleChange()` es invocado.
3. Construye un batch de peticiones JMAP usando back-references (igual que Stormbox): `Mailbox/changes`, `Email/queryChanges`, `Email/changes` con los estados guardados en la caché LevelDB.
4. Actualiza la caché y emite mensajes `types.MessageInfo` a la UI.
