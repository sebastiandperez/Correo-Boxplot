Vector	Contrato	Preparación	Acción	Resultado obligatorio
RR-01	ReadRepository	DB contiene Email	readEmail() offline	Devuelve present; cero red y cero writes
RR-02	ReadRepository	Email existe, body no cacheado	readEmailBody()	Devuelve notCached sin solicitar red
RR-03	ReadRepository	metadata de adjuntos cacheada vacía	readAttachmentRefs()	Devuelve cached [] distinto de notCached
RR-04	ReadRepository	View existe con coverage parcial	readMailboxView()	Conserva la MailboxView D-06 exacta
RR-05	ReadRepository	IDs de Email con duplicados	readEmails()	Conserva longitud, orden y duplicados posicionales
RR-06	ReadRepository	owner ausente	lectura owned	Devuelve ownerAbsent como éxito semántico
LC-01	LocalChangeSource P-03 CLOSED	commit local con cambio observable	invalidación post-commit	cobertura semántica; consumer relee con ReadRepository; evento no es autoridad
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
JM-01	JMAP adapter	credencial válida	RemoteConnection.open()	RemoteSession + account descriptor
JM-02	JmapRemoteMail	inbox conocida	queryMailbox + syncEmails	Remote IDs y transición normalizada
JM-03	JmapRemoteMail	state antiguo	syncEmails()	delta o replace completo + RemoteSyncState
JM-04	JmapRemoteMail	body multipart	fetchBody()	RemoteBody normalizado; no raw tree ni truncado
JM-05	JmapSubmission	send válido	submit()	receipt + RemoteEmailId cuando esté disponible
JM-06	JMAP adapter	WS push	StateChange	callback tipado (actualmente deferred/fail-closed)
ST-01	Stores	local ready, auth anonymous	bootstrap	cache visible
ST-02	Stores	selected mailbox	repository change	reread visible page
ST-03	Composer	stage success	commit de SendMutation	composer limpio
ST-04	Composer	stage failure	commit de SendMutation	contenido intacto
