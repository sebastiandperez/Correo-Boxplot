# ADR-008 — Frontera remota protocol-neutral

**Status:** ACCEPTED

## Context

La implementación recuperada de Sprint 1 hacía depender directamente a
Coordinator y Outbox de `JmapClient`. Esa interfaz sigue siendo una API interna
útil para hablar JMAP, pero no puede representar limpiamente IMAP para recepción
ni SMTP para submission sin fabricar DTOs e identidades JMAP.

El Domain, P-01/P-02/P-03, los 25 comandos del Local Engine, IPC, SQLCipher y su
vocabulario `Jmap*` están congelados. Renombrarlos en bloque no es condición para
separar el protocolo remoto.

## Decision

Se adopta una frontera remota protocol-neutral en `src/remote/`:

- Coordinator depende de `RemoteMail`.
- Outbox depende de `RemoteMail` y de `Submission`.
- JMAP es una implementación mediante `JmapRemoteMail` y `JmapSubmission`.
- IMAP será otra implementación de `RemoteMail`.
- SMTP será una implementación de `Submission`; IMAP no envía correo.
- `JmapClient` queda como API interna del adapter JMAP, no como puerto remoto
  universal.
- Los IDs y estados remotos son opacos (`Remote*` y `RemoteSyncState`).
  Coordinator y Outbox no inspeccionan formatos ni ramas de protocolo.
- `src/remote/compat/` es el único puente entre el vocabulario remoto canónico
  y los nombres locales `Jmap*` congelados temporalmente en Domain/IPC/schema.
  Ese puente no afirma que IDs derivados de IMAP sean IDs JMAP.
- Un reemplazo remoto solo es válido si el snapshot es completo y autoritativo.
  Paginación, `cannotCalculateChanges`, estados y DTOs concretos permanecen
  detrás del adapter.
- `SubmissionResult` puede aceptar sin entregar inmediatamente un
  `RemoteEmailId`. Outbox conserva entonces la mutación `inFlight` para
  reconciliación y nunca fabrica un Email ID.
- `SubmissionMessage` conserva el `RemoteAccountId` de la operación para que
  un adapter enrute correctamente sesiones con más de una cuenta remota.

JMAP continúa en TypeScript sobre HTTP. Rust puede abrir TCP/TLS únicamente para
protocolos nativos que lo requieran, como IMAP/SMTP. Rust no traduce IMAP a DTOs
JMAP falsos, no se convierte en proxy de red genérico y el Local Engine sigue
sin networking remoto.

`RemoteSession` expone descriptores de cuenta, `RemoteMail`, `Submission` y
`close()`. Nunca expone token, password o clave criptográfica.

## Consequences

- Coordinator ya no selecciona métodos JMAP ni conoce `Email/changes`, paging,
  `queryState` de transporte o `JmapMethodError`.
- Outbox ya no conoce `JmapEmailDraft`, EmailSubmission, IMAP o SMTP.
- Errores concretos se convierten en `RemoteError`, con clasificación de retry,
  efecto de sesión y certeza del outcome.
- `RemoteBody` transporta una representación plain normalizada o un envelope
  Boxplot E2EE opaco. Descifrado y materialización quedan fuera de esta decisión.
- La selección de protocolo ocurre una vez en runtime/composición.
- Los fakes protocol-neutral permiten probar Coordinator y Outbox sin JMAP.

## Deferred

- Implementación IMAP y SMTP, sockets TCP/TLS y política UID/cursor.
- Reconciliación SMTP después de aceptación sin Email ID.
- Integración Worker de BodyMaterializer/E2EE.
- Migración futura del vocabulario `Jmap*` en Domain, IPC y persistencia.
- RemoteApplication y la aceptación Alice/Bob de extremo a extremo.

## Supersedes

Este ADR supersede ADR-007. ADR-007 permanece como registro histórico, pero su
traductor IMAP→JMAP y su uso de `JmapClient` como puerto universal ya no son la
arquitectura autorizada.
