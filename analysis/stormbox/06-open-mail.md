# 06 - Abrir un correo

[COMPROBADO]

Cuando el usuario hace clic en un mensaje de la lista para leerlo, Stormbox intenta ser lo más rápido posible mediante un enfoque cache-first.

## Flujo paso a paso

1.  **Interacción de UI:** El usuario selecciona el mensaje. La interfaz actualiza `selectedMessageId` en el `mail-store.ts` de Pinia.
2.  **Lectura de caché local (SQLite):** El store invoca, a través del Worker, la función `getMessageBodyForDisplay(messageId)`. El Worker primero pregunta a la base de datos si ya tiene descargado el cuerpo del correo.
    *   *Nota:* Los correos descargan inicialmente solo sus metadatos (asunto, remitente) para poblar la lista. El cuerpo (body) es diferido y solo se baja cuando se abre o por un prefetch cercano.
3.  **Cache Hit (El cuerpo existe):** Si SQLite tiene el cuerpo (HTML, texto y lista de attachments), se devuelve inmediatamente a la UI. No se hace ninguna petición de red.
4.  **Cache Miss (El cuerpo no existe):**
    *   Si no existe, el Worker invoca `ensureMessageBodyForDisplay` (que a su vez encola una promesa de `Email/get` solicitando específicamente los campos `bodyValues`, `textBody`, `htmlBody`).
    *   Esta petición JMAP tiene alta prioridad (no se bloquea por descargas batch de fondo) y se comparte entre múltiples peticiones idénticas (evitando carreras).
    *   El servidor JMAP responde con el texto y HTML.
    *   El Worker guarda esto en SQLite (en la tabla `messages`, campo `body_fetched_at` y tablas anexas de cuerpos).
    *   Finalmente, vuelve a leer de la caché local y lo devuelve a la UI.
5.  **Renderizado Seguro:** El HTML descargado pasa por `dompurify` (visto en `package.json`) antes de inyectarse en el DOM. Además, si tiene imágenes en línea (MIME `cid:`), el Worker descarga el blob real y la UI construye un `data: URL` en la memoria local.
6.  **Marcar como Leído:** En paralelo a la visualización, la capa de Aplicación lanza una Mutación (`runMutation` -> `replaceFolderMembership` o actualización de `keywords` quitando `\$seen`/agregando leídos).
    *   Esta mutación actualiza inmediatamente SQLite (Optimistic Update) para que el correo se vea "leído" instantáneamente en la interfaz.
    *   Al mismo tiempo, la mutación se graba en la tabla de `pending_mutations`.
    *   El `Outbox Runner` la toma de fondo y ejecuta el `Email/set` en JMAP para notificar al servidor del cambio de estado.

### ¿Se descargan los Attachments bajo demanda?
[INFERIDO basado en JMAP]: El protocolo JMAP descarga los metadatos de los adjuntos (nombre, tamaño) junto con el body. Sin embargo, el contenido binario del adjunto (el archivo) no se descarga hasta que el usuario le da a "Descargar".
