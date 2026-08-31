# ADR-012 — Evidencia autoritativa para reconciliar mutaciones remotas

**Status:** ACCEPTED · IMPLEMENTED · AWAITING INDEPENDENT VERIFY

## Context

`MUTATION-EXECUTION-RECONCILIATION-01` reclama cada mutación durable mediante
CAS antes de ejecutar el efecto remoto. Una respuesta SMTP aceptada puede no
traer `RemoteEmailId`, y una desconexión después de `UID MOVE` puede ocultar un
efecto ya aplicado. Reenviar cualquiera de esas operaciones a ciegas puede
duplicar correo o mover el mensaje equivocado. A la vez, `SendConfirmation`
requiere un `ScopedEmailId` concreto: un receipt, un booleano o una identidad
fabricada no pueden confirmarla.

`MutationId` ya es durable y se usa como `idempotencyKey`. El SMTP nativo genera
de esa clave el `Message-ID` canónico
`<boxplot.${base64urlNoPad(utf8(idempotencyKey))}@boxplot.invalid>`. Igual clave
produce igual header, claves diferentes producen headers diferentes y los
corchetes angulares forman parte del valor. Servidor-Boxplot conserva el header
al parsear el mensaje y guarda los mismos bytes normalizados en la copia de
`Sent`.

La superficie nativa previa tenía nueve comandos y solo ofrecía
`UID SEARCH ALL`. La implementación añade la única extensión aprobada para
buscar el marcador exacto y devolver su identidad IMAP. Servidor-Boxplot añade
el subconjunto estándar `UID SEARCH HEADER Message-ID` requerido.

## Decision

Se añade el contrato protocol-neutral `RemoteMutationReconciler`, separado de
`RemoteMail`, `Submission`, Domain y Ports:

```ts
type RemoteMutationEvidence =
  | Readonly<{ kind: 'applied'; emailId: RemoteEmailId }>
  | Readonly<{ kind: 'inconclusive' }>

interface RemoteMutationReconciler {
  reconcileSend(request: {
    remoteAccountId: RemoteAccountId
    idempotencyKey: string
  }): Promise<RemoteMutationEvidence>

  reconcileMembership(request: {
    remoteAccountId: RemoteAccountId
    idempotencyKey: string
    emailId: RemoteEmailId
    change: RemoteMembershipChange
  }): Promise<RemoteMutationEvidence>
}
```

`applied` siempre incluye la identidad remota concreta posterior al efecto.
`inconclusive` no incluye payload. No se incorpora `notApplied`: ni la ausencia
inmediata de una copia enviada ni la desaparición del UID fuente demuestran de
forma general que la operación original no se aplicó. Un fallo de red, protocolo
o sesión durante la consulta también conserva la mutación `inFlight`; el outcome
del error describe la consulta de evidencia, no reinterpreta el efecto original.

El runner podrá repetir la consulta de reconciliación, pero nunca repetirá la
submission o el MOVE mientras el intento original siga `inFlight`. La capacidad
se adjuntará al mismo lifecycle de sesión account-scoped ya usado por body y
mutaciones. No abre una segunda sesión, no vuelve a pedir credenciales y una
expiración invalida la capacidad compartida sin reproducir el efecto.

### Send

El adapter nativo deriva de nuevo el `Message-ID` únicamente desde el
`idempotencyKey`, resuelve el mailbox cuyo rol normalizado es `sent` y consulta
la sesión IMAP activa. No hardcodea el nombre visible `Sent` en el contrato
protocol-neutral.

La evidencia se interpreta así:

- cero coincidencias exactas: `inconclusive`;
- exactamente una coincidencia exacta: `applied` con su `RemoteEmailId`;
- dos o más coincidencias exactas: `inconclusive`.

La búsqueda no usa subject, timestamp, sender, recipients, tamaño, posición de
mailbox, contenido ni un receipt efímero. Cero resultados puede ser una carrera
de visibilidad; múltiples resultados pueden ser duplicados reales o estado
remoto corrupto. En ninguno de esos casos se elige arbitrariamente un Email.
Plain y Boxplot E2EE usan la misma correlación; no se inspecciona ni descifra el
body.

### Membership

Una reconciliación positiva requiere identidad autoritativa del mismo mensaje y
el postcondition solicitado, y devuelve el `RemoteEmailId` posterior a la
mutación. Para un backend con identidad estable, como JMAP, el mismo Email más
la membresía autoritativa puede aportar esa prueba.

En IMAP, la ausencia del UID fuente y la presencia de un mensaje parecido en el
destino no establecen causalidad. Subject, fecha, tamaño, headers no únicos o
posición quedan prohibidos. Si el resultado `COPYUID` no se recibió y persistió
antes del crash, el estado durable actual no permite reconstruir el vínculo de
forma genérica. Ese MOVE permanece `inFlight`/`inconclusive`; esta preservación
segura es comportamiento MVP aceptado, no un defecto pendiente. Una extensión
futura con evidencia exacta podrá producir `applied` sin cambiar el contrato.

