# Arquitectura canónica de contract testing de Ports

## 1. Estado y autoridad

**TEST-00→TEST-06: COMPLETE. MEM-01 FINAL AUDIT: PASS. PERSIST-00: COMPLETE.** Las suites portables P-01/P-02/P-03 y sistémica están cerradas para el alcance MVP actual; Memory superó además su hardening específico.

Estado de los contratos:

* P-01 `ReadRepository`: **CLOSED**.
* P-02 `SyncPort`: **CLOSED**.
* P-03 `LocalChangeSource`: **CLOSED**.
* `ReadRepository` runtime contract: **45/45 PASS AGAINST MEMORY**.
* `SyncPort` runtime contract: **91/91 PASS AGAINST MEMORY**.
* `LocalChangeSource` runtime contract: **23/23 PASS AGAINST MEMORY**.
* Local Engine reusable contract: **179/179 PASS AGAINST MEMORY**.
* Memory-specific hardening: **18/18 PASS**.
* `MemoryLocalEngine` final conformance: **PASS**.
* Local Engine contract suite: **CLOSED FOR CURRENT MVP SCOPE**.

La prioridad normativa es:

1. Domain D-01→D-10 frozen.
2. P-00 Port Architecture.
3. P-01 `ReadRepository`.
4. P-02 `SyncPort`.
5. P-03 `LocalChangeSource`.
6. TEST-00, este documento.

Memory, SQLite, Tauri, JMAP, mocks y detalles de implementación no pueden definir semántica nueva.

## 2. Principio contract-first

```text
Contract Specification
        ↓
Abstract Harness
        ↓
Reusable Suites
        ↓
Implementation Under Test
```

Las suites de contrato son la especificación ejecutable del comportamiento observable. `MemoryLocalEngine` es el primer implementation-under-test conformant, no la fuente de verdad. Las mismas suites certificarán después el Local Engine Tauri sin aceptar cambios hechos para acomodar una implementación concreta.

Los nombres conceptuales congelados para los runners Vitest son:

* `defineReadRepositoryContract(...)`;
* `defineSyncPortContract(...)`;
* `defineLocalChangeSourceContract(...)`;
* `defineLocalEngineContract(...)`.

TEST-01 implementa el harness abstracto y la infraestructura reusable. TEST-02 implementa `defineReadRepositoryContract(...)`. TEST-03A y TEST-03B implementan `defineSyncPortStateContract(...)` y `defineSyncPortMutationContract(...)`; `defineSyncPortContract(...)` compone ambas suites sin duplicar escenarios. TEST-04 implementa `defineLocalChangeSourceContract(...)` con 23 escenarios.

## 3. Aclaraciones normativas de Ports

### TC-01 — `conflict`, `corruptState` y `unavailable`

`conflict` significa que el command/write solicitado no puede aplicarse contra el estado local committed porque una precondición semántica no coincide. Incluye cursor esperado stale, owner requerido ausente, `MutationId` duplicado, composición cross-account, overlap entre changed/destroyed e invalid command scope.

`corruptState` significa que estado ya persistido no puede rehidratarse como Domain válido o viola una invariante durable. Por ejemplo, una representación persistida de Email, Mutation o Cursor no puede producir el objeto Domain correspondiente.

Input inválido a nivel de command no se clasifica como `unavailable`. `unavailable` significa exclusivamente que el Local Engine no puede prestar el servicio.

### TC-02 — Owner Account de collection sync

`SyncPort.applyCollectionSync(...)` requiere que la `Account` indicada por `nextCursor.accountKey` exista localmente al momento del commit. Si no existe, el resultado es `conflict` y la operación no produce cambios de colección, avance de cursor ni invalidación P-03.

Esta precondición impide crear estado físicamente presente pero semánticamente oculto por `ownerAbsent` en P-01. No cambia la firma P-02.

### TC-03 — Notificación de no-op exitoso

