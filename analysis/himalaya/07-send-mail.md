# 07 - Enviar correo

[COMPROBADO]

El envío en Himalaya se realiza componiendo un mensaje localmente y alimentándolo a la herramienta (`himalaya message send`), donde Himalaya toma los bytes crudos y los despacha.

## Flujo según el backend activo

Una decisión arquitectónica brillante (y obligatoria debido a la naturaleza de los protocolos) se encuentra en la clase `EmailClient` (`src/shared/client.rs`). Cuando Himalaya pide enviar un mensaje, verifica las capacidades del backend:

### Caso A: Protocolos que saben enviar (JMAP, Gmail API, Msgraph)
Si tienes configurado JMAP, el protocolo mismo define cómo depositar y enviar un correo simultáneamente. El `EmailClient` de Himalaya se salta SMTP y llama a `JmapClient::send_message()`. En JMAP, esto se traduce (al igual que en Stormbox) a crear el correo en la cuenta y ordenar su sumisión de red (`EmailSubmission/set`).

### Caso B: Protocolos que solo saben almacenar (IMAP, Maildir)
IMAP no envía correos; su única utilidad es sincronizar carpetas.
Si tu almacenamiento principal es IMAP, al llamar a "enviar", el `EmailClient` se da cuenta de que IMAP es mudo. 
1. Himalaya carga el transporte **SMTP** (`SmtpTransport`) que el usuario debe haber proporcionado en la configuración.
2. Abre la conexión SMTP (usando la librería `lettre`) y empuja el correo directamente al servidor de salida (MTA).
3. **¿Cómo queda en Enviados?** El SMTP se encarga de enviarlo a destino, pero *no* lo guarda en la carpeta "Enviados". Himalaya tiene que abrir explícitamente una sesión IMAP a continuación y usar el comando `APPEND "Sent" <mensaje_crudo>` para subir manualmente el correo a la bandeja de salida.

## Manejo de Adjuntos / Multiformato
Himalaya no tiene el concepto de "subir blobs primero y referenciarlos por ID" que vimos en Stormbox con JMAP. El usuario compone el MIME completo (incluyendo los adjuntos codificados en Base64 adentro del mismo bloque de texto) mediante utilidades, y Himalaya envía el bloque entero de un solo golpe.
