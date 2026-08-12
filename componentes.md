# Bloque mínimo de componentes del cliente

## 1. Alcance y reglas de dependencia

Este bloque sostiene cuatro recorridos completos: recibir cambios, abrir un correo, redactar y encolar un envío, y reconciliar SQLite con el servidor. El servidor aparece únicamente como sistema externo JMAP; no se describe ningún componente interno suyo.

La regla central es local-first: Vue y Pinia solo obtienen datos de correo mediante Repository, y cada implementación de Repository responde desde SQLite local. Una operación `ensure…` puede solicitar trabajo de sincronización, pero no convierte la finalización de la red en requisito para que la UI responda.

La bifurcación entre Tauri y Web/PWA ocurre debajo del contrato Repository. En una ejecución existe un solo motor activo. Ambos convergen lógicamente en las mismas responsabilidades de sincronización y en el mismo protocolo JMAP. Si esas responsabilidades comparten código o se implementan una vez en Rust y otra en TypeScript queda **[PENDIENTE]**; lo obligatorio es que conserven el mismo comportamiento observable.

La sesión autenticada y el desbloqueo de SQLCipher son precondiciones de estos recorridos, no un componente diseñado aquí: se conservan Passkeys/WebAuthn con PRF, keychain nativo en Tauri y la prohibición de texto plano/`localStorage`. El ciclo de vida de sesión, bloqueo y recuperación continúa **[PENDIENTE]** en `security.md`.

Las actualizaciones firmadas de Tauri siguen siendo una defensa obligatoria de distribución según `security.md`. No se añade aquí un componente de actualización porque no participa en los cuatro recorridos mínimos y su diseño operativo no ha sido solicitado.

## 2. Presentación segura (Vue 3)

*   **Responsabilidad:** Renderizar listas, lector y compositor con Vue 3 y Composition API; capturar acciones del usuario; convertir el estado reactivo en interfaz; sanitizar con DOMPurify todo HTML de correo inmediatamente antes de insertarlo en el DOM; mantener bloqueadas por defecto las imágenes remotas y operar bajo una CSP estricta.
*   **Qué NO hace:** No ejecuta SQL, no llama JMAP, no usa `fetch` para obtener correo, no conoce Tauri/OPFS y no recibe contenido remoto como si fuera confiable. Tampoco conserva credenciales ni claves de cifrado.
*   **Dependencias:** Stores de Pinia, DOMPurify y la política CSP definida para cada entrega.
*   **Consumidores:** Usuario final.
*   **Datos de entrada:** View models reactivos, estados locales de disponibilidad/error y contenido de mensaje leído desde Repository a través de Pinia.
*   **Datos de salida:** Intenciones de seleccionar carpeta o mensaje, marcar estado, mover correo, editar el compositor y encolar un envío.
*   **Estado:** Solo estado visual de vida corta: foco, paneles, modales, selección transitoria y resultado sanitizado preparado para render. La selección de dominio compartida con otras vistas reside en Pinia.
*   **Persistencia:** Ninguna directa. No usa `localStorage` para correo, credenciales, borradores ni claves.
*   **Networking:** Ninguno.

---

## 3. Estado de aplicación (Pinia)

*   **Responsabilidad:** Mantener el estado reactivo y efímero que necesita la presentación; coordinar lecturas locales; exponer view models de mailboxes, ventanas de mensajes, lector, composición y estado de Outbox; volver a leer Repository cuando el motor notifica que cambió la base local.
*   **Qué NO hace:** No es la fuente de verdad durable, no contiene SQL, no interpreta respuestas JMAP, no elige el motor de almacenamiento y no conserva secretos. Una caché en Pinia nunca autoriza a saltarse SQLite cuando necesita refrescarse.
*   **Dependencias:** Interfaz Repository.
*   **Consumidores:** Componentes y composables de Vue.
*   **Datos de entrada:** Intenciones de la UI, resultados locales de Repository y señales de invalidación/cambio local.
*   **Datos de salida:** Estado reactivo para Vue y llamadas semánticas a Repository.
*   **Estado:** Cuenta y carpeta seleccionadas, ventana visible, mensaje seleccionado, estados de carga local, contenido en edición antes de encolarlo y errores presentables. El vocabulario exacto de estados queda **[PENDIENTE]**.
*   **Persistencia:** Ninguna directa. Un envío solo se considera durable después de que Repository confirme la transacción local; la política de autoguardado de drafts queda **[PENDIENTE]**.
*   **Networking:** Ninguno.

