# 06 - Abrir un correo

[COMPROBADO]

Cuando el usuario selecciona un mensaje de la lista con el cursor y pulsa ENTER (o una tecla configurada), la UI envía al Worker la acción de obtener el cuerpo.

## Flujo (Backend IMAP)

1. La vista `msglist.go` detecta la selección. La capa de comandos construye un `types.FetchMessageBodyPart` con el UID del mensaje.
2. El Worker IMAP detiene el Idler (para poder enviar comandos).
3. Envía `UID FETCH <uid> BODY.PEEK[1]` (o la parte MIME específica que pide el viewer).
4. Recibe el stream de bytes crudos del servidor.
5. Emite un `types.FullMessage` al hilo principal con el contenido.
6. Reanuda el Idler.
7. La UI parsea el correo (MIME, HTML a texto, adjuntos) usando las librerías de Go y lo muestra en `msgviewer.go`.

## Caché de Headers
Para la lista de correos, aerc hace un `FetchMessageHeaders` (más ligero) para poblar la vista. El cuerpo completo solo se baja al abrir un mensaje concreto. Sin embargo, **a diferencia de Stormbox**, aerc no guarda los cuerpos en caché entre reinicios (la caché LevelDB del JMAP Worker guarda metadatos y estados, no los cuerpos MIME completos). Cada apertura de correo hace un `FETCH` de red.

## Marcar como leído
Inmediatamente después de mostrar el correo, la UI envía un `types.FlagMessages` con `Enable: true` y `Flags: models.SeenFlag`. El Worker lo traduce a `UID STORE <uid> +FLAGS (\Seen)` en IMAP o `Email/set` en JMAP.
