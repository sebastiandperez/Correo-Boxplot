# ADR-013 — Gmail OAuth provider

## Status

Accepted for the Gmail dogfood provider only.

## Decision

Correo Boxplot adds an additive `gmail` remote provider. It authenticates a
user-selected Google account through native desktop OAuth 2.0 (system browser,
loopback redirect, PKCE S256) and opens Gmail through TLS IMAP/SMTP with
XOAUTH2. Refresh tokens are held in the platform credential store; access
tokens, authorization codes, PKCE verifiers and XOAUTH2 payloads remain native
memory-only and never cross IPC into TypeScript.

Gmail service identity is the deterministic, non-secret `gmail:imap-smtp:v1`.
Gmail continues to use the existing IMAP account-id encoding based on the
user-supplied Google address. Gmail mail synchronization is metadata-only,
limited to the highest 100 UIDs in Inbox, Sent and Trash. Full bodies remain an
on-demand operation through the existing body materializer.

## Authorized additive extensions

1. `RemoteProvider += gmail` and a Gmail connection-config variant.
2. Gmail OAuth and Gmail session-open native IPC commands.
3. TLS mail transport and XOAUTH2 authentication for Gmail only.
4. Optional IMAP Special-Use metadata on native mailbox DTOs.
5. Bounded metadata-only Gmail IMAP synchronization policy.

## Frozen boundaries

This decision does not alter Domain models or Account semantics; P-01, P-02,
P-03; SQLCipher; the public RemoteApplication, RemoteMail or Submission APIs;
Coordinator; BodyMaterializer; MutationRunner and reconciliation contracts;
E2EE; SendSecurityMode; local-first authority; or MessageViewer security.

No Gmail REST mail API, OAuth secret in the client, password fallback, TLS
bypass, label-domain extension, push/IDLE, or direct remote-to-Pinia path is
introduced.
