# 02 - Componentes Principales

[COMPROBADO]

Himalaya está organizado arquitectónicamente como una CLI con una arquitectura de puertos y adaptadores (o arquitectura hexagonal simple).

Estos son los componentes principales del sistema:

### 1. El Dispatcher CLI (`src/cli.rs`)
Es el punto de entrada (usando la librería `clap`). Transforma los argumentos de la línea de comandos en llamadas a funciones estructuradas. Aquí se define si el comando es agnóstico (`envelope`, `mailbox`) o si es específico de un protocolo (`imap search`, `jmap query`).

### 2. Capa Compartida ("Shared API") (`src/shared/`)
Define la "lengua franca" de Himalaya.
Contiene los modelos de dominio que la interfaz de línea de comandos entiende:
* `Envelope`: Representa la cabecera de un correo (De, Para, Asunto, Fecha, Banderas).
* `Mailbox`: Representa una carpeta de correos.
* `Message`: Representa un correo completo con su contenido crudo (RFC 5322) listo para parsearse (MIME) o enviarse.
* `SearchEmailsQuery`: Un DSL (Domain Specific Language) propio para búsquedas (ej. `from alice and after 2026-01-01`).

### 3. El Router de Backends (`src/shared/client.rs`)
Contiene el struct `EmailClient`. Funciona como un orquestador que lee la configuración de la cuenta y decide a qué cliente de backend reenviar el comando (a través del enum `BackendClient`).

### 4. Adaptadores de Backend (`src/<protocol>/backend.rs`)
Aquí ocurre la traducción. Existen implementaciones separadas para:
* **IMAP** (`src/imap/backend.rs`): Traduce las peticiones genéricas a comandos IMAP (SELECT, FETCH, STORE, COPY) usando la librería subyacente `io-imap`.
* **JMAP** (`src/jmap/backend.rs`): Habla JSON hacia el endpoint JMAP (`Email/get`, `Mailbox/query`).
* **Gmail / MSGraph**: Hablan REST con las APIs propietarias de Google y Microsoft usando OAuth2 Bearer Tokens.
* **Maildir / M2dir**: Leen y escriben archivos en el disco duro local, actuando como si fueran un servidor local.

### 5. Adaptador de Envío (`src/smtp/` y otros)
Para el envío, los backends modernos como JMAP o Gmail pueden enviar correos nativamente con la misma conexión (ej. `EmailSubmission/set`). Pero para protocolos clásicos, la lectura (IMAP/Maildir) y el envío (SMTP) están separados. El Router de Backends maneja esto abriendo una conexión SMTP auxiliar y pidiéndole que envíe el RFC 5322 crudo.

### 6. Parsers y Helpers (`mail-parser`, `rfc2047-decoder`)
Las dependencias en Rust. Ya que los backends IMAP y Maildir entregan el correo crudo, Himalaya usa dependencias pesadas para decodificar MIME y Subject encoded-words.
