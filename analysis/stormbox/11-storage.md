# 11 - Almacenamiento local (Persistencia y Arquitectura Local-First)

[COMPROBADO]

Stormbox es una aplicación 100% **Local-First**. La única fuente de verdad para la Interfaz de Usuario es la base de datos local SQLite. La UI jamás realiza llamadas a red; la red se utiliza en segundo plano exclusivamente para mantener a SQLite sincronizado con el servidor JMAP.

## Qué se almacena
*   **Mensajes (Correos):** Metadatos (`id`, `subject`, `from`, `date`, `keywords`, pertenencia a carpetas).
*   **Cuerpos de los mensajes:** HTML y Texto (descargados bajo demanda, pero cacheados permanentemente una vez bajados en la tabla anexa de *bodies*).
*   **Carpetas (Mailboxes):** Jerarquía de carpetas, nombre, roles, ID remoto.
*   **Cuentas y Capabilities:** Límites de JMAP, quotas, IDs de cuentas.
*   **Identidades:** Correos y nombres para enviar desde (`identities`).
*   **Vistas (Query Views):** Paginación estricta que dice "El correo X está en la posición 12 de la carpeta Y".
*   **Mutaciones Pendientes (Outbox):** Acciones que el usuario hizo pero aún no se sincronizan con la red (correos por enviar, borrar, mover).
*   **Estado de Sincronización:** Tokens de JMAP (`state`, `queryState`) para no pedir nada dos veces.

## Dónde se almacena
*   En **OPFS** (Origin Private File System), a través de una compilación en WebAssembly de SQLite llamada `@journeyapps/wa-sqlite`.
*   El acceso a este sistema de archivos se hace exclusivamente dentro de un **SharedWorker**, ya que OPFS necesita acceso síncrono para buen rendimiento (vía Access Handles) y bloquea el hilo donde se ejecuta.

## Qué NO se almacena
[INFERIDO basado en código]
*   Archivos adjuntos masivos (Documentos, PDFs pesados). Suelen dejarse en el servidor hasta que el usuario le da "descargar", descargándose como Blob, aunque no entran a SQLite.
*   Claves de encriptación o Tokens OIDC directamente en SQLite de forma insegura (los maneja la librería OIDC en almacenamiento web nativo o in-memory).

## Reconstrucción del flujo: ¿Quién accede y cuándo?

```text
Servidor (JMAP)
   ↕ (Sync Host worker en background)
Sync Adapter
   ↕
Base de Datos Local (SQLite)
   ↕ (MessagePort RPC)
Application (Pinia Stores en Hilo Principal)
   ↕
UI (Vue)
```

1.  **La UI NO consulta directamente SQLite:** No puede, porque SQLite está en otro hilo. La UI llama a un cliente RPC (`repo.listMessagesForView(...)`).
2.  **Cuándo se lee:** Inmediatamente al abrir la app o cambiar de carpeta. Se busca dar una respuesta menor a 50ms (Cache-first).
3.  **Cuándo se escribe:** Siempre que el JMAP Sync Client descarga nueva información, o cuando la UI ejecuta una mutación local optimista.
4.  **Invalidador de caché / Refresco:** No hay "caché expirado" basado en tiempo. La caché se considera fresca hasta que el WebSocket recibe un evento `StateChange` o hasta que la UI pide recargar. Si ocurre un `TABLES_TOUCHED` (broadcast de cambio de tabla), la UI reejecuta su RPC.
5.  **Funcionamiento Offline:** Totalmente funcional para lectura. La escritura encola las acciones en la tabla `pending_mutations`, las cuales el Outbox Runner enviará cuando haya internet de nuevo.
