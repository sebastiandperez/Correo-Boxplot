# Corrección Auditoría Persona C (C-01 → C-08)

Este plan aborda **todas las deficiencias detectadas** por la auditoría, agrupadas por severidad.

---

## Hallazgos y Correcciones

### 🔴 CRÍTICO

#### 1. `globalThis.fetch` override — riesgo de fuga de tokens entre cuentas

**Problema:** [`http.ts`](file:///c:/Users/juand/OneDrive/Escritorio/Cosas%20innecesarias/URosario/SEMESTRE_6/REDES/Correo-Boxplot/src/jmap/transport/http.ts) reemplaza `globalThis.fetch` de forma permanente. Si existieran dos instancias de `JamClientAdapter` con tokens diferentes, o si cualquier otra parte de la app (UI, analytics, etc.) usa `fetch`, el header `Authorization` se inyectaría en URLs incorrectas. El filtro `urlStr.includes('/jmap/')` es frágil y podría matchear URLs no deseadas.

**Corrección:** Eliminar el override global. En su lugar, pasar la función `fetch` autenticada directamente a `JamClient` como opción. Si `jmap-jam 0.13.3` no la honra en `loadSession`, documentar la limitación y crear un wrapper que invoque `loadSession` manualmente con `fetch` directo en vez de confiar en el global. El token debe inyectarse **solo** en llamadas cuya URL base coincida exactamente con el `sessionUrl` o `apiUrl` conocido.

> [!CAUTION]
> Este es un riesgo de seguridad real. Según `security.md` §4: "El token JMAP vive solo en memoria del Worker, nunca en Pinia, SQLite, localStorage, archivos o logs." El override global no cumple esta invariante porque contamina el espacio global donde cualquier código del webview podría hacer un `fetch` que recibiría el token.

#### [MODIFY] [`src/jmap/transport/http.ts`](file:///c:/Users/juand/OneDrive/Escritorio/Cosas%20innecesarias/URosario/SEMESTRE_6/REDES/Correo-Boxplot/src/jmap/transport/http.ts)
- Crear una función `createAuthenticatedFetch(baseUrl: string, auth: AuthConfig)` que retorne un `fetch` wrapper que **solo** inyecte `Authorization` cuando la URL empiece exactamente con `baseUrl`.
- Pasar ese `fetch` como opción a `JamClient`.
- **Nunca** tocar `globalThis.fetch`.

---

#### 2. C-07 debía ser WebSocket, no SSE — falta reconnect y lifecycle

**Problema:** La ruta de persona C especifica explícitamente en el **Paso 7** que C-07 es "**WebSocket** StateChange" con `WebSocketPushEnable`, reconnect con backoff, y que vive en el Worker. La implementación actual usa SSE via fetch, sin reconnect, sin backoff, sin lifecycle de desconexión.

**Corrección:** Reemplazar [`src/jmap/transport/sse.ts`](file:///c:/Users/juand/OneDrive/Escritorio/Cosas%20innecesarias/URosario/SEMESTRE_6/REDES/Correo-Boxplot/src/jmap/transport/sse.ts) por [`src/jmap/transport/websocket.ts`](file:///c:/Users/juand/OneDrive/Escritorio/Cosas%20innecesarias/URosario/SEMESTRE_6/REDES/Correo-Boxplot/src/jmap/transport/websocket.ts).

#### [NEW] `src/jmap/transport/websocket.ts`
- Conectar al WebSocket endpoint del JMAP Session.
- Enviar comando `WebSocketPushEnable` tras conexión.
- Parsear `StateChange` events tipados.
- Implementar reconnect con backoff exponencial (base 1s, max 30s).
- Manejar payloads inválidos (no crash, log y continuar).
- Retornar función `disconnect()` para lifecycle.

#### [DELETE] `src/jmap/transport/sse.ts`
#### [DELETE] `src/jmap/transport/__tests__/sse.test.ts`

#### [NEW] `src/jmap/transport/__tests__/websocket.test.ts`

---

### 🟠 ALTO

#### 3. `batching.ts` y `submission.ts` usan `jam.request` con casts `as unknown as`

**Problema:** Se castea `jam.request.bind(jam) as unknown as BatchRequest` para evadir los tipos de `jmap-jam`. Los mocks en tests replican esta evasión, ocultando que la API real (`requestMany` para múltiples method calls) difiere. Si `jmap-jam` cambia, los tests seguirán pasando pero producción fallará.

**Corrección:** Usar `jam.requestMany()` (la API documentada de jmap-jam para múltiples method calls) o, si no existe, invocar `fetch` directamente contra `apiUrl` con el payload JMAP correcto. Eliminar todos los casts `as unknown as`.

#### [MODIFY] [`src/jmap/mail/batching.ts`](file:///c:/Users/juand/OneDrive/Escritorio/Cosas%20innecesarias/URosario/SEMESTRE_6/REDES/Correo-Boxplot/src/jmap/mail/batching.ts)
- Investigar la API real de `jmap-jam` para batch requests.
- Si no soporta batch nativo compatible, implementar `fetch` directo contra `apiUrl` con el payload JSON de method calls múltiples.
- Eliminar todos los type aliases `BatchRequest`, `EmailQueryRequest`, etc. que son wrappers de cast.

#### [MODIFY] [`src/jmap/mail/submission.ts`](file:///c:/Users/juand/OneDrive/Escritorio/Cosas%20innecesarias/URosario/SEMESTRE_6/REDES/Correo-Boxplot/src/jmap/mail/submission.ts)
- Misma corrección: eliminar `MailboxQueryRequest`, `SubmissionBatchRequest`.

#### [MODIFY] [`src/jmap/mail/mutations.ts`](file:///c:/Users/juand/OneDrive/Escritorio/Cosas%20innecesarias/URosario/SEMESTRE_6/REDES/Correo-Boxplot/src/jmap/mail/mutations.ts)
- Misma corrección: eliminar `EmailSetRequest`.

#### [MODIFY] [`src/jmap/mail/email-query.ts`](file:///c:/Users/juand/OneDrive/Escritorio/Cosas%20innecesarias/URosario/SEMESTRE_6/REDES/Correo-Boxplot/src/jmap/mail/email-query.ts)
- Eliminar `EmailQueryRequest` cast.

---

#### 4. Body/Attachment normalizers no respetan D-09/D-10

**Problema:**
- [`body-normalizer.ts`](file:///c:/Users/juand/OneDrive/Escritorio/Cosas%20innecesarias/URosario/SEMESTRE_6/REDES/Correo-Boxplot/src/jmap/normalizers/body-normalizer.ts) produce `JmapEmailBody` (tipo JMAP propio) con `emailId: string`, pero D-09 (`EmailBody`) usa `emailId: ScopedEmailId`. El normalizador JMAP debe producir **su propio DTO** que luego el Coordinador/SyncPort transforme a Domain, no intentar matchear el Domain directamente.
- [`attachment-normalizer.ts`](file:///c:/Users/juand/OneDrive/Escritorio/Cosas%20innecesarias/URosario/SEMESTRE_6/REDES/Correo-Boxplot/src/jmap/normalizers/attachment-normalizer.ts) produce `JmapAttachment` con `blobId: string` e `isInline: boolean`, pero D-10 (`AttachmentRef`) tiene `blobId: ScopedBlobId`, `partId: AttachmentPartId`, `mediaType` (no `type`), `disposition` (no `isInline` boolean), y validaciones estrictas. El normalizador no extrae `partId` ni respeta la shape D-10.

**Corrección:** Los normalizadores deben producir DTOs JMAP propios (`JmapEmailBody` y `JmapAttachment`) que sean fieles al wire format. La conversión a Domain (`EmailBody` / `AttachmentRef`) es responsabilidad de la capa Sync/Coordinator, no de `src/jmap/`.

#### [MODIFY] [`src/jmap/normalizers/attachment-normalizer.ts`](file:///c:/Users/juand/OneDrive/Escritorio/Cosas%20innecesarias/URosario/SEMESTRE_6/REDES/Correo-Boxplot/src/jmap/normalizers/attachment-normalizer.ts)
- Incluir `partId` en la salida.
- Renombrar el campo a `mediaType` (o usar `type` y dejar la conversión al coordinador, marcando la discrepancia de naming).
- Incluir `disposition` literal en vez de boolean `isInline`.

---

#### 5. `queryEmails` pierde `queryState`, `total`, `position` y no existe `Email/queryChanges`

**Problema:** [`email-query.ts`](file:///c:/Users/juand/OneDrive/Escritorio/Cosas%20innecesarias/URosario/SEMESTRE_6/REDES/Correo-Boxplot/src/jmap/mail/email-query.ts) devuelve solo `string[]` (IDs), descartando `queryState`, `total`, `position` y `canCalculateChanges` que existen en `RawJmapQueryResponse`. El Coordinador necesita estos campos para paginación y para `Email/queryChanges` (que no está implementado).

**Corrección:**

#### [MODIFY] `src/jmap/types.ts`
- Crear tipo `JmapQueryResult` con `ids`, `queryState`, `total`, `position`, `canCalculateChanges`.

#### [MODIFY] `src/jmap/client.ts`
- Cambiar `queryEmails` para que retorne `JmapQueryResult` en vez de `string[]`.
- Añadir método `getEmailQueryChanges(accountId, sinceQueryState, ...)` que implemente `Email/queryChanges`.

#### [MODIFY] `src/jmap/mail/email-query.ts`
- Retornar el objeto completo en vez de solo `ids`.

#### [NEW] `src/jmap/mail/email-query-changes.ts`
- Implementar `Email/queryChanges`.

---

#### 6. `JmapEmail` no respeta D-02/D-03 — IDs son `string` en vez de tipos opacos

**Problema:** [`types.ts`](file:///c:/Users/juand/OneDrive/Escritorio/Cosas%20innecesarias/URosario/SEMESTRE_6/REDES/Correo-Boxplot/src/jmap/types.ts) define `JmapEmail.id` como `string`, pero Domain D-02 usa `ScopedEmailId` (un tipo opaco compuesto). Los DTOs JMAP deben usar strings crudos (son DTOs de red), lo cual es correcto, pero:
- `keywords` está definido como `ReadonlySet<string> | Record<string, boolean>` — un union type ambiguo que no debería existir. Debe ser `Record<string, boolean>` (el formato wire JMAP) y la conversión a `KeywordSet` es del Coordinator.

**Corrección:**

#### [MODIFY] `src/jmap/types.ts`
- `keywords` debe ser `Record<string, boolean>` (forma JMAP nativa), no el union con `ReadonlySet`.

---

#### 7. Falta `Identity/get`

**Problema:** La interfaz `JmapClient` no incluye `getIdentities()`. El Coordinador necesita saber qué identidades de envío tiene el usuario para alimentar D-04 (SendIntent) y la selección de "desde" en el composer.

#### [MODIFY] `src/jmap/client.ts`
- Añadir `getIdentities(accountId: string): Promise<JmapIdentity[]>`.

#### [MODIFY] `src/jmap/types.ts`
- Crear tipo `JmapIdentity`.

#### [NEW] `src/jmap/mail/identity.ts`
- Implementar `Identity/get`.

---

### 🟡 MEDIO

#### 8. `EmailSubmission` está acoplado a SendIntent de Domain

**Problema:** [`submission.ts`](file:///c:/Users/juand/OneDrive/Escritorio/Cosas%20innecesarias/URosario/SEMESTRE_6/REDES/Correo-Boxplot/src/jmap/mail/submission.ts) importa `SendIntent` y `EmailAddress` de `src/domain/`. Según `layers.md`: "JMAP Client no depende de modelos UI ni escribe directamente en la base" y "No produce modelos de UI". Aunque la capa JMAP *puede* depender de Domain para tipos, la conversión de `SendIntent` → payload JMAP debería ser responsabilidad del Coordinator, no del cliente JMAP. El cliente JMAP debe recibir un DTO propio.

**Corrección:**

#### [MODIFY] `src/jmap/mail/submission.ts`
- Definir `JmapEmailDraft` como tipo propio de la capa JMAP.
- El método `submitEmail` recibe `JmapEmailDraft` + `rawIdentityId` en vez de `SendIntent`.
- La conversión `SendIntent → JmapEmailDraft` se hará en el futuro Coordinator.

#### [MODIFY] `src/jmap/client.ts`
- Eliminar import de `SendIntent`.
- Cambiar firma de `submitEmail`.

---

#### 9. Session discovery no valida endpoints vacíos

**Problema:** [`session.ts`](file:///c:/Users/juand/OneDrive/Escritorio/Cosas%20innecesarias/URosario/SEMESTRE_6/REDES/Correo-Boxplot/src/jmap/session.ts) asigna `apiUrl = session.apiUrl || ''` sin validar que sean URLs reales. Un `apiUrl` vacío resultaría en llamadas JMAP rotas silenciosamente.

**Corrección:** Lanzar error si `apiUrl`, `downloadUrl` o `uploadUrl` están vacíos o no son URLs válidas.

#### [MODIFY] `src/jmap/session.ts`

---

#### 10. `TokenManager` no está en un Worker ni integrado con el adapter

**Problema:** `TokenManager` existe como clase aislada pero:
- No vive en `src/workers/` como requiere C-08.
- No está conectado al `JamClientAdapter`.
- No hay canario de verificación post-cierre.
- No hay integración con el lifecycle de la app.

**Corrección:** Esto requiere crear `src/workers/` con el bootstrap del Worker. Sin embargo, dado que el Coordinator y Outbox (sus consumidores) aún no están implementados, la integración completa es prematura. Lo correcto para el alcance actual:

#### [MODIFY] `src/jmap/auth/token-manager.ts`
- Añadir método `getAuthConfig(): AuthConfig | null` que genere un `AuthConfig` desde el token actual.
- Añadir el string canario para verificación post-cierre.

#### [NEW] `src/workers/jmap-worker.ts`
- Crear el bootstrap mínimo del Worker que instancie `TokenManager` y lo use para crear `JamClientAdapter`.
- El token se recibe via `postMessage` y nunca se expone al hilo principal.

---

## Open Questions

> [!IMPORTANT]
> **WebSocket vs SSE:** La ruta C dice WebSocket. Stalwart soporta ambos. ¿Confirmas que procedemos con WebSocket como dice la spec, o prefieres mantener SSE dado que ya funciona? Mi recomendación: WebSocket, porque la ruta lo exige y es el protocolo estándar JMAP para push bidireccional.

> [!IMPORTANT]
> **`jmap-jam` API batch:** Necesito verificar si `jmap-jam 0.13.3` expone `requestMany` o equivalente para múltiples method calls sin castear. Si no la expone, ¿autorizas usar `fetch` directo contra `apiUrl` para los batches, bypasseando `jmap-jam` solo para esa operación?

> [!WARNING]
> **Scope del Worker:** C-08 pide crear `src/workers/`. El Worker completo requiere Coordinator y Outbox (que son responsabilidad de otra persona/fase). ¿Creo solo el bootstrap mínimo (TokenManager + JamClientAdapter instanciados dentro del Worker), dejando el Coordinator como stub, o prefieres diferir el Worker por completo hasta que esas piezas estén listas?

---

## Verification Plan

### Automated Tests
```bash
pnpm test          # Suite completa Vitest
pnpm typecheck     # vue-tsc --noEmit
```

### Manual Verification
- Verificar que ningún archivo en `src/jmap/` importe de Vue, Pinia, SQLite o Rust.
- Verificar que `globalThis.fetch` no se modifica en ningún archivo.
- Verificar que `SendIntent` no se importe en `src/jmap/`.
- Verificar que todos los tests mockean la API real de `jmap-jam`, no wrappers inventados.