La cobertura obligatoria P-03 aplica a operaciones P-02 exitosas que cambiaron estado observable. Un éxito que sea un no-op puro puede no emitir invalidación o emitir una invalidación conservadora; ambas conductas son conformes.

Ejemplo: repetir `registerAccount` con el mismo `AccountKey` y exactamente el mismo binding puede no producir evento. Las suites no exigirán un evento para el no-op ni rechazarán un hint válido conservador.

### TC-04 — CAS de snapshot completo de PendingMutation

`replacePendingMutationIfCurrent(expected, next)` compara `expected` contra el snapshot durable completo. Comparar solo `MutationId` o lifecycle no es suficiente.

Si la mutación persistida conserva identidad y lifecycle pero difiere en kind, target o payload durable, `expected` está stale y el resultado es `conflict`. `next` debe preservar exactamente identidad semántica, kind, target y payload inmutable; únicamente puede reflejar una transición lifecycle válida D-08.

No existe reemplazo arbitrario de payload.

## 4. Cierre P-03

P-03 permanece como fuente de hints semánticos sobre estado local ya committed, nunca como transporte de estado, event bus de negocio o log durable.

`LocalChangeSource` permite múltiples subscriptions independientes. Crear una no reemplaza ni invalida otra. Cada listener activo debe estar aislado de fallos de los demás. Esto no añade APIs: la interfaz pública continúa exponiendo únicamente `subscribe(listener)`.

La semántica cerrada conserva:

* exactamente diez variantes de `LocalChangeHint`;
* `LocalChangeBatch` no vacío;
* hints sin snapshots ni contenido de usuario;
* commit antes de que una notificación sea elegible;
* cobertura eventual para cambios observables mientras la suscripción está activa y el source operativo;
* coalescing y duplicados permitidos;
* ausencia de replay, exactly-once, revisión y orden de negocio;
* listener síncrono sin backpressure;
* `unsubscribe` idempotente y no-throwing;
* cero dependencias Tauri, SQL, JMAP o red.

Un write fallido, conflicted o rolled back no produce invalidación. Una entrega fallida no revierte un commit. La inicialización y recuperación seguras siguen siendo `subscribe → read current state → render`.

## 5. Filosofía de verificación

Los contract tests son state-based y observable-behavior-based:

```text
write
  ↓
read
  ↓
assert observable state
```

No certifican conformance un objeto que implemente un Port mediante `vi.fn()`, un mock que devuelva exactamente el valor esperado ni una prueba que solo compruebe que cierto método fue llamado. Los mocks pueden existir localmente para probar helpers, pero no gobiernan la semántica de Ports.

Las suites no inspeccionan `Map`, arrays internos, SQL, tablas, rows, transacciones internas, structs Rust, payloads IPC ni nombres de eventos Tauri. Solo observan Ports públicos y controles explícitos del harness de test.

## 6. Niveles de testing

1. **LEVEL 1 — TYPE CONTRACTS.** Type-tests existentes de Domain y P-01/P-02/P-03.
2. **LEVEL 2 — PORT RUNTIME CONTRACT.** Suites rápidas, reutilizables y adapter-agnostic, obligatorias para cada implementación.
3. **LEVEL 3 — CROSS-PORT LOCAL ENGINE CONTRACT.** Verifica `P-02 commit → P-03 invalidation → P-01 reread`.
4. **LEVEL 4 — OPTIONAL TEST CONTROLS.** Faults, races deterministas, restart lógico y corrupción inyectada.
5. **LEVEL 5 — ADAPTER/PERSISTENCE INTEGRATION.** SQLite, SQLCipher, migrations, IPC, filesystem y comportamiento de proceso.
6. **LEVEL 6 — E2E.** Desktop Tauri, IPC/events reales y flujos JMAP/Coordinator.

Los niveles superiores complementan los contratos; no sustituyen los niveles 1→3.

## 7. Harness abstracto congelado

