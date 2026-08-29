# Native Mail Protocols — Independent Verification 01

## Target

- Baseline: `48f10d5e7dd1f589a84a3048f5f1514cf2ead537`.
- Lineage verified: native implementation, Hardening 01, Hardening 02 and Remote
  Boundary hardening are ancestors of the target.
- Verification branch: `verify/native-mail-protocols`.
- Production implementation modified by the verifier: **no**.
- Servidor-Boxplot production modified by the verifier: **no**.

## Independent evidence

The verifier added a test-owned Rust IMAP/SMTP harness and a separate
TypeScript boundary suite. Expected values are test-owned literals; production
normalizers are not used as the oracle.

The adversarial Rust harness verifies:

- loopback-only endpoint policy, exact validated-address reuse, alternate
  `127/8` and supported IPv6 loopback;
- opaque 128-bit session IDs, a 32-session uniqueness sample, Alice/Bob
  credential isolation, failed authentication and close invalidation;
- stale UIDVALIDITY suppression before body, attachment, STORE and MOVE UID
  commands;
- actual UID-set, UIDVALIDITY, UIDNEXT and per-message FLAGS transitions through
  the protocol flow, including equal-count UID replacement and Seen swaps with
  unchanged aggregate UNSEEN;
- one-byte response fragmentation, truncated literals, malformed STATUS and a
  wrong UID in final FLAGS verification;
- test-owned nested MIME, Unicode headers, Reply-To, Cc, text/HTML,
  attachment metadata, stable repeated attachment identity and opaque E2EE
  media type;
- raw SMTP envelope/message privacy, recipient deduplication, deterministic
  Message-ID, sender rejection, exact generated-message size boundary and
  pre-/post-DATA ambiguity classification;
- credential Debug redaction, Zeroizing-owned credential buffers and borrowed
  wire framing without another owned secret command string.

The independent TypeScript suite verifies:

- adversarial IMAP mailbox/Email ID opacity and scoping;
- account-wide mailbox fingerprint retry bounded to two attempts;
- real `Outbox` + `SmtpSubmission` accepted-without-ID and ambiguous outcomes,
  preserving `inFlight` and preventing a second submission;
- frozen command inventories and protocol-neutral architecture imports.

The real Servidor-Boxplot gate runs serially because both scenarios reset the
same documented test server. In addition to the implementation acceptance
scenario, the independent scenario verifies that metadata sync, `fetchBody`
and `fetchAttachments` preserve unread state, explicit Seen/Flagged mutations
round-trip, and MOVE removes the source identity and materializes the
destination identity.

## Regression evidence

- TypeScript typecheck: pass.
- Full Vitest: 843/843 pass.
- Remote Boundary plus independent native verification: 68/68 pass.
- Core JMAP regression: 79/79 pass.
- Independent Rust adversarial protocol suite: 20/20 pass.
- Real Servidor-Boxplot: 2/2 pass.
- Production contracts: 179/179 pass.
- Production smoke: 5/5 pass.
- Persona A initial/reopen integration: pass.
- Rust check, tests and Clippy: pass. Host credential-service tests remain
  environment-dependent and ignored by their existing declarations.
- ESLint: zero errors; 78 pre-existing Vue formatting warnings.
- Prettier: pass.
- Global rustfmt check: the two known pre-existing formatting diffs remain in
  `src-tauri/src/persistence/engine.rs` and
  `src-tauri/tests/persistence_01.rs`; verifier-owned Rust files are formatted.

## Scope and limitations

The native SMTP ambiguity plus persistent SQLCipher restart was not assembled
as one additional test runtime. Independent native Outbox behavior and the
existing generic persistent restart contract both pass, so this is a
test-composition limitation rather than a product or contract finding.

No repository GitHub Actions workflow is present. Verification evidence is
local/manual and is not an independent GitHub CI rerun.

## Verdict

No product, security, consistency, parser, session-isolation, ambiguity-safety
or architecture defect was found. All NV01–NV57 closure gates pass.

`NATIVE_MAIL_PROTOCOLS_FULLY_FROZEN`
