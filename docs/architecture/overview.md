# 01 - Overview y filosofía del cliente

## Resumen

Este documento describe el cliente de correo que vamos a construir: una aplicación **local-first** basada en **Vue 3**. El MVP actual se entrega únicamente como aplicación de escritorio **Tauri v2**, con TypeScript en el webview y Worker, Rust en la frontera nativa y SQLite + SQLCipher como base local. La entrega **Web/PWA se conserva como dirección futura**, pero está diferida y no forma parte del camino crítico ni de la aceptación del MVP.

Las reglas canónicas de capas, imports y dirección de dependencias se encuentran en [layers.md](layers.md).

El cliente habla **JMAP real** (HTTP + WebSocket) contra nuestro propio servidor, y es explícitamente opcional: el servidor también expone IMAP y SMTP estándar, así que Apple Mail, apps de Android o cualquier cliente de terceros pueden usar la misma cuenta sin pasar por esta app. Este mismo cliente, además, implementa esos dos protocolos como segundo camino obligatorio (ADR-007): un traductor IMAP→JMAP en Rust detrás del mismo puerto TypeScript, sin que Coordinador ni Outbox distingan cuál de los dos está activo.

Es el resultado directo de comparar tres arquitecturas (Stormbox, Himalaya, Aerc) y adaptar lo mejor de cada una a un contexto distinto: single-node, embebido, para un máximo de 30 personas.

## Filosofía

*   **Local-first real:** la UI nunca espera a la red. Lee siempre de una base SQLite local; la sincronización con el servidor ocurre en background y actualiza esa base, nunca al revés.
*   **Tauri primero, Web después:** el MVP valida el recorrido completo en Tauri. La arquitectura conserva `ReadRepository`, `SyncPort` y `LocalChangeSource` como fronteras para que una iteración futura pueda añadir Web/PWA sin acoplar Vue/Pinia al motor local.
*   **JMAP de punta a punta:** el canal cliente↔servidor es JMAP estándar (no un RPC propio como el `MessagePort` de Stormbox), porque el servidor ya necesita hablar JMAP para lo demás, y porque el cliente y el servidor no comparten proceso — a diferencia de Stormbox, donde UI y SharedWorker viven en la misma pestaña.
*   **Nunca la única puerta:** este cliente es una fachada más sobre un servidor que ya es accesible por IMAP/SMTP estándar. Su valor está en la experiencia (rápido, offline, bonito), no en ser indispensable.
*   **Ligero de verdad:** Tauri en vez de Electron, sin ML pesado embebido. Compute-at-the-edge queda documentado únicamente como extensión futura opcional y fuera del MVP.

## Detalles técnicos

*   **Lenguaje principal:** TypeScript para Vue/Pinia y para Cliente JMAP, Coordinador y Outbox; Rust queda limitado a persistencia, cifrado, secure store de Tauri y, exclusivamente como traductor IMAP→JMAP (ADR-007), el cliente TCP/TLS saliente de `src-tauri/src/net/`.
*   **Framework UI:** Vue 3 (Composition API), Vite como bundler — igual que Stormbox, por continuidad de patrones ya probados.
*   **Entrega del MVP:** Tauri v2, con Vue dentro del webview y backend Rust. No depende de WASM, OPFS ni políticas de almacenamiento del navegador.
*   **Motor de almacenamiento local:** SQLite nativo cifrado con SQLCipher, accedido desde Rust y oculto detrás de `ReadRepository` para lecturas committed y `SyncPort` para transiciones semánticas atómicas. Application, Coordinator y Outbox consumen la capacidad que corresponda; `LocalChangeSource` P-03 comunica únicamente invalidaciones post-commit. La capa Vue/Pinia no ejecuta SQL ni conoce el motor.
*   **Orquestador de sincronización y concurrencia:**
    *   Cliente JMAP, Coordinador de sincronización y Outbox tienen una única implementación en TypeScript, detrás de un único puerto (`JmapClient`) con dos adaptadores posibles.
    *   En Tauri corre en un Worker normal dentro del webview: el adaptador JMAP habla directamente mediante `fetch`/WebSocket; el adaptador IMAP (ADR-007) delega la conexión TCP/TLS saliente a `src-tauri/src/net/` por IPC. Ambos cruzan por los adaptadores Tauri/`invoke()` únicamente para persistir a través de Rust. Los cambios se notifican mediante el sistema de eventos de Tauri.
    *   Rust no aloja ni es dueño del cliente JMAP y nunca habla JMAP él mismo. Su responsabilidad se limita a SQLite nativo, SQLCipher, secure store del sistema operativo y, exclusivamente como traductor detrás del adaptador IMAP, la conexión saliente de `net/`.
    *   Tauri configura la política `backgroundThrottling: "throttle"`. El throttling del webview en background es un riesgo aceptado para el MVP.
*   **Protocolo hacia el servidor:** dos protocolos obligatorios detrás del mismo puerto. El Worker TypeScript habla JMAP estándar directamente sobre HTTPS, con push por WebSocket, sin pasar esa red por Rust; y habla IMAP/SMTP delegando la conexión saliente a Rust `net/` (ADR-007), que traduce a la misma forma JMAP sin que Coordinador/Outbox lo perciban. Extensiones propias de UI (si hacen falta) se declaran bajo un namespace propio, sin dejar de ser JMAP válido.
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

La decisión de forzar JMAP o IMAP en la conexión entre el servidor y el proveedor real pertenece exclusivamente al adaptador del servidor. No afecta este cliente: el cliente solo habla JMAP con el servidor propio. Esta nota registra el límite para el futuro diseño del servidor sin introducir lógica de servidor en este repositorio.