La forma conceptual requerida es:

```ts
interface LocalEngineContractHarness {
  readonly name: string
  create(): Promise<LocalEngineContractRuntime>
}

interface LocalEngineContractRuntime {
  readonly readRepository: ReadRepository
  readonly syncPort: SyncPort
  readonly localChangeSource: LocalChangeSource
  settle(): Promise<void>
  dispose(): Promise<void>
}
```

La interfaz está materializada en `src/tests/contracts/harness.ts`; sigue siendo infraestructura de tests, no código productivo ni un Local Engine.

### `create()`

Cada llamada devuelve un runtime válido con estado local aislado y vacío: sin Accounts, suscripciones activas, fixtures implícitos ni estado filtrado desde otro test.

### `settle()`

Es exclusivamente una capacidad del test harness. Drena o espera todo trabajo de entrega de notificaciones actualmente pendiente como resultado de operaciones Port ya completadas.

No dispara red remota, crea trabajo de Application, fabrica notificaciones ni modifica estado committed. Sustituye sleeps y hace determinista la observación eventual.

### `dispose()`

Libera recursos del runtime de test, termina subscriptions/recursos activos y deja el harness listo para crear escenarios posteriores independientes. No es una operación de ningún Port productivo.

### Setup por Ports públicos

El harness core no incluye `seedEmail`, `seedAccount`, `seedDatabase`, `insertRaw` ni equivalentes. El estado válido de un escenario se prepara mediante `SyncPort`; así el setup también atraviesa comportamiento público.

## 8. Fixtures

Toda fixture válida se construye con las factories reales del Domain frozen. Quedan prohibidos casts como `{ ... } as Email` para fabricar entidades.

Las fixtures preservan brands, scope de Account, validaciones y snapshot semantics. Son deterministas, reproducibles, independientes y frescas cuando se pruebe mutación de inputs del caller. No existen objetos globales mutables compartidos entre escenarios.

## 9. Semántica de assertions P-03

Las suites preguntan si la invalidación requerida quedó cubierta, no cuántas llamadas ocurrieron ni en qué posición.

```text
expected required hints ⊆ observed semantic coverage
```

Hints extra válidos, duplicados, coalescing y cualquier orden son aceptables. En general no se usa `toHaveBeenCalledTimes(1)` ni se compara una secuencia exacta de eventos.

Un no-op exitoso se acepta con cero hints o con cobertura conservadora válida. Un conflicto/fallo, en cambio, no puede generar una invalidación falsa por el write rechazado.

Para operaciones exitosas que sí cambian estado observable, la cobertura mínima es:

| Operación P-02 | Cobertura P-03 requerida |
| --- | --- |
| `registerAccount` | `accounts` |
| Email `applyCollectionSync` | `emails(account)`, `emailMemberships(account)`, `syncCursor(account,email)` |
| Mailbox `applyCollectionSync` | `mailboxes(account)`, `syncCursor(account,mailbox)` |
| Identity `applyCollectionSync` | `identities(account)`, `syncCursor(account,identity)` |
| `cacheEmailBody` | `emailBody(email)` |
| `replaceAttachmentRefs` | `attachmentRefs(email)` |
| `replaceMailboxView` | `mailboxView(spec)` |
| `stageSendMutation` | `pendingMutations(account)` |
| `applyOptimisticKeywordMutation` | `emails(account)`, `pendingMutations(account)` |
| `applyOptimisticMailboxMembershipMutation` | `emailMemberships(account)`, `pendingMutations(account)` |
| `replacePendingMutationIfCurrent` | `pendingMutations(account)` |
| `removeConfirmedMutation` | `pendingMutations(account)` |

`emails(account)` también cubre la reevaluación de owner para memberships, body y refs activos. `mailboxes(account)` cubre la reevaluación de owner de views activas. La tabla define subset semántico requerido, no número de batches o hints.

## 10. Suite runtime de ReadRepository

