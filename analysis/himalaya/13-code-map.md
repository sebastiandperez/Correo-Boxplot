# 13 - Mapa del Código

Si deseas explorar cómo funciona la arquitectura de Himalaya, estas son las rutas clave:

### Para entender la Interoperabilidad
1. `src/shared/client.rs`: El núcleo. Busca el struct `EmailClient`. Verás cómo enruta comandos como `list_envelopes` o `send_message` hacia el almacenamiento (`storage`) o el transporte SMTP (`smtp`).
2. `src/backend.rs`: Define el enum `Backend` (Imap, Jmap, Gmail, etc).

### Para entender el Modelo Universal
Ve a la carpeta `src/shared/email/`.
1. `src/shared/envelope/mod.rs`: Definición de los metadatos.
2. `src/shared/search/query.rs`: El AST (Abstract Syntax Tree) del motor de búsqueda propio de Himalaya.

### Para entender cómo un Protocolo se Adapta
El caso de IMAP es el mejor para estudiar:
1. `src/imap/backend.rs`: Mira funciones como `search_envelopes`. Verás cómo toma el `SearchEmailsQuery` y llama a utilidades como `convert_filter` para mapearlo a `SearchKey::SentSince` o análogos. También verás cómo se gestiona la paginación con fallbacks local-RAM si el servidor no tiene extensión `SORT`.
2. `src/jmap/backend.rs`: Para comparar cómo JMAP hace exactamente lo mismo pero traduciendo a JSON.

### Para ver el Punto de Entrada
1. `src/main.rs`: Inicializa variables de entorno y ejecuta `cli::run()`.
2. `src/cli.rs`: La definición masiva de comandos usando el macro de `clap`. Aquí el texto introducido por el usuario se convierte en funciones.
