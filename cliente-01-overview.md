# 01 - Overview y Filosofía del Cliente

## Resumen

Este documento describe el cliente de correo que vamos a construir: una aplicación **local-first** basada en **Vue 3**, entregada en dos formas a partir de un único código base — **Web/PWA** (acceso inmediato por navegador, instalable) y **Tauri** (empaque de escritorio nativo, más liviano que Electron). El cliente habla **JMAP real** (HTTP + WebSocket) contra nuestro propio servidor, y es explícitamente **opcional**: el servidor también expone IMAP y SMTP estándar, así que Apple Mail, apps de Android o cualquier cliente de terceros pueden usar la misma cuenta sin pasar por esta app.

Es el resultado directo de comparar tres arquitecturas (Stormbox, Himalaya, Aerc) y adaptar lo mejor de cada una a un contexto distinto: single-node, embebido, para un máximo de 30 personas.

## Filosofía

*   **Local-first real:** la UI nunca espera a la red. Lee siempre de una base SQLite local; la sincronización con el servidor ocurre en background y actualiza esa base, nunca al revés.
*   **Un código, dos entregas:** la capa de presentación (Vue + Pinia) es idéntica en ambas formas de distribución. Solo cambia qué motor vive *debajo* de esa capa.
*   **JMAP de punta a punta:** el canal cliente↔servidor es JMAP estándar (no un RPC propio como el `MessagePort` de Stormbox), porque el servidor ya necesita hablar JMAP para lo demás, y porque el cliente y el servidor no comparten proceso — a diferencia de Stormbox, donde UI y SharedWorker viven en la misma pestaña.
*   **Nunca la única puerta:** este cliente es una fachada más sobre un servidor que ya es accesible por IMAP/SMTP estándar. Su valor está en la experiencia (rápido, offline, bonito), no en ser indispensable.
*   **Ligero de verdad:** Tauri en vez de Electron (núcleo <600KB, ~20-100MB de RAM en reposo vs. 200-400MB de Electron), sin ML pesado embebido — la Fase 2 de compute-at-the-edge queda documentada pero fuera del alcance inicial.

## Detalles técnicos

*   **Lenguaje principal:** TypeScript (Vue SFC) para toda la capa de presentación, compartida entre las dos entregas.
*   **Framework UI:** Vue 3 (Composition API), Vite como bundler — igual que Stormbox, por continuidad de patrones ya probados.
*   **Formas de entrega:**
    *   **Web/PWA:** visitable por URL, instalable a pantalla de inicio/escritorio con un clic para obtener almacenamiento persistente real (fuera del límite de purga de 7 días de Safari) y push notifications.
    *   **Tauri (desktop):** el mismo Vue empaquetado con un backend en Rust, usando el WebView nativo del sistema operativo. Sin dependencia de las políticas de almacenamiento del navegador.
*   **Motor de almacenamiento local (dos implementaciones, una interfaz):**
    *   En Tauri: SQLite nativo, accedido directamente desde Rust — sin WASM, sin OPFS, sin las restricciones que motivan esa complejidad en un navegador.
    *   En Web/PWA: `wa-sqlite` sobre OPFS, el mismo mecanismo que usa Stormbox.
    *   Ambas quedan detrás de una misma interfaz tipo "Repository" (`listMessagesForView`, `ensureFolderWindow`, etc.) para que la capa Vue/Pinia nunca sepa cuál está activa.
*   **Orquestador de sincronización y concurrencia:**
    *   En Tauri: el propio proceso Rust cumple el rol que el SharedWorker cumple en Stormbox — dueño único de la conexión SQLite y del cliente JMAP, comunicándose con el frontend por IPC de Tauri (`invoke` + eventos).
    *   En Web/PWA: se reutiliza literalmente el patrón SharedWorker + BroadcastChannel de Stormbox, para coordinar múltiples pestañas sobre la misma base OPFS.
*   **Protocolo hacia el servidor:** JMAP estándar sobre HTTPS, con push por WebSocket. Extensiones propias de UI (si hacen falta) se declaran bajo un namespace propio, sin dejar de ser JMAP válido.
*   **Almacenamiento de credenciales:**
    *   En Tauri: keychain nativo del sistema operativo.
    *   En Web/PWA: mecanismo a definir en el punto de Storage (pendiente — ninguna opción de navegador iguala a un keychain nativo).
*   **Compute-at-the-edge:** apagado por defecto (toggle en settings). Cuando se active, usa el mecanismo de *lease* documentado — pero no es parte del MVP.

## Qué NO es este cliente

*   No es la fuente de verdad — esa sigue siendo el SQLite del servidor.
*   No reemplaza la necesidad de que el servidor sea IMAP/SMTP-compatible — ese trabajo es independiente y ya está resuelto en el diseño del servidor.
*   No incluye ML pesado ni generación de texto — eso, si algún día se justifica, es una extensión opcional, no un requisito de arranque.