---

## 4. Interfaz Repository

*   **Responsabilidad:** Ser el único contrato que Pinia conoce para consultar el modelo local, registrar mutaciones y pedir que se complete una ventana o un cuerpo en background. Debe ofrecer semánticamente, como mínimo, lectura de mailboxes e identidades, `listMessagesForView`, lectura del mensaje/cuerpo disponible, `ensureFolderWindow`, `ensureMessageBody`, cambios de keywords/mailboxes, encolado de envío y suscripción a cambios locales.
*   **Qué NO hace:** No expone SQL, tablas, `MessagePort`, comandos Rust, rutas OPFS ni tipos de transporte JMAP. No promete que `ensure…` espere una respuesta remota; promete registrar o deduplicar la necesidad y devolver el estado local disponible.
*   **Dependencias:** Una sola implementación activa: Motor Tauri/Rust o Motor Web/OPFS.
*   **Consumidores:** Stores de Pinia.
*   **Datos de entrada:** Identificadores de cuenta, mailbox, vista y mensaje; parámetros de ventana; parches semánticos; y la intención completa de envío.
*   **Datos de salida:** Entidades o view models leídos de SQLite, comprobantes locales de mutaciones encoladas, disponibilidad local y señales de cambio. Firmas TypeScript, tipos de error y contrato exacto de paginación quedan **[PENDIENTE]**.
*   **Estado:** El contrato no posee estado de dominio. Una implementación puede mantener suscripciones y solicitudes locales en vuelo sin convertirlas en autoridad.
*   **Persistencia:** Ninguna por sí misma; delega en el motor activo. Cada método mutador debe conservar las transacciones definidas en `dominio.md`.
*   **Networking:** Ninguno.

---

## 5. Motor Tauri/Rust

*   **Responsabilidad:** Implementar Repository en Tauri v2; ejecutar acceso nativo a SQLite cifrado con SQLCipher; aplicar transacciones, consultas y migraciones; alojar o coordinar los trabajos de background de la entrega; emitir señales cuando cambie la base; y cruzar el IPC mediante el Isolation Pattern con contratos validados.
*   **Qué NO hace:** No renderiza UI, no expone SQL ni rutas arbitrarias al webview, no usa WASM/OPFS y no concede permisos amplios “por si acaso”. La ventana lectora no obtiene capacidades de archivos, keychain o red que no necesite.
*   **Dependencias:** Tauri v2 Capabilities System en default-deny, Isolation Pattern, backend Rust, SQLite nativo, SQLCipher, material de desbloqueo derivado conforme a WebAuthn PRF y los componentes de sincronización JMAP.
*   **Consumidores:** Implementación concreta de Repository; Coordinador de sincronización y Procesador de Pending Mutations para sus operaciones durables.
*   **Datos de entrada:** Consultas y comandos validados desde Repository; lotes de cambios JMAP; confirmaciones o errores de mutaciones; clave de desbloqueo entregada por el flujo seguro de autenticación.
*   **Datos de salida:** Resultados locales tipados, comprobantes transaccionales, filas pendientes para background y señales de cambio de la base.
*   **Estado:** Conexión desbloqueada a SQLCipher, transacciones en curso, suscripciones y coordinación de trabajos. El modelo de hilos/tareas y el ciclo exacto de bloqueo quedan **[PENDIENTE]**.
*   **Persistencia:** SQLite nativo cifrado con SQLCipher. Credenciales persistentes solo mediante keychain nativo; nunca en texto plano ni `localStorage`. Esquema, índices, migraciones y ubicación del archivo quedan **[PENDIENTE]**.
*   **Networking:** No interpreta el protocolo por cuenta propia; delega en Cliente JMAP. La ubicación física del transporte dentro del proceso Rust queda **[PENDIENTE]** y debe respetar capabilities mínimas.

