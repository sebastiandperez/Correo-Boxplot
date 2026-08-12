# 12 - Modelo de Dominio

[COMPROBADO]

El modelo de dominio de Himalaya reside en la capa compartida (`src/shared/email/`). Como el objetivo del proyecto es dar una interfaz unificada sin importar el servidor que esté detrás (IMAP vs JMAP), el modelo de dominio está diseñado para ser el **Mínimo Común Múltiplo** entre los protocolos.

## Entidades (Shared API)

*   `Mailbox`: El equivalente a una Carpeta. Muy simplificado (ID, nombre, total de correos y total no leídos). A diferencia del modelo estricto JMAP (padre-hijo en Stormbox), aquí a menudo es solo un string con nombre.
*   `Envelope`: Es un "sobre". Representa la metadata del correo sin el peso del cuerpo (Sender, Recipients, Date, Subject, Flags). Se usa masivamente para renderizar la tabla por consola sin saturar la red.
*   `Message`: Un correo completo en crudo (el formato RFC 5322 en un Array de bytes/string).
*   `Flag`: Representa tanto las System Flags estándar de IMAP (`\Seen`, `\Draft`) como los Keywords de JMAP.
*   `Address`: La estructura `{ name: String, email: String }`.
*   `Attachment`: Estructura para separar partes MIME identificadas como documentos binarios adjuntos.

## Diferencia Clave con Stormbox
Al no existir SQLite para hacer `JOINs`, no hay relaciones entre entidades en la memoria persistente. Cuando pides una lista de `Envelopes`, se instancia una lista de objetos Rust y se destruyen un segundo después cuando el programa termina su ejecución. No hay "Entidad Account" en la memoria de la misma forma, más allá de la configuración leída de tu `~/.config/himalaya/config.toml`.
