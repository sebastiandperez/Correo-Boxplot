# 01 - Overview (Visión General)

[COMPROBADO]

Himalaya es un cliente de correo de línea de comandos (CLI) escrito en **Rust**. A diferencia de Stormbox (que es una aplicación web *Local-First* y puramente JMAP), Himalaya es una herramienta CLI "stateless" (sin estado persistente local complejo como una base de datos SQLite) que permite gestionar correos usando comandos de terminal cortos y directos.

El enfoque arquitectónico principal de Himalaya es la **abstracción multi-protocolo**.

## Filosofía del Cliente

1. **Backend Agnostic (Interoperabilidad):** Himalaya expone comandos unificados (ej. `himalaya envelope list` o `himalaya mailbox list`) y el código traduce internamente estas peticiones genéricas al protocolo del servidor en el que tienes tu cuenta configurada.
2. **Soporte de múltiples backends:**
   * **IMAP / SMTP** (El protocolo tradicional, soportando Auth básica y OAuth2).
   * **JMAP** (Protocolo moderno, implementado de forma nativa).
   * **Gmail REST API** (Google no recomienda IMAP para OAuth2 nuevo).
   * **Microsoft Graph API** (Outlook/Office365).
   * **Maildir / m2dir** (Formatos de almacenamiento de correo locales para usarse con sincronizadores externos como `mbsync` o `offlineimap`).
3. **Stateless (Sin Caché Local Pesada):** A diferencia de Stormbox, Himalaya no clona los metadatos de tu buzón en una base de datos local SQLite (salvo si usas `maildir` como backend, donde los archivos locales *son* la base de datos). Cuando ejecutas `himalaya envelope list`, Himalaya se conecta al servidor, hace el `FETCH` o el `query`, imprime el resultado en la consola y cierra la sesión. No hay un "SharedWorker" sincronizando en segundo plano.

## El Rol de la Capa de Traducción (Shared API)

La "traducción" a la que te referías es el núcleo del proyecto. 
En la carpeta `src/shared/`, Himalaya define estructuras de datos agnósticas: `Envelope` (Metadatos), `Mailbox` (Carpeta), `Flag` (Etiquetas), `SearchEmailsQuery` (Consultas de búsqueda).

Luego, en cada subdirectorio de backend (`src/imap`, `src/jmap`, `src/gmail`, etc.), existe un archivo `backend.rs` que implementa la traducción de la API compartida hacia los comandos nativos de ese protocolo usando el cliente subyacente de cada tecnología (ej. la librería `io-imap` para IMAP).

## ¿Cómo aporta esto a nuestro proyecto futuro?

Nuestro cliente objetivo usará JMAP-first con una capa de compatibilidad IMAP. 
Himalaya demuestra **exactamente cómo hacer esto a nivel de dominio**. Define un `EmailClient` abstracto y adapta los comandos. Si nosotros guardamos los correos en SQLite usando el esquema JMAP, nuestro "IMAP Translator" puede inspirarse en `src/imap/backend.rs` de Himalaya, donde traducen conceptos como:
* Las consultas de búsqueda complejas de usuario (`SearchEmailsQuery`) a un árbol de `SearchKey` de IMAP.
* Los `flags` universales a los `SystemFlags` de IMAP (`\Seen`, `\Deleted`).
* Las operaciones de listado con paginación usando rangos numéricos IMAP (`SequenceSet`).
