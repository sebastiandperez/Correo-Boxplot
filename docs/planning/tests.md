Smoke	Procedimiento	Resultado esperado	Owner principal
S1-BOOT	pnpm exec tauri dev sin red	Ventana abre; DB local inicia; no error remoto bloqueante	A+B
S1-EMPTY	DB nueva	UI muestra empty states válidos	A
S1-CACHE	DB de prueba con mailbox/emails	Sidebar/list/viewer muestran datos solo locales	A+B
S1-BODY	Email con body cacheado	Viewer muestra text/HTML sanitizado	A
S1-SYNC-DEMAND	body notCached	UI sigue usable; futura orquestación solicita materialización sin bloquear la lectura	A+B
S1-EVENT	modificar DB vía comando semántico test	LocalChangeSource P-03 provoca reread en store después del commit	A+B
S1-SENDQ	Composer → queue	PendingMutation durable antes de limpiar composer	A+B
S1-ROLLBACK	inducir error de storage al queue	Composer no pierde contenido	A+B
S1-CIPHER	abrir DB con key incorrecta	fail closed; nunca plaintext	B
S1-DEK	inspeccionar IPC/logs	DEK nunca cruza a TypeScript	B
S1-JMAP	ejecutar con token dev	Session + mailbox + email funcionan contra Stalwart	C
S1-CHANGES	modificar mailbox remota	/changes o /queryChanges devuelve delta esperado	C
S1-PUSH	provocar cambio remoto	Cliente recibe StateChange	C
S1-TOKEN	token canario + cierre	cero persistencia conocida	C
S1-BOUNDARY	búsqueda estática imports	UI no importa Tauri/JMAP/SQL; Rust no importa JMAP	Todos
