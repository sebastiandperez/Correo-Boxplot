# 01 - Reconocimiento del proyecto

## Resumen

Este proyecto (Stormbox) es un cliente de correo web moderno basado en **Vue 3** y **JMAP**, con una arquitectura **local-first**. Funciona esencialmente de esta manera: en lugar de que la interfaz de usuario (UI) se comunique constantemente con el servidor de correo a través de la red, la UI interactúa exclusivamente con una base de datos local SQLite (implementada con `@journeyapps/wa-sqlite` sobre OPFS). Toda la lógica de sincronización JMAP y la base de datos están encapsuladas dentro de un **SharedWorker**, lo que permite que múltiples pestañas del navegador compartan la misma conexión y el mismo estado sin bloqueos en el hilo principal. Cuando hay cambios remotos, el Worker actualiza SQLite y emite eventos, haciendo que los stores reactivos de Pinia re-lean la base de datos y actualicen la vista. Es un cliente JMAP nativo, sin dependencias o adaptadores IMAP.

## Detalles técnicos

*   **Lenguaje principal:** TypeScript (con Vue SFC).
*   **Framework:** Vue 3 (Composition API), Vite como bundler.
*   **Punto de entrada:**
    *   UI: `src/main.ts` y `src/App.vue`.
    *   Worker: `src/db/shared-worker.ts`.
*   **Organización general:**
    *   `src/components/`, `src/composables/`, `src/stores/`: Capa de presentación y estado de UI.
    *   `src/db/`: Lógica de SQLite, migraciones, RPC (Remote Procedure Call) y el SharedWorker.
    *   `src/sync/`: Lógica de networking, clientes JMAP y sincronización.
*   **Módulos centrales:**
    *   `mail-store.ts`: El gestor de estado principal que conecta la UI con la base de datos.
    *   `shared-worker.ts`: El cerebro en background que orquesta SQLite y las operaciones JMAP.
    *   `backends/jmap/backend.ts`: El motor que traduce la sincronización en llamadas a JMAP.
*   **Dependencias relacionadas con correo:**
    *   No hay librerías externas de IMAP o SMTP.
    *   `squire-rte`, `dompurify`: Para la visualización y composición de mensajes.
*   **Dependencias de persistencia:**
    *   `@journeyapps/wa-sqlite`: SQLite compilado a WebAssembly para persistir datos localmente en OPFS (Origin Private File System).
*   **Librerías JMAP:**
    *   No utiliza una librería externa pesada para JMAP; implementa sus propios clientes y bodies (e.g., `src/sync/backends/jmap/transport.ts`).
*   **Librerías IMAP/SMTP:**
    *   No existen. Es 100% JMAP.
*   **Mecanismos de concurrencia/asíncronos:**
    *   **SharedWorker:** Aisla la persistencia y la sincronización de la UI.
    *   **MessagePort RPC:** La UI y el Worker se comunican mediante promesas y mensajes cruzados (`postMessage`).
    *   **BroadcastChannel:** Utilizado por el Worker para avisar a todas las pestañas abiertas cuando se tocan tablas específicas en SQLite, logrando una sincronización reactiva inmediata.
