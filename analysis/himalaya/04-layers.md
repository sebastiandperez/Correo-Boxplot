# 04 - Capas de la Arquitectura

[COMPROBADO]

Himalaya tiene una arquitectura fuertemente estratificada. A diferencia de un cliente web, no hay hilos de Worker separados comunicándose asíncronamente. Todo ocurre en el mismo hilo de ejecución principal, de forma síncrona o bloqueante (en su versión actual, usa librerías síncronas/bloqueantes en gran medida, o si usa async, bloquea en el main).

Las capas son lógicas y de separación de responsabilidades:

## 1. Capa de Interfaz de Usuario (Presentación)
Manejada por la librería `clap` para parsear argumentos de terminal (`src/cli.rs`) y utilidades de renderizado para pintar tablas, JSON o texto plano en la consola (`src/shared/output.rs` u otros módulos de impresión). No hay estado en esta capa.

## 2. Capa de Aplicación (Core)
El `EmailClient` (`src/shared/client.rs`). 
Es el cerebro del flujo. Sabe que para agregar un correo (`add_message`) debe llamar a la capa de infraestructura. También es el responsable de decidir cuándo usar SMTP. 
Por ejemplo: Si el backend activo es IMAP, y el usuario invoca "enviar correo", el `EmailClient` sabe que el backend IMAP no tiene la función `send_message`, por lo que internamente levanta el transporte SMTP (`SmtpTransport`) auxiliar, envía el correo, y luego usa IMAP (`add_message`) para hacerle un `APPEND` del correo enviado a la carpeta "Sent". Toda esta lógica de negocio vive en esta capa.

## 3. Capa de Infraestructura (Adaptadores / Traductores)
El corazón de la interoperabilidad. Los archivos `backend.rs` de cada protocolo.
Esta capa conoce tanto la "Shared API" (Dominio) como el protocolo específico (Detalles de red).
* Recibe un `SearchEmailsQuery` de la Capa de Aplicación.
* Lo compila a `SearchKey::SentSince` (IMAP) o un filtro JMAP `FilterCondition`.
* Envía la instrucción bruta a la red.
* Convierte las respuestas crudas de la red (ej. la respuesta de un `FETCH` IMAP) de vuelta a las entidades de dominio (ej. un `Envelope`).

## 4. Capa de Red y Almacenamiento (Drivers)
Dependencias externas puras.
* Para IMAP, Himalaya confía en la librería `io-imap`.
* Para HTTP (JMAP, Gmail), usa un cliente HTTP genérico.
* Para SMTP, usa `lettre`.
* No hay almacenamiento en caché (SQLite). El único estado se mantiene en memoria RAM durante la vida útil (fracciones de segundo) del comando ejecutado.

### Ausencia de Capa de Background
Al ser un CLI, no hay hilos de "Outbox Runner" ni de "Sync Host". Si pides borrar un correo, Himalaya se conecta a IMAP, manda el comando `UID EXPUNGE`, espera el OK, imprime "Correo borrado" y termina.
Si pierdes el internet a la mitad, el comando simplemente retorna error de red al usuario y se interrumpe.
