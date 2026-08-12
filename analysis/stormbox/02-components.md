# 02 - Reconstrucción de componentes

[COMPROBADO]

### 1. Presentation / UI
*   **Responsabilidad:** Renderizar la interfaz visual, capturar la interacción del usuario y consumir el estado reactivo.
*   **Qué NO hace:** No realiza peticiones de red, no maneja lógica de protocolos y no conoce cómo se estructura la base de datos SQL.
*   **Archivos principales:** `src/App.vue`, `src/components/*`.
*   **Consumidores:** Usuario final.
*   **Dependencias:** State Store (Pinia).
*   **Estado:** Mantiene estado puramente visual (modales, toggles locales).
*   **Networking:** Ninguno (todo a través de Stores).

---

[COMPROBADO]

### 2. State Store (Application Layer)
*   **Responsabilidad:** Funciona como única fuente de verdad para la UI. Almacena en memoria (Pinia) una caché temporal y parcial del modelo (mensajes, carpetas) para evitar re-renderizados costosos. Coordina cuándo solicitar más datos a la persistencia.
*   **Qué NO hace:** No realiza peticiones JMAP ni contiene SQL directo. No es el "dueño" final de los datos (la fuente de la verdad local es SQLite).
*   **Archivos principales:** `src/stores/mail-store.ts`, `src/stores/auth-store.ts`.
*   **Interfaces relevantes:** `useMailStore`.
*   **Dependencias:** UI, Repository (RPC Client).
*   **Consumidores:** UI.
*   **Datos de entrada:** Reacciones a eventos del `BroadcastChannel` (ej: `TABLES_TOUCHED`).
*   **Datos de salida:** Arrays reactivos de `messages` y `folders`.
*   **Estado:** Sí, mantiene estado (lista de mensajes cargados, selecciones activas, ids seleccionados).
*   **Persistencia:** Lee del repositorio a través de RPC.
*   **Networking:** No directamente.

---

[COMPROBADO]

### 3. Repository RPC Client
*   **Responsabilidad:** Actúa como puente entre la capa de UI (Main Thread) y la base de datos SQLite (SharedWorker). Abstrae la comunicación basada en `MessagePort` y serializa/deserializa llamadas asíncronas (`call(DB_RPC.MESSAGE_LIST_FOR_FOLDER)`).
*   **Qué NO hace:** No ejecuta el código SQL; simplemente retransmite la intención al worker.
*   **Archivos principales:** `src/db/repository.ts`.
*   **Interfaces relevantes:** `Repository`, `createRepository`.
*   **Dependencias:** Main Thread, `BroadcastChannel`.
*   **Consumidores:** State Store.
*   **Datos de entrada:** Llamadas a métodos estructurados (`listMessagesForView`, `ensureFolderWindow`).
*   **Datos de salida:** Modelos deserializados (JSON) provenientes del worker.
*   **Estado:** Mantiene un registro de promesas pendientes (`_pending`).
*   **Networking:** No.

---

[COMPROBADO]

### 4. Sync Host (Worker Entry & Orchestrator)
*   **Responsabilidad:** Se ejecuta en el SharedWorker. Es el cerebro de orquestación backend. Contiene la base de datos de SQLite, procesa RPC desde los clientes de UI, invoca operaciones JMAP, y coordina trabajos de sincronización. Emite `TABLES_TOUCHED` cuando la BD cambia.
*   **Qué NO hace:** No toca DOM ni UI.
*   **Archivos principales:** `src/db/shared-worker.ts`, `src/sync/sync-host.ts`.
*   **Interfaces relevantes:** `makeSyncRpcHandlers`.
*   **Dependencias:** SQLite Engine, JMAP Backend.
*   **Consumidores:** Repository RPC Client.
*   **Datos de entrada:** Eventos `MessagePort` tipo RPC.
*   **Datos de salida:** Eventos `BroadcastChannel` o respuestas de puerto.
*   **Persistencia:** Instancia principal del OPFS.

---

[COMPROBADO]

