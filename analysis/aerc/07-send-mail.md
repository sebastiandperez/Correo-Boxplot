# 07 - Enviar correo

[COMPROBADO — `app/compose.go`, `worker/types/messages.go`]

El proceso de envío de aerc es bastante sofisticado. Usa el tipo de mensaje `types.StartSendingMessage` y la respuesta `types.MessageWriter` para enviar el mensaje como un stream de bytes.

## Flujo de Envío

1. El usuario redacta en el widget `compose.go` y pulsa el atajo de "Enviar".
2. La UI construye el mensaje MIME completo en memoria (usando `go-message`) aplicando las identidades, cabeceras configuradas y el cuerpo.
3. Envía al Worker un `types.StartSendingMessage` con el remitente (`From`) y la lista de destinatarios (`Rcpts`).
4. El Worker responde con un `types.MessageWriter`, que contiene un `io.WriteCloser` — básicamente un pipe.
5. La UI escribe los bytes del mensaje MIME en ese pipe.
6. El Worker consume los bytes del otro extremo del pipe y los envía al servidor de correo.

## Por Protocolo
*   **SMTP:** El Worker SMTP escribe los bytes directamente al servidor SMTP mediante la librería `go-smtp`.
*   **JMAP:** El Worker JMAP llama a `Blob/upload` primero para subir los bytes como blob, y luego invoca `Email/set` + `EmailSubmission/set` en un batch, igual que Stormbox.
*   **Copia a "Sent":** Dependiendo de la configuración de la cuenta, aerc puede también hacer un `types.AppendMessage` para guardar una copia del mensaje enviado en la carpeta "Enviados" (necesario en SMTP+IMAP, no necesario en JMAP).
