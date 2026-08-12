# 07 - Enviar correo

[COMPROBADO]

El envío de correos se gestiona mediante una arquitectura robusta que separa la composición (UI) del envío real en red (Outbox Runner), lo que permite redactar y "enviar" offline sin perder datos.

## Flujo de envío

1. **Composición (UI):**
   * El usuario redacta un mensaje en el `Composer` (usando Vue y `squire-rte` para HTML).
   * El estado del borrador se mantiene en memoria en `compose-store.ts`.
   * **Manejo de destinatarios y headers:** Se parsean usando utilidades locales (como `parseAddressList`) y se guardan en el estado reactivo (`draft.to`, `draft.cc`).

2. **Acción de Enviar (UI -> Store):**
   * Al hacer clic en "Enviar", el `compose-store.ts` invoca `repo.insertPendingMutation`.
   * En lugar de llamar directamente a la red, inserta una intención estructurada (`MUTATION_TYPE.SEND`) en la tabla `pending_mutations` de SQLite, incluyendo el JSON con el remitente, los destinatarios, el asunto y el HTML.
   * La UI cambia su estado a `SENT` y se cierra, engañando al usuario de que ya se envió, aunque realmente solo se encoló localmente.

3. **Outbox Runner (Background Worker):**
   * El `Outbox Runner` (en el SharedWorker) es notificado de que hay una nueva mutación pendiente.
   * Llama a `runSend` (`src/sync/backends/jmap/outbox.ts`).

4. **Procesamiento de Attachments (Imágenes Inline):**
   * Antes de armar la petición JMAP, extrae las imágenes pegadas como `data: URL` del cuerpo HTML.
   * Para cada imagen, la sube al servidor (Blob upload) y reemplaza la URL en el HTML por un `cid:` (Content-ID).
   * Estructura MIME: JMAP no ensambla el MIME por el cliente para el envío, pero el cliente define la estructura `multipart/related` -> `multipart/alternative` para que JMAP sepa cómo construir el mensaje saliente de forma estándar.

5. **Llamadas JMAP Batch:**
   * El `runSend` realiza un batch JMAP espectacular aprovechando las capacidades del protocolo:
     1.  Llama a `Email/set` para **crear** el correo en la carpeta `Outbox` o `Drafts` (usando un id temporal `c1`).
     2.  En la misma petición, llama a `EmailSubmission/set` referenciando a `#c1` para **enviar** el correo.
     3.  Utiliza la propiedad `onSuccessUpdateEmail` para pedirle al servidor: "Si logras enviarlo, mueve el correo de la carpeta `Outbox` a `Sent`, quítale la etiqueta `$draft` y ponle `$seen`".

6. **Gestión de Errores y Reintentos:**
   * Si la red falla o el servidor devuelve un error temporal (e.g. `transport` o `serverUnavailable`), la mutación se queda en SQLite con estado `retry`. El `Outbox Runner` utiliza un backoff exponencial (temporizador) para reintentar más tarde, sin intervención del usuario.
   * Si hay pérdida de internet durante el envío, la petición queda pausada y el Runner la reintentará cuando el WebSocket o los pings detecten conexión de nuevo.
