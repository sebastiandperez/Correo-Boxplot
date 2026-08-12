# 05 - Recibir correo (Listar)

[COMPROBADO]

Al ser una herramienta CLI, Himalaya no "recibe" correo activamente en el sentido tradicional (no hay webhooks ni WebSockets escuchando notificaciones Push de fondo). En su lugar, es el usuario (o un script como `cron`) el que explícitamente solicita listar los correos nuevos, típicamente con el comando `himalaya envelope list`.

## Flujo paso a paso (Ejemplo: Backend IMAP)

1. El usuario ejecuta `himalaya envelope list --page 1 --page-size 10`.
2. Himalaya se conecta al servidor IMAP (TCP + TLS).
3. Autentica la sesión (SASL PLAIN, OAuth, etc.).
4. Ejecuta un comando IMAP `SELECT "INBOX"`. El servidor responde con el total de mensajes existentes (`EXISTS 100`).
5. El cliente calcula la paginación a nivel de rangos de red. Si hay 100 mensajes y pediste la página 1 con 10 correos, el rango se calcula localmente como los mensajes del `91:100`.
6. Himalaya envía un comando de obtención rápida: `FETCH 91:100 (UID FLAGS ENVELOPE RFC822.SIZE)`. Nótese que **no pide el cuerpo del mensaje**, solo los sobres (Envelopes).
7. Convierte la respuesta textual IMAP de nuevo en estructuras Rust (`Envelope`), y cierra la sesión TCP/TLS.
8. Imprime la tabla por pantalla y el proceso muere.

## Diferencias críticas con Stormbox
* No hay almacenamiento de estados. Cada ejecución del comando es un "borrón y cuenta nueva". Si ejecutas el comando dos veces, Himalaya descarga los mismos metadatos del servidor de correo dos veces.
* En Stormbox el servidor avisaba al cliente; aquí el cliente es un "Puller" estricto bajo demanda.
