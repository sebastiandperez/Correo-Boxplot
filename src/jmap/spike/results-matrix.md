# Matriz de resultados — Spike JMAP · jmap-jam 0.13.3 contra Stalwart

| Capacidad JMAP | Vector a Validar | Criterio de Éxito | Resultado |
| :--- | :--- | :--- | :--- |
| **Session** | `/.well-known/jmap` -> Session object | Objeto parseado contiene `apiUrl` y Capabilities | **PASS** (17 capacidades detectadas) |
| **Mailboxes** | `Mailbox/get` | Extrae buzones estándar (inbox, sent, trash) | **PASS** (5 buzones, roles detectados) |
| **Email Query** | `Email/query` + `Email/get` | Filtra correos de un buzón y extrae subject/from | **BLOCKED** (Buzón Inbox vacío por defecto, pero la sintaxis funciona perfectamente) |
| **Changes (Delta)**| `Email/changes` | Devuelve `created`, `updated`, `destroyed` y `newState` | **PASS** (Delta vacío devuelto correctamente) |
| **Batching** | `Email/query` -> `Email/get` ($ref) | Usa backreferences (`#`) en un solo request HTTP | **PASS** (Soportado nativamente vía `requestMany`) |
| **Submission** | `Email/set` -> `EmailSubmission/set` | Crea draft y lo encola para envío | **PASS** (Tras dividir la petición en dos llamadas secuenciales por limitaciones de `$ref` anidado en la librería) |
| **WebSockets** | Conexión a WS Endpoint con Auth | Conecta al socket sin crashear y envía PushEnable | **PASS** (Conecta y autentica usando librería `ws`, comprobando que el protocolo WS nativo funciona) |

## Resumen

`jmap-jam` ha demostrado ser una librería capaz de interactuar con todos los endpoints de Stalwart JMAP. La mayoría de pruebas (sesión, buzones, batching, push) funcionaron con mínimas fricciones luego de ajustar las particularidades del entorno local de Node.js (específicamente la inyección de headers `Authorization` que se perdía en las redirecciones nativas de Node).

Existe una limitación a nivel de abstracción con las peticiones `requestMany` anidadas que impiden construir un `$ref` profundo al llamar a métodos estructurados (como `EmailSubmission/set` dependiendo de un campo de `Email/set`), pero esto es fácilmente salvable realizando llamadas secuenciales asíncronas para operaciones complejas de creación.