TEST-02 define 45 escenarios estables. La especificación ejecutable exacta vive en `src/tests/contracts/read-repository.contract.ts`; esta tabla mantiene solo la trazabilidad por grupo para evitar duplicar assertions.

| Grupo | IDs | Cantidad | Cobertura requerida |
| --- | --- | ---: | --- |
| Account | RR-A01→RR-A04 | 4 | Absent/present/list y aislamiento entre Accounts. |
| Mailbox | RR-M01→RR-M04 | 4 | `ownerAbsent`, snapshot vacío y present; sin orden semántico. |
| Identity | RR-I01→RR-I04 | 4 | `ownerAbsent`, snapshot vacío, present y scope de Account. |
| Email | RR-E01→RR-E06 | 6 | Absent/present; bulk vacío, posicional y con duplicados; scope de Account. |
| Membership | RR-EM01→RR-EM03 | 3 | `ownerAbsent`, snapshot vacío y present. |
| EmailBody | RR-B01→RR-B05 | 5 | `ownerAbsent`, `notCached`, null/null, empty string y reemplazo. |
| AttachmentRef | RR-AR01→RR-AR05 | 5 | `ownerAbsent`, `notCached`, cached vacío, refs y reemplazo. |
| MailboxView | RR-V01→RR-V05 | 5 | Spec exacta/alternativa y coverage parcial/disjunta. |
| CollectionSyncCursor | RR-C01→RR-C04 | 4 | `ownerAbsent`, absent, present y state vacío opaco. |
| PendingMutation | RR-P01→RR-P05 | 5 | `ownerAbsent`, absent, present y snapshots sin orden semántico. |
| **Total** |  | **45** | Suite ejecutada contra Memory: 45/45 PASS. |

Los errores `unavailable`, `corruptState` y `unexpected`, así como el éxito parcial imposible ante corrupción, permanecen para controles opcionales y suites posteriores; TEST-02 no fabrica esos estados.

## 11. Grupos obligatorios de SyncPort

TEST-03A define 48 escenarios estables en `src/tests/contracts/sync-port-state.contract.ts`. Esta tabla conserva la trazabilidad sin duplicar la especificación ejecutable exacta:

| Grupo TEST-03A | IDs | Cantidad |
| --- | --- | ---: |
| Account | SP-A01→SP-A03 | 3 |
| Collection general | SP-CS01→SP-CS17 | 17 |
| Email sync | SP-E01→SP-E09 | 9 |
| Mailbox sync | SP-M01→SP-M02 | 2 |
| Identity sync | SP-I01→SP-I02 | 2 |
| EmailBody | SP-B01→SP-B03 | 3 |
| AttachmentRef | SP-AR01→SP-AR05 | 5 |
| MailboxView | SP-V01→SP-V04 | 4 |
| Snapshot/alias | SP-SNAP01→SP-SNAP03 | 3 |
| **Total** |  | **48** |

TEST-03B completa P-02 con 43 escenarios de mutaciones optimistas, lifecycle, CAS y cleanup:

| Grupo TEST-03B | IDs | Cantidad |
| --- | --- | ---: |
| Send | SP-S01→SP-S05 | 5 |
| Mutation identity | SP-ID01→SP-ID02 | 2 |
| Keyword | SP-K01→SP-K07 | 7 |
| Mailbox membership | SP-MM01→SP-MM09 | 9 |
| Full-snapshot CAS | SP-CAS01→SP-CAS14 | 14 |
| Confirmed removal | SP-RM01→SP-RM06 | 6 |
| **Total TEST-03B** |  | **43** |
| **Total P-02** | TEST-03A + TEST-03B | **91** |

Los 91 escenarios están definidos y ejecutados contra Memory: 91/91 PASS.

