# PERSIST-01 — SQLite / SQLCipher production persistence

## Status and authority

**PERSIST-01: COMPLETE.** This implementation-specific design derives from the normative [PERSIST-00 contract](persistence-contract.md). It does not change Domain D-01→D-10 or Ports P-01→P-03 and does not define IPC.

## Database lifecycle

`EncryptedDatabase` is the single canonical opener. It accepts a caller-owned 32-byte DEK, applies it before reading `sqlite_master`, verifies `PRAGMA cipher_version`, enables foreign keys, WAL, `synchronous=FULL`, and a bounded busy timeout, then runs migrations. There is no plaintext fallback, hard-coded production key, key logging, or Secure Store implementation in PERSIST-01.

The validated development runtime currently resolves SQLCipher `4.14.0 community` with SQLite `3.51.3`. This is an environment variance from the packaging target SQLCipher `4.17.0`; it does not rewrite that target and remains a packaging/provisioning gate.

Schema version is held in `PRAGMA user_version`. Known versions migrate deterministically; future versions fail. `0001` remains immutable. Migration `0002` rebuilds the early cache schema because `0001` cannot supply `AccountKey`, `ServiceKey`, complete Domain metadata, cache presence, or typed mutations without inventing meaning. The rebuild is allowed only when legacy `pending_mutations` is empty. A non-empty legacy outbox stops migration explicitly so unsent intent is never silently discarded.

## Physical model

| Logical concept | Physical representation | Semantic key | Owner / integrity |
| --- | --- | --- | --- |
| Account | `accounts` | `account_key` | exact `service_key + jmap_account_id`; no global binding uniqueness |
| Mailbox | `mailboxes` | `account_key + jmap_id` | Account FK; parent scoped by the row Account but not required to be materialized; counts, role and six rights preserved |
| Identity | `identities` | `account_key + jmap_id` | Account FK; nullable address-list codecs |
| Email | `emails` | `account_key + jmap_id` | Account FK; complete D-02 projection |
| EmailMailbox | `email_mailboxes` | `account_key + email_jmap_id + mailbox_jmap_id` | Email owner FK only; deliberately no Mailbox FK so remote membership may name a nonmaterialized Mailbox |
| EmailBody | `email_bodies` | `account_key + email_jmap_id` | Email FK; absent row is `notCached`, present row includes valid null/null |
| Attachment cache | `attachment_caches` + `attachment_refs` | cache owner; ref key adds `part_id` | marker distinguishes `notCached` from cached empty; Email FK; repeated Blob IDs allowed |
| MailboxView | `mailbox_views`, `mailbox_view_coverage`, `mailbox_view_items` | exact Account/Mailbox/filter/sort spec | Mailbox FK; query state, ordered coverage and positions lossless |
| Collection cursor | `sync_cursors` | `account_key + data_type` | Account FK; empty state is valid |
| PendingMutation | `pending_mutations` | `account_key + mutation_id` | Account FK; explicit kind and mutually exclusive typed payload columns |

Physical row IDs are not used. Every table uses the frozen semantic key directly, preserving multi-account collisions. Numeric and boolean checks encode stable storage invariants; Domain-equivalent rehydration validation remains authoritative for richer invariants. Mailbox hierarchy acyclicity is validated transactionally.

## Structured codecs

JSON `TEXT` is limited to structured leaf values whose ordering/null semantics must survive:

- the six inbound Email address lists and Identity `replyTo`/`bcc`;
- Email `KeywordSet`, encoded as a typed set rather than JMAP `String[Boolean]`;
- SendIntent, KeywordChange, and MailboxMembershipChange in mutually exclusive mutation payload columns;
- PendingMutation lifecycle.

Codecs use typed Serde values with unknown-field rejection for payload structures. `null`, empty lists, empty strings, custom keyword spelling, and list order remain distinct. Entities, identity, cache materialization, views, and memberships are not hidden in opaque entity blobs. Decode or invariant failure is corrupt durable state.

## Transaction boundaries

Each semantic write opens one SQLite transaction. Collection sync validates the exact cursor precondition, applies the Email/Mailbox/Identity delta or replacement, and advances the cursor only in the same commit. Replacements upsert surviving owners and delete only omitted ones, preserving independent caches. Email collection writes never touch MailboxView tables.

Body, attachment, and View replacement verify their owner and replace one complete cache snapshot. Attachment replacement writes its materialization marker even for `[]`.

Send staging writes only the exact SendMutation. Keyword and membership optimistic operations update the projection and insert the exact mutation in one transaction. Mutation replacement uses an immediate transaction, compares the complete current durable snapshot, preserves immutable content, validates the lifecycle edge, then replaces it. Confirmed removal verifies confirmation in the same transaction.

## Reads and presence

The Rust internal API implements the fifteen P-01-equivalent reads without exposing SQL rows. Owner absence, entity absence, optional absence, and cache `notCached` are distinct enums. `read_emails` is positional and preserves duplicates. Collections have no semantic order. View lookup uses the exact spec, and cursor state is opaque—including `""`.

## Security and corruption boundary

Raw EmailBody HTML is persisted unchanged and remains untrusted; rendering sanitization is outside persistence. The engine contains no Vue, Pinia, JMAP, HTTP, filesystem attachment, or Tauri command surface. Test-only SQL corruption injection is not public API. SQL/codec failures do not produce partial Domain snapshots.

## Deliberately deferred

IPC-00, Tauri TypeScript adapters, Secure Store/bootstrap integration, JMAP normalization, notification publication after commit, backup/reset UX, attachment downloads, and running the 179 portable TypeScript contracts against Rust remain later work. Native PERSIST-01 tests prove the durable engine itself; they do not claim cross-IPC conformance.
