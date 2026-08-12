# 14 - Lecciones de Arquitectura

## Decisiones que copiaría

1. **JMAP Batching & Back-referencing:** El código utiliza el soporte de referencias nativas de JMAP (usar `#ids` para enlazar un `Email/get` de un `Email/query` en un solo HTTP/WS frame). Esto divide a la mitad la latencia para cargar la primera pantalla y debería ser una piedra angular en nuestro cliente Python.
2. **Push Notifications vía WebSocket (StateChange):** Evita el polling constante. Escuchar pasivamente eventos `StateChange` para desencadenar `Email/changes` y traer incrementos es el diseño JMAP definitivo.
3. **Optimistic UI Updates con Outbox/Mutaciones:** Cuando el usuario archiva o marca un correo como leído, la UI actualiza inmediatamente la BD local SQLite y encola una mutación. El `Outbox Runner` se encarga de enviarlo al servidor en background. Esto es clave para una experiencia "snappy" o Local-First.
4. **Capa de Abstracción de UI (No mezclar UI con Protocolo):** Stormbox nunca llama a un `fetch()` en la capa de Vue. Todo va hacia el Store, y luego al Cliente RPC, y luego al Worker. Mantener la capa visual agnóstica a la red es un patrón excelente.

## Decisiones que adaptaría

1. **SQLite en Wasm en el Cliente:** Dado que nuestro core estará en **Python**, nuestra arquitectura probablemente no involucre un `SharedWorker` en JS en el navegador de la misma forma, o SQLite compilado a Wasm sobre OPFS. Nuestro backend Python (si actúa como API local o daemon de escritorio) sería el equivalente funcional al `SharedWorker`. Python manejaría directamente SQLite de forma nativa.
2. **Cola de Mutaciones (Outbox):** Si hacemos una app web clásica cliente-servidor (Vue -> Python API -> JMAP Server), el concepto Local-First en el navegador es más difícil de implementar. Necesitamos decidir si el cliente rico reside en el navegador (Vue + Wasm SQLite como Stormbox) o si el Python actúa como proxy local en la máquina del usuario (Daemon Local-First).

## Decisiones que evitaría

1. **Implementación custom completa del cliente JMAP:** Stormbox escribe a mano las llamadas HTTP y WebSocket hacia JMAP. Si existe una librería JMAP en Python mantenida y robusta, deberíamos considerarla antes de escribir a mano serializadores, manejadores de reintentos y WebSocket StateChange listeners, para evitar reinventar la rueda (a menos que las librerías JMAP de Python sean deficientes).

## Ideas específicamente útiles para JMAP-first + IMAP compatibility

Stormbox es "puramente" JMAP y esto se nota en que su base de datos local SQLite refleja *exactamente* la estructura y filosofía de JMAP (ej: `remote_id`, múltiples `mailbox_ids` por correo, `thread_id`, `state`).

*   **Si vamos a tener soporte IMAP como capa de compatibilidad**, nuestro esquema local SQLite **NO** puede ser 100% igual al de JMAP.
*   En JMAP un correo pertenece a varias carpetas mediante `mailboxIds`. En IMAP tradicional, un correo está en una carpeta, y copiarlo lo duplica (crea un nuevo UID).
*   **Decisión arquitectónica:** Nuestro esquema de persistencia local (SQLite) debe ser "JMAP-like" (fuente de verdad), y para los servidores IMAP, tendremos que construir un "IMAP Adapter" que simule el comportamiento de JMAP. Es decir, que traduzca el esquema rígido de carpetas de IMAP en el modelo flexible de tags de JMAP, e implemente un sistema de "State" falso para IMAP, de modo que el resto del cliente Python crea que siempre está hablando JMAP.