| ID | Cobertura requerida |
| --- | --- |
| SP-ACCOUNT | Registro, idempotencia exacta y prohibición de rebind. |
| SP-COLLECTION-OWNER | Account owner existente al commit; ausencia produce `conflict`, cero cambios, cero cursor y cero hint. |
| SP-COLLECTION-CAS | Delta/replace, expected cursor exacto, stale conflict, absent handling, empty delta y states opacos. |
| SP-COLLECTION-SCOPE | Cross-account, DataType mismatch, identidades duplicadas y changed/destroyed overlap se rechazan. |
| SP-COLLECTION-REPLACE | Replace completo; caches lazy de Emails sobrevivientes se preservan; Email sync no altera MailboxView implícitamente. |
| SP-BODY | Owner precondition y reemplazo de snapshot completo. |
| SP-ATTACHMENT | Cached vacío, reemplazo, identidad y scope de refs. |
| SP-VIEW | Owner requerido, identidad exacta, reemplazo completo y queryState opaco. |
| SP-SEND | Stage durable sin crear fake Email. |
| SP-KEYWORD | Proyección y mutación atómicas; un delta semántico no-op válido persiste la mutación. |
| SP-MEMBERSHIP | Proyección y mutación atómicas; membership final no vacío; no-op válido persiste la mutación. |
| SP-MUTATION-CAS | CAS de snapshot completo, transición lifecycle válida, stale conflict y un solo ganador. |
| SP-MUTATION-REMOVE | Solo una mutación actualmente confirmed puede eliminarse. |
| SP-RESTART | Un `inFlight` sobrevive al futuro restart lógico para reconciliación. |
| SP-SNAPSHOT | Arrays mutables del caller no permanecen aliasados al estado committed. |

## 12. Grupos obligatorios de LocalChangeSource

TEST-04 define 23 escenarios estables y los ejecuta contra Memory:

| Grupo TEST-04 | IDs | Cantidad |
| --- | --- | ---: |
| Subscription lifecycle | LC-S01→LC-S09 | 9 |
| P-02→P-03 mapping | LC-M01→LC-M12 | 12 |
| Failure/no-op | LC-F01→LC-F02 | 2 |
| **Total P-03** |  | **23** |

| ID | Cobertura requerida |
| --- | --- |
| LC-SUBSCRIBE | Success implica subscription ya activa; varias subscriptions son independientes. |
| LC-UNSUBSCRIBE | Idempotente; después de retornar no comienzan nuevas invocaciones. |
| LC-ISOLATION | La excepción de un listener no afecta otros listeners ni estado committed. |
| LC-REPLAY | Cambios anteriores a subscribe no se reproducen. |
| LC-COVERAGE | Un cambio observable P-02 exitoso produce cobertura semántica suficiente. |
| LC-NOOP | Un no-op exitoso permite cero hints o invalidación conservadora. |
| LC-FAILURE | Conflictos/fallos no generan invalidaciones falsas. |
| LC-DELIVERY | Coalescing, duplicados y cualquier orden son tolerados. |
| LC-PAYLOAD | Hints no contienen state payload ni contenido de usuario. |
| LC-OWNER | `emails(account)` y `mailboxes(account)` cubren reevaluación de owners dependientes. |

## 13. Grupos sistémicos del Local Engine

TEST-05 define 20 escenarios portables y los ejecuta contra Memory:

| Grupo TEST-05 | Cantidad |
| --- | ---: |
| Bootstrap | 3 |
| Commit consistency | 4 |
| Owner/cache | 5 |
| Lazy cache | 2 |
| Optimistic/Outbox | 4 |
| Isolation | 2 |
| **Total sistémico** | **20** |

