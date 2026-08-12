# 09 - JMAP

[COMPROBADO]

Himalaya soporta JMAP como uno de sus múltiples "backends" (almacenamientos). 

Cuando el usuario configura una cuenta JMAP (`jmap.server = "https://api.fastmail.com/jmap/session"`), Himalaya carga el módulo `src/jmap/backend.rs`.

## Cómo implementa JMAP

A diferencia de Stormbox, donde JMAP era la sangre del cliente, en Himalaya, JMAP es "un conector más". 

Para comunicarse con el servidor JMAP, Himalaya utiliza una librería auxiliar de la misma familia Pimalaya: `io-jmap`.
Esta librería se encarga de serializar y deserializar JSON crudo y enviarlo vía peticiones HTTP `POST` utilizando un token Bearer (ej. desde una configuración OAuth2 o app password).

Las llamadas compartidas se mapean a JMAP:
*   `list_envelopes`: Llama a `Email/query` y luego a `Email/get`.
*   `send_message`: Llama a `Email/set` (create) y `EmailSubmission/set`.

### Lo que NO se aprovecha de JMAP en Himalaya
*   **WebSockets:** Como Himalaya es un CLI que se ejecuta, imprime datos y muere (Stateless), no tiene sentido abrir un WebSocket para notificaciones Push. Por lo tanto, el cliente usa exclusivamente HTTP corto.
*   **Sincronización Diferencial (`sinceState`):** Himalaya no guarda una base de datos local. Por tanto, no puede usar la principal ventaja de JMAP: preguntar "qué cambió desde ayer". Siempre tiene que preguntar "dame los primeros 10 correos de la bandeja de entrada".

Esto nos demuestra que un diseño JMAP mal aprovechado (sin caché local) degrada su rendimiento a algo similar a las APIs REST tradicionales.
