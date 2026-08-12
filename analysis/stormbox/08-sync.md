# 08 - Sincronización

[COMPROBADO]

El modelo de sincronización en Stormbox está diseñado alrededor del concepto de "State" de JMAP. Es extremadamente eficiente porque nunca pide datos que ya tiene.

## Fuentes de Verdad
*   **Estado local:** La base de datos SQLite (tablas `messages`, `folders`, `query_views`, `query_view_items`).
*   **Estado remoto:** Servidor JMAP.
*   **Fuente de verdad definitiva:** El servidor JMAP. Si hay discrepancias (por ejemplo, recuentos de carpetas que no cuadran), Stormbox tiene un mecanismo de "Drift Detection" (`checkFolderViewConsistency`) que borra la vista local de esa carpeta y la reconstruye desde el servidor.

## Cómo detecta cambios y divergencias
El proyecto aprovecha los "State IDs" (cadenas que representan una versión del estado en el servidor):
*   Cada vez que la UI carga una carpeta, verifica el `queryState`.
*   El servidor avisa vía WebSockets (`StateChange`) que el estado ha cambiado.

Stormbox implementa dos mecanismos principales:

### 1. Sincronización Inicial de una Vista (`syncFolderWindow`)
Cuando el usuario abre una carpeta por primera vez o se fuerza un reseteo:
*   Se ejecuta `Email/query` para la carpeta con un `limit`. Esto devuelve un `queryState` y una lista de IDs de correos.
*   En la **misma petición HTTP/WS** (gracias a los *back-references* de JMAP `"#ids": { "resultOf": ... }`), hace un `Email/get` pidiendo los metadatos de esos correos.
*   Se guarda todo en la base de datos (SQLite) y la vista se renderiza.

### 2. Sincronización Incremental (`syncFolderWindowChanges` y `syncEmailChanges`)
Cuando ya se tiene un estado guardado (ej. `state: 'abc'`) y llega un aviso de cambio:
*   **Para carpetas (Vistas):** Hace `Email/queryChanges` pasando `sinceQueryState: 'abc'`. El servidor responde con qué IDs se agregaron (added) y cuáles se eliminaron (removed) de esa vista en específico.
*   **A nivel de cuenta (Global):** Hace `Email/changes` pasando `sinceState: 'xyz'`. El servidor responde con `created`, `updated` y `destroyed`.
    *   Si hubo *created* o *updated*, Stormbox hace `Email/get` solo para esos IDs específicos.
    *   Si hubo *destroyed*, borra los IDs directamente de SQLite.
*   Al terminar, guarda el nuevo `state` devuelto por el servidor para la próxima vez.

## Resolución de conflictos
[INFERIDO basado en JMAP]: JMAP define que el servidor siempre gana. El cliente manda comandos `*/set` (mutaciones) basados en un estado. Si otra pestaña u otro cliente modificó el mismo objeto, JMAP devuelve un error de estado inconsistente y Stormbox vuelve a descargar la versión del servidor. Sin embargo, en el código de Outbox de Stormbox, las mutaciones se envían de forma aditiva y si fallan se quedan en `retry` o terminal (`notUpdated`), requiriendo que la próxima sincronización limpie el estado.
