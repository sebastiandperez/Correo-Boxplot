# 06 - Abrir un correo (Leer)

[COMPROBADO]

De forma análoga a la recepción, la lectura requiere un comando explícito, como `himalaya message read <ID>`.

## Flujo paso a paso (Ejemplo: Backend IMAP)

1. El usuario invoca el comando con el UID de un mensaje.
2. Himalaya establece una nueva conexión TCP/TLS desde cero hacia el servidor IMAP.
3. El `EmailClient` llama al método `get_message` del adaptador IMAP.
4. El adaptador IMAP selecciona la carpeta (`SELECT`) y envía un comando muy específico: `UID FETCH <ID> (BODY.PEEK[])`.
    * El uso de `BODY.PEEK[]` es intencionado: por defecto, leer el cuerpo del mensaje en IMAP usando `BODY[]` altera el estado del mensaje y lo marca como Leído (`\Seen`) automáticamente en el servidor. Himalaya quiere control sobre esto, por lo que pide "espiar" el cuerpo sin marcarlo como leído (a menos que el usuario haya especificado una bandera explícita `--seen`).
5. El servidor devuelve el chorro de bytes (raw bytes) correspondientes al formato RFC 5322 (cabeceras completas, MIME parts, adjuntos).
6. El cliente cierra la conexión de red.
7. Himalaya parsea el formato crudo localmente, extrae la parte de texto (o HTML), lo formatea (puede usar un paginador si está configurado) y lo expulsa por la salida estándar `stdout`.

## Falta de Caché
Como Himalaya no tiene base local, **cada vez** que pides "abrir" el correo, se descarga completamente de nuevo desde la red.
