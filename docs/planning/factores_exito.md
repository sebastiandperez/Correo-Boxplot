Vector	Contrato	Preparación	Acción	Resultado obligatorio
RR-01	ReadRepository	DB contiene 3 emails	listEmails() offline	Devuelve los 3; cero red
RR-02	ReadRepository	ventana incompleta	ensureFolderWindow()	Resuelve registered sin esperar JMAP
RR-03	ReadRepository	ensure duplicado activo	llamar dos veces	Segunda devuelve deduplicated
RR-04	ReadRepository	Email existente	queueEmailMutation()	Email local + PendingMutation se confirman juntos
RR-05	ReadRepository	fallo al persistir PendingMutation	queueEmailMutation()	rollback de cambio optimista
RR-06	ReadRepository	composer lleno	queueSend() falla	no receipt; caller conserva composer
RR-07	ReadRepository	DB cambia	native event	exactamente una señal onChange útil
SP-01	SyncPort	cursor A + batch B	applyRemoteBatch()	batch y cursor B commit juntos
SP-02	SyncPort	fallo a mitad batch	apply	cursor no avanza
SP-03	SyncPort	mutation pending	transition pending→inFlight	válida
SP-04	SyncPort	mutation pending	transition pending→confirmed	conflict
JM-01	JmapClient	credencial válida	openSession()	capability Mail + account
JM-02	JmapClient	inbox conocida	query + get	ids y Emails normalizados
JM-03	JmapClient	state antiguo	getEmailChanges()	created/updated/destroyed + newState
JM-04	JmapClient	body multipart	getEmailBody()	EmailBody completo normalizado; no raw tree ni resultado truncado
JM-05	JmapClient	send válido	submitEmail()	submissionId + emailId
JM-06	JmapClient	WS push	StateChange	callback tipado
ST-01	Stores	local ready, auth anonymous	bootstrap	cache visible
ST-02	Stores	selected mailbox	repository change	reread visible page
ST-03	Composer	queue success	queueSend()	composer limpio
ST-04	Composer	queue failure	queueSend()	contenido intacto
