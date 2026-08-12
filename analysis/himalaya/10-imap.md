# 10 - IMAP

[COMPROBADO]

IMAP es quizás el protocolo mejor soportado en Himalaya, habiendo sido históricamente el enfoque inicial de muchos clientes de correo clásicos.

Himalaya utiliza la librería de Rust `io-imap` (creada por la misma comunidad) para manejar la pesadilla de parsear respuestas asíncronas de servidores IMAP antiguos.

## La capa de traducción (`src/imap/backend.rs`)

Es fascinante cómo Himalaya abstrae las idiosincrasias de IMAP para ajustarlo a la API compartida:

1. **Búsqueda (`search_envelopes`):**
   Toma un `SearchEmailsQuery` (ej. "From: Alice") y lo traduce recursivamente a un árbol lógico `SearchKey` compatible con IMAP (`SearchKey::And`, `SearchKey::Or`, `SearchKey::From`).

2. **Paginación (`SequenceSet`):**
   IMAP no tiene una API amigable de paginación como REST o JMAP (donde simplemente pides "limit 10 offset 20"). Himalaya simula esto haciendo un `SELECT` (que devuelve un total `EXISTS n`), calcula matemáticamente qué IDs secuenciales (Uids) corresponden a la página solicitada, y luego envía un `FETCH` pidiendo únicamente esos UIDs.
   Además, intenta usar la extensión de servidor IMAP `SORT` para traer los UIDs ordenados. Si el servidor IMAP del usuario no soporta la extensión `SORT` (muy común), Himalaya descarga todos los UIDs (que pueden ser miles), los ordena **localmente en RAM (Client-side sorting)**, pagina la porción de array, y luego envía un `FETCH` a los pocos UIDs paginados resultantes.

3. **Flags (Banderas):**
   Himalaya mapea las etiquetas internas estandarizadas (`Seen`, `Answered`, `Flagged`) directamente a los **SystemFlags** de IMAP (`\Seen`, `\Answered`, `\Flagged`). Las etiquetas adicionales creadas por el usuario se mapean como _Keywords_.