### 5. Local Storage Engine (SQLite)
*   **Responsabilidad:** Almacenamiento "Local-First". Conserva de forma persistente metadatos, correos parciales, hilos y estado local. Utiliza WebAssembly (`@journeyapps/wa-sqlite`).
*   **Qué NO hace:** No realiza peticiones al servidor.
*   **Archivos principales:** `src/db/engine.ts`, `src/db/handlers.ts`.
*   **Consumidores:** Sync Host.
*   **Persistencia:** Escribe directamente en disco (OPFS).

---

[COMPROBADO]

### 6. JMAP Sync Client & Backend
*   **Responsabilidad:** Ejecuta llamadas estructuradas contra el servidor JMAP. Encapsula las rutinas complejas (sincronizar ventana de correos, sincronizar cuentas) e inserta/lee datos del Local Storage Engine.
*   **Qué NO hace:** No sabe nada sobre la UI de Vue.
*   **Archivos principales:** `src/sync/sync-client.ts`, `src/sync/backends/jmap/backend.ts`, `src/sync/backends/jmap/transport.ts`.
*   **Interfaces relevantes:** `SyncClient`, `JmapTransport`, `JmapBackend`.
*   **Dependencias:** Networking, Local Storage Engine.
*   **Consumidores:** Sync Host.
*   **Networking:** Sí, conexiones HTTPS y WebSocket hacia el servidor de correo.
*   **Protocolo:** JMAP (`/session`, `Email/query`, etc.).

---

[COMPROBADO]

### 7. Outbox Runner (Sync Mutation)
*   **Responsabilidad:** Procesa de forma independiente acciones que el usuario realizó offline o mientras no se había procesado el commit (mover correo, enviar mensaje). Desacola el Storage de la red real, implementando colas de mutaciones pendientes y reintentos.
*   **Archivos principales:** `src/sync/backends/jmap/outbox-runner.ts`, `src/sync/backends/jmap/outbox.ts`.
*   **Consumidores:** JMAP Backend.
*   **Estado:** Administra el estado interno de "en vuelo" para evitar dobles envíos.

---

## Explicación del diagrama de componentes

Imagina que eres el usuario haciendo clic en tu bandeja de entrada. Esto es lo que sucede:

1.  **Interactúas con la UI**: Todo lo que ves está pintado por Vue en el Hilo Principal del navegador.
2.  **La UI habla con el State (Pinia)**: Vue no va directamente a la red. Le pregunta a Pinia (la caché en memoria) si ya tiene los correos. Si los tiene, te los muestra al instante.
3.  **El State pide datos (RPC Client)**: Si Pinia no los tiene, o necesita asegurarse de que están al día, envía un mensaje estructurado (RPC) pidiendo los correos. ¡Pero no lo envía a internet! Lo envía a través de un puente (MessagePort) hacia otra habitación de tu navegador llamada "SharedWorker".
4.  **El SharedWorker (Sync Host) es el jefe local**: En esa habitación hay un orquestador (Sync Host) que tiene su propia base de datos (SQLite). El Sync Host revisa SQLite.
5.  **SQLite responde y avisa**: Si los datos están ahí, se devuelven por el puente. Pero, además, si SQLite se modifica (por ejemplo, porque llegaron correos nuevos por detrás), grita a todas las pestañas abiertas usando un megáfono (BroadcastChannel). Las pestañas escuchan el grito "¡las tablas cambiaron!" y recargan la vista.
6.  **El JMAP Adapter sale a internet**: Si SQLite no tiene los datos, el Sync Host despierta a su especialista en redes (el JMAP Adapter) y le dice "ve al servidor de correo real y tráeme esto". El JMAP Adapter habla con el servidor, trae los datos, los guarda en SQLite y el megáfono vuelve a sonar.
7.  **El Outbox Runner para los envíos offline**: Si tú envías un correo pero no tienes internet, el Sync Host lo guarda en SQLite como "pendiente". El Outbox Runner es como un cartero que está constantemente revisando si hay mensajes pendientes y, cuando hay conexión, usa el JMAP Adapter para enviarlos por detrás sin interrumpirte.
