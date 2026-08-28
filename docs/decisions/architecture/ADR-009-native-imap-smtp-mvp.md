# ADR-009 — Native IMAP/SMTP loopback MVP

**Status:** ACCEPTED

## Context

ADR-008 froze the protocol-neutral `RemoteMail` and `Submission` boundary. The
local Servidor-Boxplot acceptance server exposes a deliberately small IMAP and
SMTP surface on loopback without TLS. The client needs a first non-JMAP backend
without leaking native protocol vocabulary into Coordinator, Outbox, Domain,
Ports or the Local Engine.

## Decision

- The Remote Boundary remains frozen. `ImapRemoteMail` implements `RemoteMail`
  and `SmtpSubmission` implements `Submission`.
- Rust owns native IMAP/SMTP sockets. This networking module is separate from
  the Rust Local Engine and does not know SQLite, SQLCipher, Domain or Ports.
- Rust returns explicit native-mail DTOs. It never fabricates JMAP DTOs.
- TypeScript maps native IMAP DTOs into protocol-neutral `Remote*` values and
  maps `SubmissionMessage` into typed native SMTP IPC.
- The nine `native_*` commands are separate from the frozen 25 `local_*`
  commands. The password appears only in `native_mail_open`, then remains in a
  zeroizing, memory-only Rust session until close or runtime drop.
- Plaintext native mail is allowed only after host resolution proves every
  destination address is loopback (`127.0.0.0/8` or `::1`). Non-loopback
  targets fail closed before connect, authentication or content transmission.
- External IMAP/SMTP TLS is deferred to NATIVE-MAIL-TLS-01. There is no
  opportunistic downgrade or JMAP fallback.
- IMAP MVP synchronization is a complete authoritative replacement. UIDNEXT
  cannot safely model flag changes, moves or deletions, so no delta is claimed.
- IMAP message identity is mailbox + UIDVALIDITY + UID. A stale UIDVALIDITY is
  rejected before a UID operation. MOVE may allocate a new UID and therefore a
  new `RemoteEmailId`; the next full snapshot reconciles it.
- IMAP has no Identity collection, so the combined adapter exposes one
  protocol-neutral `RemoteIdentity` derived from the authenticated mailbox
  address.
- When an anchored mailbox query also supplies `position`, the anchor and its
  offset take precedence; this rule is deterministic and confined to the IMAP
  adapter.
- SMTP acceptance does not imply an IMAP identity. Successful submission
  returns `accepted`, `remoteEmailId: null` and an opaque deterministic receipt
  derived from the idempotency key. MutationId is never recast as EmailId, and
  the frozen Outbox retains the mutation for reconciliation.
- SMTP failures after DATA may have reached the server are classified as
  `reconcile` / `unknown`, preventing blind resend.

## Consequences

- Protocol selection remains confined to remote composition.
- Coordinator and Outbox require no IMAP/SMTP branch or import.
- Metadata synchronization and body fetch use `BODY.PEEK[]`, so materializing a
  message does not mark it Seen.
- Only `$seen` and `$flagged` map to the acceptance server's flags. Membership
  mutation is a single-mailbox MOVE, not label-style multi-membership.
- MIME parsing and SMTP serialization happen in Rust; HTML remains raw and
  untrusted for the existing rendering boundary.
- Attachment receive support transports metadata only. Bytes, filesystem cache
  and outbound attachments remain out of scope.

## Deferred

- TLS/STARTTLS for non-loopback servers and production credential acquisition.
- IMAP IDLE, CONDSTORE, QRESYNC and incremental synchronization.
- SMTP reconciliation, background scheduling and Persona A composition.
- E2EE encryption/decryption integration and attachment upload/download.
