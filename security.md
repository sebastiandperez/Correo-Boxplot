# Security - Modelo de Amenazas y Capas de Defensa del Cliente

## Filosofía

No existe "impenetrable" — cualquier marco que lo prometa está vendiendo humo. Lo que sí existe es defensa en profundidad, medible y vigente, dimensionada al perfil de riesgo real de este sistema: un cliente de correo local-first, para un máximo de 30 personas, que por naturaleza renderiza contenido escrito por terceros no confiables (el HTML de los correos).

## Modelo de amenazas específico de este cliente

1.  **HTML/JS malicioso incrustado en un correo**, ejecutándose en el contexto del webview al abrir el mensaje. Es la amenaza dominante — no genérica, es *la* amenaza de cualquier cliente de correo.
2.  **Robo o pérdida del dispositivo**, exponiendo la caché SQLite local en texto plano.
3.  **Phishing o robo de credenciales** de la cuenta.
4.  **Escalación de privilegios vía el puente IPC de Tauri**, si el webview llega a comprometerse por (1).
5.  **Actualizaciones falsas o no firmadas** como vector de distribución de malware.

## Capas de defensa

### 1. Tauri Capabilities System (default-deny)

Tauri v2 reemplazó el allowlist de v1 por un sistema de permisos donde, por defecto, el webview no puede tocar nada del sistema — cada comando, recurso o alcance debe habilitarse explícitamente por ventana, en archivos de capacidades JSON (`src-tauri/capabilities/`).

Incluye además el **Isolation Pattern**, diseñado específicamente para el escenario en que puede haber código no confiable corriendo en el frontend: inyecta una capa segura que intercepta y valida cada mensaje IPC antes de que llegue al núcleo de Tauri. Esto ataca directamente la amenaza 4: si un correo malicioso compromete el renderizado, no puede leer archivos, otras cuentas ni el keychain, porque esas capacidades simplemente no están otorgadas a esa ventana.

**Regla de configuración:** empezar con cero permisos y otorgar solo lo estrictamente necesario por ventana (ej. la ventana de "leer correo" no necesita permisos de sistema de archivos ni de red directa).

### 2. Sanitización de contenido: DOMPurify + CSP estricta

Todo HTML de correo pasa por DOMPurify antes de insertarse en el DOM — mantenido activamente por Cure53, el estándar de facto para sanitización client-side. Se combina con una Content-Security-Policy estricta (`script-src 'self'`) en `tauri.conf.json` como segunda capa, y con bloqueo de carga de imágenes remotas por defecto en el cuerpo del correo (el usuario decide cargarlas caso por caso).

Esto ataca la amenaza 1 desde dos ángulos distintos: DOMPurify elimina el código ejecutable del propio HTML, y la CSP actúa como red de seguridad si el allowlist de DOMPurify resultara insuficiente. El bloqueo de imágenes remotas, de paso, elimina los píxeles de tracking — la misma práctica que ya siguen Apple Mail y Thunderbird.

### 3. Autenticación: Passkeys / WebAuthn (+ extensión PRF)

Login del cliente propio vía Passkeys — en 2026, el estándar reconocido por NIST (SP 800-63-4) como nivel AAL2 y recomendado por CISA como la única autenticación realmente resistente a phishing. Ataca directamente la amenaza 3.

La extensión **WebAuthn PRF** permite derivar una clave de cifrado directamente del passkey durante la autenticación — el mismo patrón que usan Bitwarden y Dashlane para desbloquear su vault sin contraseña maestra separada. Se puede usar para desbloquear la base SQLite cifrada (ver capa 4) sin pedir una segunda credencial.

**Límite real de esta capa:** solo aplica al login de nuestro propio cliente. IMAP y SMTP (para Apple Mail, Android, etc.) no soportan WebAuthn — ese camino sigue dependiendo de contraseñas de aplicación por dispositivo, ya definidas en el diseño del servidor.

**Nota honesta:** investigación reciente (agosto 2026) documentó ataques de "relay" contra passkeys sincronizadas. El vector requiere un endpoint ya comprometido (malware ya instalado) o un escenario empresarial específico (Entra ID) — no rompe la resistencia a phishing que es la razón principal de esta elección, pero se documenta aquí para no prometer más de lo que la tecnología garantiza.

### 4. Cifrado en reposo: SQLCipher

Fork de SQLite con AES-256 transparente, mantenido por Zetetic, con overhead real de 5-15% según la operación. Ataca la amenaza 2: si el dispositivo se pierde o alguien copia el archivo sin que la persona lo note, el contenido es inutilizable sin la clave.

La clave de desbloqueo puede derivarse del passkey vía PRF (capa 3), evitando pedir una contraseña maestra adicional.

### 5. Actualizaciones firmadas

Usar el mecanismo de actualización integrado de Tauri, con verificación de firma — nunca aceptar binarios fuera de ese canal. Ataca directamente la amenaza 5.

## Marco de referencia opcional: DASVS

Existe un intento reciente de estándar equivalente a OWASP ASVS pero para aplicaciones de escritorio: **DASVS** (Desktop Application Security Verification Standard, febrero 2026), modelado sobre la estructura de ASVS/MASVS con tres niveles de rigor creciente.

**Honestidad necesaria:** es nuevo, viene de una firma de seguridad privada, no es un proyecto oficial de OWASP con el mismo respaldo que ASVS (que sí es maduro, pero enfocado en aplicaciones web/API, no en el modelo de amenazas de una app de escritorio). Vale como checklist interno de referencia, no como certificación invocable frente a terceros.

## Qué NO cubre este documento

*   Compromiso del sistema operativo subyacente.
*   Acceso físico a un dispositivo ya desbloqueado.
*   Seguridad del servidor (documento aparte, pendiente).
*   Gestión de recuperación de cuenta si se pierde el dispositivo con el passkey — pendiente de definir.