## Native reconciliation extension

Se implementa una única extensión aditiva aprobada por
`MUTATION-EXECUTION-RECONCILIATION-REPAIR-01`:

```text
command: native_imap_find_message_id

request:
{
  sessionId: string,
  mailbox: string,
  messageId: string
}

response:
{ kind: "notFound" }
| {
    kind: "found",
    emailId: {
      mailbox: string,
      uidValidity: number,
      uid: number
    }
  }
| { kind: "ambiguous" }
```

El comando usa exclusivamente la sesión autenticada indicada. `mailbox` debe
pertenecer a esa sesión y el resultado repite el mailbox seleccionado, su
`UIDVALIDITY` vigente y el UID encontrado. TypeScript lo convierte mediante el
encoder IMAP existente; Rust no fabrica `RemoteEmailId` ni DTO JMAP.

La operación selecciona el mailbox, captura `UIDVALIDITY`, ejecuta
`UID SEARCH HEADER Message-ID "<canonical-value>"` y verifica el valor completo
del header para cada candidato antes de contarlo como exacto. Esta verificación
adicional es obligatoria porque IMAP `HEADER` usa matching por substring y no
puede, por sí solo, probar igualdad. El valor se compara sin trim, lowercase,
remoción de `< >` ni otra normalización.

La implementación reutilizará los límites ya congelados de línea, literal,
líneas acumuladas y texto acumulado. La colección de candidatos tendrá un
límite explícito de 256; excederlo produce `ambiguous`, nunca selección parcial.
Los headers de candidatos se obtienen con `BODY.PEEK` y permanecen bajo el
límite acumulado de literals. Ningún resultado normal 0/1/many se expresa como
excepción.

Errores de red o lectura usan el mapping nativo existente y expiran la sesión
cuando el socket puede quedar desincronizado. Una sesión ausente/expirada se
reporta `stateInvalid`, `session: expire`, `outcome: notApplicable`. Un mailbox
ausente o una respuesta remota inválida se mapea a `stateInvalid`/`protocol`
según corresponda. En todos los casos el reconciler superior traduce el fallo a
ausencia de evidencia y mantiene el intento original `inFlight`; nunca infiere
`notApplied`.

El inventario nativo aprobado después de la reparación será:

```text
9 comandos existentes + native_imap_find_message_id = 10
```

Los 25 comandos `local_*` permanecen intactos. La ampliación nativa es explícita
y Servidor-Boxplot implementa el subconjunto estándar
`UID SEARCH HEADER Message-ID` necesario para la prueba vertical, sin backdoor
de base de datos ni endpoint de debug.

## Restart and durable state

No se añade `receiptId` ni `messageId` al Domain. Tras reinicio son suficientes:

- Send: `MutationId`, `SendIntent`, `securityMode` y lifecycle;
- Membership: `MutationId`, Email anterior, cambio y lifecycle.

El marcador SMTP se deriva nuevamente de `MutationId`. El receipt devuelto en
la respuesta normal puede seguir siendo diagnóstico efímero, pero no es
precondición de reconciliación. Cuando la evidencia Send contiene un
`RemoteEmailId`, el runner lo convierte al `ScopedEmailId` de la cuenta y usa la
factoría de confirmación existente.

## Rejected alternatives

- Confirmar con receipt, booleano, MutationId recasteado o Email ID sintético.
- Buscar por subject, fecha, remitente, recipients, tamaño, contenido o posición.
- Elegir el primer/último resultado o deduplicar por heurística.
- Tratar cero resultados como `notApplied` y reenviar SMTP.
- Tratar ausencia del UID fuente como prueba de MOVE y repetirlo o confirmarlo.
- Persistir fingerprints, receipt o Message-ID que pueden derivarse o no aportan
  causalidad autoritativa.
- Abrir una segunda sesión IMAP o conservar credenciales en TypeScript.
- Añadir métodos de reconciliación a `RemoteMail`, `Submission`, Domain o Ports.

## Consequences

- `MX-RC-01` queda resuelto por un camino implementable, restart-safe y sin
  resend desde `MutationId` hasta exactamente un `RemoteEmailId`.
- `MX-RC-02` queda resuelto aceptando `inconclusive` como estado seguro del MVP;
  la resolución automática de todo MOVE ambiguo no es requisito.
- El reconciler, la ampliación nativa y el settlement del runner están
  implementados; resta la verificación independiente combinada.
- Esta decisión no congela todavía Mutation Execution/Reconciliation.