---

## 6. Motor Web/PWA (wa-sqlite sobre OPFS)

*   **Responsabilidad:** Implementar exactamente el mismo Repository en la entrega instalable Web/PWA; ejecutar SQLite mediante `wa-sqlite` sobre OPFS; aplicar las mismas consultas, transacciones y migraciones lógicas; coordinar el background sin bloquear el hilo de UI; y emitir las mismas señales de cambio local.
*   **Qué NO hace:** No modifica la API pública para acomodar OPFS, no usa el servidor como sustituto de SQLite, no guarda claves o credenciales en `localStorage` y no presenta una base sin cifrar como degradación aceptable.
*   **Dependencias:** `wa-sqlite`, OPFS, SQLCipher, WebAuthn/Passkeys con PRF para el desbloqueo y los componentes de sincronización JMAP.
*   **Consumidores:** Implementación concreta de Repository; Coordinador de sincronización y Procesador de Pending Mutations para sus operaciones durables.
*   **Datos de entrada:** Las mismas consultas y comandos semánticos del motor Tauri; lotes JMAP; confirmaciones/errores; y material de desbloqueo obtenido por el flujo WebAuthn.
*   **Datos de salida:** Los mismos resultados locales, comprobantes y señales observables que entrega el motor Tauri.
*   **Estado:** Instancia desbloqueada de SQLite, transacciones y coordinación de acceso concurrente. El contexto de ejecución de background y la coordinación entre pestañas/ventanas quedan **[PENDIENTE]**.
*   **Persistencia:** `wa-sqlite` sobre OPFS, cifrado con SQLCipher. La compilación/integración concreta de SQLCipher, los límites de cuota, la recuperación ante corrupción y las migraciones quedan **[PENDIENTE]**; no se admite fallback en texto plano.
*   **Networking:** No interpreta JMAP por cuenta propia; delega en Cliente JMAP. La ubicación del transporte respecto del contexto de background queda **[PENDIENTE]**.

---

## 7. Coordinador de sincronización

*   **Responsabilidad:** Mantener SQLite al día sin participar en el camino de lectura de primer plano; reaccionar a inicio, reconexión, solicitud `ensure…` y push `StateChange`; leer cursores locales; pedir cambios incrementales; aplicar respuestas mediante el motor activo; avanzar cursores de forma atómica; y notificar que los datos locales cambiaron.
*   **Qué NO hace:** No renderiza, no mantiene estado de UI, no ejecuta lógica del servidor, no escanea IMAP/SMTP y no entrega respuestas JMAP directamente a Pinia. Un `StateChange` no se trata como contenido de correo.
*   **Dependencias:** Motor activo para `SyncCursor`, vistas y entidades; Cliente JMAP para métodos estándar; sesión autenticada obtenida mediante Passkeys/WebAuthn.
*   **Consumidores:** Motores de ambas entregas como responsabilidad lógica; indirectamente Repository recibe sus señales de cambio local.
*   **Datos de entrada:** Cursores persistidos, solicitudes `ensureFolderWindow`/`ensureMessageBody`, cambios de conectividad, inicio de sesión y eventos push.
*   **Datos de salida:** Solicitudes JMAP (`Mailbox/get`, `Mailbox/changes`, `Identity/get`, `Email/query`, `Email/queryChanges`, `Email/changes`, `Email/get` según corresponda), lotes normalizados para persistir, nuevos cursores y señales de cambio local.
*   **Estado:** Solo coordinación en vuelo, deduplicación de trabajos y estado de conexión. Cursores y progreso recuperable viven en SQLite. Política de prioridades, batching, backoff y recuperación de estados JMAP inválidos queda **[PENDIENTE]**.
*   **Persistencia:** No escribe fuera del motor activo. Cambios y cursor se confirman en una misma transacción SQLCipher.
*   **Networking:** Solo mediante Cliente JMAP; nunca desde Vue o Pinia.

