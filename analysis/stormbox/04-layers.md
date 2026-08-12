# 04 - Arquitectura por capas

Stormbox está estructurado fuertemente en torno a un patrón de **Cliente Pesado (Rich Client) Local-First** con una clara separación entre Hilo Principal (UI) y SharedWorker (Persistencia/Red).

No sigue una "Clean Architecture" purista de libros (Domain, UseCases, Interface Adapters), sino que adopta una arquitectura de **CQRS** suave impulsada por eventos, optimizada para aplicaciones web locales.

[COMPROBADO]

## 1. Capa de Presentación (Presentation / UI)
*   **Responsabilidad:** Captura eventos del usuario y renderiza el DOM usando Vue 3.
*   **Componentes:** Componentes Vue (`src/components/`, `src/App.vue`).
*   **Qué capas puede conocer:** Capa de Aplicación (Stores).
*   **Qué capas no debería conocer:** Persistencia, Networking, Protocolos (JMAP). Nunca realiza SQL ni `fetch` directo a datos de correo.

## 2. Capa de Aplicación (State Management)
*   **Responsabilidad:** Mantiene el estado local efímero para la UI (como IDs seleccionados o scroll position) y cachea consultas recientes. Envía intenciones de mutación.
*   **Componentes:** Stores de Pinia (`mail-store.ts`, `compose-store.ts`).
*   **Qué capas puede conocer:** Capa de Presentación y Adaptadores de Infraestructura (RPC Client).
*   **Acoplamientos importantes:** Esta capa recibe eventos mediante un `BroadcastChannel` (cuando la persistencia cambia de forma asíncrona), lo que obliga a recargar la información de la BD local.

## 3. Capa de Infraestructura (Main-Thread Adapters)
*   **Responsabilidad:** Facilita la comunicación entre el hilo principal y el worker.
*   **Componentes:** `Repository` RPC Client (`src/db/repository.ts`).
*   **Qué capas puede conocer:** Las interfaces genéricas del worker y los modelos de datos.

**--- BARRERA DEL HILO (MessagePort / SharedWorker) ---**

## 4. Capa de Coordinación (Worker Host)
*   **Responsabilidad:** Atender solicitudes del hilo principal, manejar el almacenamiento y coordinar tareas en segundo plano.
*   **Componentes:** `shared-worker.ts`, `sync-host.ts`.
*   **Qué capas puede conocer:** Almacenamiento, Adaptadores de Protocolo.

## 5. Capa de Persistencia (Storage)
*   **Responsabilidad:** Fuente de verdad del cliente. Almacena todos los datos offline de forma estructurada.
*   **Componentes:** SQLite Engine (`src/db/engine.ts`, `src/db/handlers.ts`).
*   **Acoplamientos:** La lógica SQL está acoplada al esquema relacional interno, fuertemente inspirado en entidades JMAP.

## 6. Capa de Adaptadores de Protocolo (Network / Sync)
*   **Responsabilidad:** Traducir los modelos de la Capa de Persistencia al idioma del servidor (JMAP) y viceversa.
*   **Componentes:** JMAP Backend (`jmap/backend.ts`, `jmap/transport.ts`).
*   **Qué capas puede conocer:** Persistencia, Servidor remoto.

---

### UI → Protocolo directamente
**NO.** [COMPROBADO]
La UI nunca toca JMAP. De hecho, el Hilo Principal ni siquiera importa bibliotecas de red JMAP. Toda la interacción sigue este flujo:

```text
UI
 ↓
Application Service (Pinia)
 ↓ (RPC)
Worker (Sync Host)
 ↓
Local Storage (SQLite) → BroadcastChannel → UI refresca
 ↓ (en background, mediante Outbox Runner o Sync Client)
JMAP Adapter
 ↓
Servidor (JMAP)
```
Esto es lo que define su naturaleza Local-First. Cuando la UI necesita algo, lee de SQLite a través del RPC. Si los datos no están completos, el Worker delega la petición al JMAP Adapter, guarda los resultados en SQLite, y emite un evento para que la UI vuelva a leer.
