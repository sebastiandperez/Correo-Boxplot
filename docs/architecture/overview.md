# 01 - Overview y filosofía del cliente

## Resumen

Este documento describe el cliente de correo que vamos a construir: una aplicación **local-first** basada en **Vue 3**. El MVP actual se entrega únicamente como aplicación de escritorio **Tauri v2**, con TypeScript en el webview y Worker, Rust en la frontera nativa y SQLite + SQLCipher como base local. La entrega **Web/PWA se conserva como dirección futura**, pero está diferida y no forma parte del camino crítico ni de la aceptación del MVP.

Las reglas canónicas de capas, imports y dirección de dependencias se encuentran en [layers.md](layers.md).

El cliente habla **JMAP real** (HTTP + WebSocket) contra nuestro propio servidor, y es explícitamente opcional: el servidor también expone IMAP y SMTP estándar. ADR-008 fija una frontera protocol-neutral: Coordinator consume `RemoteMail` y Outbox consume `RemoteMail` + `Submission`. JMAP ya implementa esos contratos; IMAP y SMTP se conectarán como adapters separados, sin traducirlos a JMAP falso.

Es el resultado directo de comparar tres arquitecturas (Stormbox, Himalaya, Aerc) y adaptar lo mejor de cada una a un contexto distinto: single-node, embebido, para un máximo de 30 personas.

## Filosofía

*   **Local-first real:** la UI nunca espera a la red. Lee siempre de una base SQLite local; la sincronización con el servidor ocurre en background y actualiza esa base, nunca al revés.
*   **Tauri primero, Web después:** el MVP valida el recorrido completo en Tauri. La arquitectura conserva `ReadRepository`, `SyncPort` y `LocalChangeSource` como fronteras para que una iteración futura pueda añadir Web/PWA sin acoplar Vue/Pinia al motor local.
*   **JMAP real, detrás de frontera remota:** el canal JMAP usa el estándar directamente, no un RPC propio. Sus DTOs y errores quedan dentro del adapter JMAP y no definen Coordinator u Outbox.
*   **Nunca la única puerta:** este cliente es una fachada más sobre un servidor que ya es accesible por IMAP/SMTP estándar. Su valor está en la experiencia (rápido, offline, bonito), no en ser indispensable.
*   **Ligero de verdad:** Tauri en vez de Electron, sin ML pesado embebido. Compute-at-the-edge queda documentado únicamente como extensión futura opcional y fuera del MVP.

## Detalles técnicos

*   **Lenguaje principal:** TypeScript para Vue/Pinia, Remote Boundary, Cliente JMAP, Coordinator y Outbox; Rust queda limitado a persistencia, cifrado y secure store. Los protocolos nativos futuros podrán usar una capa TCP/TLS Rust aislada del Local Engine (ADR-008).
*   **Framework UI:** Vue 3 (Composition API), Vite como bundler — igual que Stormbox, por continuidad de patrones ya probados.
*   **Entrega del MVP:** Tauri v2, con Vue dentro del webview y backend Rust. No depende de WASM, OPFS ni políticas de almacenamiento del navegador.
*   **Motor de almacenamiento local:** SQLite nativo cifrado con SQLCipher, accedido desde Rust y oculto detrás de `ReadRepository` para lecturas committed y `SyncPort` para transiciones semánticas atómicas. Application, Coordinator y Outbox consumen la capacidad que corresponda; `LocalChangeSource` P-03 comunica únicamente invalidaciones post-commit. La capa Vue/Pinia no ejecuta SQL ni conoce el motor.
*   **Orquestador de sincronización y concurrencia:**
    *   Coordinator depende de `RemoteMail`; Outbox depende de `RemoteMail` y `Submission`. La selección del protocolo ocurre una vez en el runtime/composición.
    *   En Tauri, `JmapRemoteMail`/`JmapSubmission` reutilizan el cliente JMAP por `fetch`/WebSocket; `ImapRemoteMail`/`SmtpSubmission` usan IPC tipado hacia la red nativa Rust. El MVP nativo sin TLS está limitado a loopback verificado.
    *   Rust Local Engine nunca habla protocolos remotos ni aloja Coordinator/Outbox. La capa nativa IMAP/SMTP es un módulo separado del motor y no fabrica DTOs JMAP.
    *   Tauri configura la política `backgroundThrottling: "throttle"`. El throttling del webview en background es un riesgo aceptado para el MVP.
*   **Protocolo hacia el servidor:** JMAP e IMAP implementan `RemoteMail`; JMAP y SMTP implementan `Submission`. JMAP habla HTTP directamente; el MVP IMAP/SMTP usa red nativa Rust solo contra loopback verificado. Los estados remotos son opacos y ningún tipo concreto cruza hacia Coordinator/Outbox. TLS nativo externo sigue diferido.
*   **Autenticación remota:** Passkey/WebAuthn se ejecuta en el navegador del sistema. El token JMAP vive solo en memoria del Worker; no se persiste en Pinia, SQLite, `localStorage` ni logs. Al relanzar la aplicación se requiere autenticación remota de nuevo, sin impedir leer la caché local.
*   **Confidencialidad local:** Rust genera una DEK criptográficamente aleatoria de 32 bytes, la guarda en el secure store del sistema operativo y la entrega directamente a SQLCipher. La clave no se deriva del Passkey, no atraviesa IPC y no existe fallback a SQLite en texto plano.
*   **Ciclos independientes:** una base local abierta no implica una sesión JMAP activa. `LocalReady + RemoteAnonymous` es un estado válido y permite iniciar offline y leer la caché.
*   **Compute-at-the-edge:** extensión futura opcional, apagada por defecto y fuera del MVP. No se diseña aquí.

## Iteración futura Web/PWA

La arquitectura Web/PWA previamente acordada no se descarta: reutilizará Vue/Pinia y los contratos `ReadRepository`, `SyncPort` y `LocalChangeSource`, y prevé `wa-sqlite` sobre OPFS, `SharedWorker` y `BroadcastChannel`. Su cifrado, custodia de credenciales, concurrencia multi-tab y operación de almacenamiento se resolverán en esa iteración. Ninguno de esos puntos bloquea el MVP Tauri ni se da por resuelto en este documento.

## Qué NO es este cliente

*   No es la autoridad remota — para la UI, SQLite local es la fuente de verdad; para reconciliar correo, JMAP/servidor sigue siendo la autoridad.
*   No reemplaza la necesidad de que el servidor sea IMAP/SMTP-compatible — ese trabajo es independiente y ya está resuelto en el diseño del servidor.
*   No incluye Web/PWA en la aceptación del MVP actual.
*   No incluye borradores durables ni sincronizados, binarios de adjuntos, descarga/subida de adjuntos ni envío con adjuntos.
*   No incluye ML pesado ni generación de texto — eso, si algún día se justifica, es una extensión opcional, no un requisito de arranque.

## Nota para el diseño del servidor

La conexión entre el servidor y sus proveedores pertenece al servidor y queda fuera de este repositorio. En el cliente, ADR-008 permite seleccionar JMAP o futuros adapters IMAP/SMTP únicamente en la composición remota, sin introducir lógica de servidor.