---

## 8. Procesador de Pending Mutations (Outbox)

*   **Responsabilidad:** Seleccionar de SQLite intenciones pendientes, bloquear lógicamente una por ejecución, traducirlas a comandos de alto nivel para Cliente JMAP, reintentar fallos temporales y registrar confirmación o fallo terminal. Sostiene al menos envío, cambio de keywords y cambio de pertenencia a mailboxes.
*   **Qué NO hace:** No compone la interfaz del mensaje, no considera éxito el simple clic en Enviar, no descarta una mutación por pérdida de red y no implementa SMTP. Tampoco decide silenciosamente cómo resolver un conflicto de datos.
*   **Dependencias:** Motor activo para la cola durable y sus transacciones; Cliente JMAP para `Email/set`, `EmailSubmission/set` y carga de blobs cuando el mensaje lo requiera; Coordinador para provocar reconciliación posterior.
*   **Consumidores:** Motor activo y, a través de sus señales locales, Pinia para mostrar pendiente, reintento o error.
*   **Datos de entrada:** `PendingMutation` cifradas, estado de conectividad y resultados JMAP.
*   **Datos de salida:** Operaciones JMAP, actualización local del estado de cada mutación, confirmaciones correlacionadas, errores presentables y solicitud de resincronización.
*   **Estado:** Identidad de la mutación en vuelo y temporizadores de reintento. El resto es durable en SQLite. Nomenclatura de estados, backoff, orden entre mutaciones y política de conflicto quedan **[PENDIENTE]**.
*   **Persistencia:** Lee y actualiza `PendingMutation` exclusivamente mediante el motor. La actualización optimista y el encolado original son atómicos. La mutación no se elimina hasta que la confirmación sea durable.
*   **Networking:** Solo mediante Cliente JMAP. La estrategia de idempotencia para impedir duplicados de envío tras una respuesta perdida queda **[PENDIENTE]**.

---

## 9. Cliente JMAP

*   **Responsabilidad:** Implementar el protocolo estándar entre el cliente y el servidor propio: descubrimiento/sesión cuando corresponda, métodos JMAP por HTTPS, recepción de push `StateChange` por WebSocket, serialización, validación de respuestas y errores de transporte. Es el único componente que conoce los objetos y métodos JMAP en la frontera de red.
*   **Qué NO hace:** No implementa el servidor, no accede al proveedor real, no habla IMAP/SMTP, no ejecuta SQL, no decide qué muestra Vue y no inventa un RPC propietario como sustituto de JMAP.
*   **Dependencias:** Sesión autenticada por Passkeys/WebAuthn, transporte HTTPS, WebSocket y capacidades anunciadas por la sesión JMAP.
*   **Consumidores:** Coordinador de sincronización y Procesador de Pending Mutations.
*   **Datos de entrada:** Llamadas JMAP estructuradas, cursores/state, identificadores, parches de mutación, cuerpos salientes y blobs requeridos.
*   **Datos de salida:** Respuestas JMAP validadas, errores clasificados y eventos `StateChange`. No entrega directamente modelos de UI.
*   **Estado:** Sesión/capabilities vigentes, WebSocket, solicitudes en vuelo y conectividad. La ubicación segura y vida de tokens de sesión queda **[PENDIENTE]**; nunca se guardan en texto plano ni `localStorage`.
*   **Persistencia:** Ninguna directa. Los datos de correo, cursores y pendientes los persiste el motor activo; el material de autenticación sigue los mecanismos de `security.md`.
*   **Networking:** Sí. JMAP real sobre HTTPS para métodos y WebSocket para push hacia el servidor propio. No existe conexión directa del cliente al proveedor de correo.

## 10. Explicación del diagrama de componentes: abres la bandeja de entrada