| ID | Invariante observable |
| --- | --- |
| SYS-WRITE | Write exitoso → invalidación que cubre el cambio → reread observa estado committed. |
| SYS-FAILURE | Write fallido/conflicted → estado intacto → ninguna invalidación falsa. |
| SYS-KEYWORD | Proyección Keyword y PendingMutation se observan juntas después del éxito. |
| SYS-MEMBERSHIP | Proyección Membership y PendingMutation se observan juntas después del éxito. |
| SYS-COLLECTION | Colección y cursor avanzan juntos o ninguno avanza. |
| SYS-COMMIT-FIRST | Ninguna notificación del cambio puede observarse antes de su commit. |
| SYS-RESTART | Restart lógico futuro preserva estado durable, no subscriptions ni replay. |
| SYS-EMAIL-OWNER | Destruir Email vuelve `ownerAbsent` sus lecturas dependientes. |
| SYS-MAILBOX-OWNER | Destruir Mailbox vuelve `ownerAbsent` su View. |
| SYS-ISOLATION | Accounts distintas no comparten ni contaminan estado. |
| SYS-SNAPSHOT | Mutar arrays originales tras un write no altera el snapshot committed. |

Las operaciones collection/bulk que fallen por corrupción o precondición no pueden exponer éxito parcial. Se verificará mediante estado observable, no inspeccionando transacciones internas.

## 14. Controles opcionales futuros

Podrán existir extensiones separadas del harness:

* `FaultControl`;
* `RaceControl`;
* `RestartControl`;
* `CorruptionControl`.

Son capacidades de test opcionales y nunca métodos de Ports productivos.

El contrato válido core puede provocar naturalmente `conflict`. En general, `corruptState`, `unavailable` y `unexpected` requieren controles de fault/corruption específicos y se prueban después. No se fabrica corrupción mediante Ports públicos.

## 15. Patrones prohibidos

Las suites contractuales no usan:

* mocks o spies como prueba de semántica del Port;
* assertions sobre almacenamiento o funciones internas;
* sleeps, `setTimeout` o polling temporal como sincronización;
* conteo exacto u orden exacto de notificaciones;
* umbrales de rendimiento como 50 ms o 100 ms;
* SQL, Tauri, Rust, filesystem, IPC o JMAP;
* fixtures Domain fabricadas mediante type casts;
* estado mutable global compartido.

Performance y benchmarking pertenecen a otra fase.

## 16. Property-based testing

Queda **DEFERRED** hasta que la conformance determinista core esté verde. Targets futuros posibles: secuencias de cursores, lifecycle de mutaciones, deltas de memberships y colisiones de scope entre Accounts.

TEST-00 no añade `fast-check`, proptest ni otra dependencia.

## 17. Gates congelados

### PORT CONTRACT SPECIFICATION: PASS

Requiere que todos los requisitos frozen estén mapeados a grupos/IDs, no quede comportamiento esperado indefinido, las assertions sean independientes de implementación, no existan sleeps ni dependencias SQL/Tauri/JMAP, las notificaciones se verifiquen por cobertura y la política de fixtures deterministas esté definida.

### MEMORY LOCAL ENGINE: FINAL CONFORMANCE PASS

Cumplido por TEST-05/TEST-06 y el audit final: 179/179 escenarios portables y 18/18 escenarios de hardening en PASS, cero skipped/todo, regresión en PASS, cero timing sleeps y ninguna modificación de los contratos congelados para acomodar Memory. Esto habilita `MemoryLocalEngine` para integración de Application/Coordinator; no demuestra persistencia, crash safety, IPC, Tauri, SQLCipher ni JMAP.

### TAURI LOCAL ENGINE: CONFORMANT

Requerirá las mismas suites de Ports y del Local Engine en PASS, además de suites específicas de persistencia e IPC.

## 18. Próxima secuencia

TEST-00→TEST-06, el audit final de Memory y PERSIST-00 están completos. `MemoryLocalEngine` pasa 179/179 escenarios portables y 18/18 de hardening. El contrato normativo para la persistencia futura vive en [persistence-contract.md](../architecture/persistence-contract.md). PERSIST-01 es el siguiente bloque y requiere revisión conjunta; todavía no existe persistencia SQLite/SQLCipher, IPC ni adapter Tauri productivo.
