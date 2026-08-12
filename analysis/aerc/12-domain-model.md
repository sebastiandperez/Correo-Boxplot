# 12 - Modelo de Dominio

[COMPROBADO — `models/`]

El modelo de dominio de aerc está en el paquete `models/`. A diferencia de Himalaya (donde el modelo es el MCD entre protocolos) o Stormbox (donde el modelo refleja JMAP casi literalmente), aerc tiene un modelo orientado al TUI — lo que el widget de pantalla necesita conocer para dibujarse.

## Entidades Principales (`models/`)

*   **`MessageInfo`**: La entidad central de la lista de correos. Contiene el `Envelope` (De, Para, Asunto, Fecha), los `Flags` (`SeenFlag`, `AnsweredFlag`, `FlaggedFlag`, `RecentFlag`, `DraftFlag`), el UID, el tamaño, y opcionalmente un `Index` (posición en la vista, usado por JMAP para saber dónde insertar en la lista).
*   **`Envelope`**: Subentidad con De, Para, Cc, Bcc, Asunto, Fecha y Message-ID.
*   **`FullMessage`**: Un mensaje completo con su `BodyStructure` MIME y un `io.Reader` para el contenido crudo. Se construye al abrir un correo.
*   **`Directory`**: Metadatos de una carpeta (nombre, rol como `"inbox"`, total de mensajes, no leídos).
*   **`DirectoryInfo`**: Conteos actualizados de una carpeta abierta.
*   **`Flags`**: Un tipo de bits (bitmask) donde cada bit representa una bandera estándar.
*   **`Capabilities`**: Las extensiones que soporta el servidor conectado (`Sort`, `Thread`, `Extensions` como `LIST-STATUS`).

## Diferencias Clave con los otros Modelos
*   El `UID` en aerc es un tipo opaco (`models.UID = string`). IMAP usa `uint32`, JMAP usa un string opaco — aerc convierte ambos a string y los trata igual en la UI.
*   El `Index *int` en `MessageInfo` es específico de JMAP: indica en qué posición de la lista ordenada debe insertarse el mensaje para que la UI lo muestre correctamente.
*   No existe el concepto de "Thread" en el modelo compartido como entidad de primera clase (solo en el backend JMAP/notmuch).