Imagina que acabas de desbloquear el cliente y eliges **Bandeja de entrada**. Esto es lo que ocurre:

1.  **Tú interactúas con Vue.** La presentación registra el clic y se lo comunica al store de Pinia. No hace `fetch`, no conoce JMAP y todavía no importa si estás usando Tauri o la PWA.
2.  **Pinia cambia la selección y pide la ventana local.** El store invoca `listMessagesForView` mediante la única interfaz Repository. Si ya tenía una copia reactiva puede conservarla mientras llega la lectura, pero esa copia no reemplaza a SQLite.
3.  **Repository cruza el punto de bifurcación.** En escritorio, la llamada llega al motor Rust por el puente Tauri protegido con Isolation Pattern; en Web/PWA llega al motor `wa-sqlite` sobre OPFS. Solo una de las dos ramas existe en esa ejecución y Pinia no sabe cuál es.
4.  **El motor consulta SQLCipher local.** Lee la `MailboxView`, sus posiciones y los `Email` asociados. Esa respuesta local vuelve por Repository y Pinia la publica. Vue pinta inmediatamente lo que ya está disponible, incluso si el dispositivo está offline.
5.  **La ausencia de una ventana completa no bloquea la pantalla.** Pinia también llama `ensureFolderWindow`. Repository devuelve el estado local y el motor registra o deduplica la necesidad de completar esa ventana. La UI puede mostrar el contenido cacheado, un estado vacío local o un indicador de actualización; no espera una respuesta de internet para seguir siendo interactiva.
6.  **El coordinador trabaja detrás de la UI.** Lee de SQLite el `queryState` o el cursor aplicable y pide al Cliente JMAP solo las diferencias. Si no existe una vista previa válida, solicita la consulta inicial mínima. En ambos casos usa métodos JMAP estándar por HTTPS.
7.  **El servidor permanece como caja negra externa.** Responde por JMAP. El Cliente JMAP valida la respuesta y se la entrega al coordinador; nunca la manda a Vue. Un push futuro por WebSocket solo dirá que cambió un state y disparará el mismo ciclo incremental.
8.  **Los cambios se vuelven locales antes de ser visibles.** El motor activo aplica mensajes, pertenencias, posiciones y el nuevo cursor en una transacción de SQLCipher. Si la transacción falla, el cursor viejo se conserva para poder repetir el lote.
9.  **SQLite avisa, Pinia vuelve a leer.** Tras el commit, el motor emite una señal local. Repository la propaga, Pinia repite `listMessagesForView` y Vue actualiza la bandeja. El dato mostrado ya no es una respuesta de red: vuelve a ser una lectura de la fuente de verdad local.
10. **Cuando abres un mensaje, se repite el mismo principio.** Repository entrega el cuerpo si está cacheado. Si falta, `ensureMessageBody` agenda su descarga; cuando llega se cifra en SQLite y se notifica otro cambio. Antes de mostrar el HTML, Vue lo pasa siempre por DOMPurify, la CSP limita lo ejecutable y las imágenes remotas siguen bloqueadas por defecto.
11. **Marcarlo como leído tampoco espera a internet.** El motor actualiza `keywords` y crea una `PendingMutation` en una sola transacción. El cambio se ve de inmediato desde SQLite; luego el Outbox ejecuta `Email/set` y registra la confirmación o el error local.
12. **Si redactas y pulsas Enviar, la promesa es “encolado”, no “servidor confirmado”.** Repository persiste el contenido cifrado como `PendingMutation`. El procesador lo enviará mediante `Email/set` y `EmailSubmission/set` cuando haya conexión. Si falla temporalmente, permanece en Outbox; si falla de forma terminal, la UI conoce el error porque lo lee de SQLite.

## 11. Extensión futura explícitamente fuera de alcance

La Fase 2 de compute-at-the-edge —clasificación de spam y embeddings de búsqueda— podrá conectarse en el futuro como procesamiento opcional sobre datos locales, apagado por defecto mediante settings. No se define aquí ningún componente, entidad, cola, modelo ni API para esa fase.
