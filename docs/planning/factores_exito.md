Vector	Contrato	Preparación	Acción	Resultado obligatorio
RR-01	ReadRepository	DB contiene Email	readEmail() offline	Devuelve present; cero red y cero writes
RR-02	ReadRepository	Email existe, body no cacheado	readEmailBody()	Devuelve notCached sin solicitar red
RR-03	ReadRepository	metadata de adjuntos cacheada vacía	readAttachmentRefs()	Devuelve cached [] distinto de notCached
RR-04	ReadRepository	View existe con coverage parcial	readMailboxView()	Conserva la MailboxView D-06 exacta
RR-05	ReadRepository	IDs de Email con duplicados	readEmails()	Conserva longitud, orden y duplicados posicionales
RR-06	ReadRepository	owner ausente	lectura owned	Devuelve ownerAbsent como éxito semántico
LC-01	LocalChangeSource P-03 futuro	commit local completado	invalidación post-commit	consumer relee con ReadRepository; evento no es autoridad
SP-01	SyncPort	cursor A + delta normalizado	applyCollectionSync()	delta y cursor B commit juntos mediante CAS
SP-02	SyncPort	cannotCalculateChanges ya resuelto	applyCollectionSync(replace)	snapshot completo y nuevo cursor commit juntos
SP-03	SyncPort	Email sin body cacheado	cacheEmailBody()	body completo visible después del commit
SP-04	SyncPort	Email con refs desconocidas	replaceAttachmentRefs([])	ReadRepository observa cached []
SP-05	SyncPort	SendMutation nueva	stageSendMutation()	mutación durable; no fake Email
SP-06	SyncPort	Email existente + KeywordMutation	applyOptimisticKeywordMutation()	keywords y mutación commit juntos
SP-07	SyncPort	membership existente + delta válido	applyOptimisticMailboxMembershipMutation()	relaciones no vacías y mutación commit juntas
SP-08	SyncPort	mutation pending leída	replacePendingMutationIfCurrent(inFlight)	un solo caller gana el CAS
SP-09	SyncPort	mutation inFlight tras restart	read sin reset	permanece inFlight para reconciliación
SP-10	SyncPort	mutation confirmed	removeConfirmedMutation()	cleanup committed; otros lifecycle producen conflict
JM-01	JmapClient	credencial válida	openSession()	capability Mail + account
JM-02	JmapClient	inbox conocida	query + get	ids y Emails normalizados
JM-03	JmapClient	state antiguo	getEmailChanges()	created/updated/destroyed + newState
JM-04	JmapClient	body multipart	getEmailBody()	EmailBody completo normalizado; no raw tree ni resultado truncado
JM-05	JmapClient	send válido	submitEmail()	submissionId + emailId
JM-06	JmapClient	WS push	StateChange	callback tipado
ST-01	Stores	local ready, auth anonymous	bootstrap	cache visible
ST-02	Stores	selected mailbox	repository change	reread visible page
ST-03	Composer	stage success	commit de SendMutation	composer limpio
ST-04	Composer	stage failure	commit de SendMutation	contenido intacto
