# IPC Contract — IPC-00

## Status and authority

**IPC-00: COMPLETE. Protocol version: `1`.** This document is the normative wire contract between the TypeScript desktop client and the Rust Persistent Local Engine. Domain D-01→D-10 and Ports P-01→P-03 remain the semantic authority; IPC transports their frozen vocabulary without redefining it.

The low-level `LocalEngineIpcClient` is transport infrastructure, not an implementation of `ReadRepository`, `SyncPort`, or `LocalChangeSource`. Those Tauri adapters are the next phase.

## Wire conventions

- JSON object fields are `camelCase`; discriminants are explicit strings.
- Every command receives one named `request` object. No positional payloads exist.
- `IPC_PROTOCOL_VERSION` is `1` in TypeScript and Rust. Desktop halves ship together, so MVP has no negotiation handshake.
- Scoped remote identities are explicit objects such as `{ accountKey, jmapEmailId }`; they are never composite database strings.
- Account, Service, Mutation, JMAP and state-token strings are preserved exactly.
- `null`, `[]`, `""`, custom strings, nullable address lists and `state: ""` retain distinct meanings and are never normalized by IPC.
- Public DTOs are closed structs/discriminated unions. Arbitrary JSON payloads, generic records and raw JMAP DTOs are forbidden.
- Rust performs explicit semantic-model ↔ IPC DTO conversion. Future TypeScript adapters own Domain ↔ IPC DTO conversion and must not cast DTOs into branded Domain values.

## Command inventory

### Reads — 15

| Port capability | IPC command | Rust semantic target | Request |
| --- | --- | --- | --- |
| Read Account | `local_read_account` | `read_account` | `{ accountKey }` |
| List Accounts | `local_list_accounts` | `list_accounts` | `{}` |
| Read Mailbox | `local_read_mailbox` | `read_mailbox` | `{ mailboxId }` |
| List Mailboxes | `local_list_mailboxes` | `list_mailboxes` | `{ accountKey }` |
| Read Identity | `local_read_identity` | `read_identity` | `{ identityId }` |
| List Identities | `local_list_identities` | `list_identities` | `{ accountKey }` |
| Read Email | `local_read_email` | `read_email` | `{ emailId }` |
| Read Emails | `local_read_emails` | `read_emails` | `{ emailIds }` |
| Read Email memberships | `local_read_email_memberships` | `read_email_memberships` | `{ emailId }` |
| Read EmailBody cache | `local_read_email_body` | `read_email_body` | `{ emailId }` |
| Read AttachmentRef cache | `local_read_attachment_refs` | `read_attachment_refs` | `{ emailId }` |
| Read MailboxView cache | `local_read_mailbox_view` | `read_mailbox_view` | `{ spec }` |
| Read collection cursor | `local_read_collection_sync_cursor` | `read_collection_sync_cursor` | `{ accountKey, dataType }` |
| Read PendingMutation | `local_read_pending_mutation` | `read_pending_mutation` | `{ accountKey, mutationId }` |
| List PendingMutations | `local_list_pending_mutations` | `list_pending_mutations` | `{ accountKey }` |

### Writes — 10

| Port capability | IPC command | Rust semantic target | Request |
| --- | --- | --- | --- |
| Register Account | `local_register_account` | `register_account` | `{ account }` |
| Apply collection sync | `local_apply_collection_sync` | `apply_collection_sync` | `{ commit }` |
| Cache EmailBody | `local_cache_email_body` | `cache_email_body` | `{ body }` |
| Replace AttachmentRefs | `local_replace_attachment_refs` | `replace_attachment_refs` | `{ emailId, refs }` |
| Replace MailboxView | `local_replace_mailbox_view` | `replace_mailbox_view` | `{ view }` |
| Stage Send mutation | `local_stage_send_mutation` | `stage_send_mutation` | `{ mutation }` |
| Apply optimistic keywords | `local_apply_optimistic_keyword_mutation` | `apply_optimistic_keyword_mutation` | `{ mutation }` |
| Apply optimistic membership | `local_apply_optimistic_mailbox_membership_mutation` | `apply_optimistic_mailbox_membership_mutation` | `{ mutation }` |
| CAS PendingMutation | `local_replace_pending_mutation_if_current` | `replace_pending_mutation_if_current` | `{ expected, next }` |
| Remove confirmed mutation | `local_remove_confirmed_mutation` | `remove_confirmed_mutation` | `{ accountKey, mutationId }` |

`local_apply_collection_sync` carries the six closed Email/Mailbox/Identity × delta/replace variants and remains one atomic semantic operation. IPC exposes no generic CRUD, SQL, table, cursor-only advance, or split collection write.

## DTO coverage

IPC v1 explicitly represents all values required by P-01/P-02: Account and RemoteAccountRef; Mailbox and rights; Identity; EmailAddress and nullable lists; Email; EmailMailbox; EmailBody; AttachmentRef; MailboxView spec/filter/sort/coverage/items; CollectionSyncCursor and cursor preconditions; SendBody and SendIntent; all three PendingMutation kinds and their kind-correct lifecycle variants; Send confirmation; all scoped IDs; and all six collection commits.

PendingMutation is a complete immutable snapshot. Confirmed Send carries a required confirmation; confirmed keyword/membership updates carry no confirmation payload. There is no `payload: unknown` escape hatch.

## Read states and result envelopes

P-01 presence is discriminated and never inferred from `null` or collection length:

- local entity: `absent | present(value)`;
- owned snapshot: `ownerAbsent | present(value)`;
- owned optional: `ownerAbsent | absent | present(value)`;
- owned cache: `ownerAbsent | notCached | cached(value)`.

Read success is `{ ok: true, value }`; read failure is `{ ok: false, error: { kind } }`, where kind is `unavailable`, `corruptState`, or `unexpected`.

Write success is always `{ ok: true, value: null }`. Write failure uses the same shape with `unavailable`, `corruptState`, `conflict`, or `unexpected`. Expected semantic failures remain inside the envelope. Tauri invocation rejection and malformed impossible responses are internal transport failures for future adapters to map.

## Event bridge

The only event is **`local-state-changed`** with `{ hints }`, where `hints` is non-empty. Variants are: accounts; mailboxes, identities, emails, emailMemberships, and pendingMutations scoped by Account; emailBody and attachmentRefs scoped by Email; mailboxView scoped by exact spec; and syncCursor scoped by Account plus data type.

The event contains invalidation hints only—never Domain state, subject, preview, body, mutation payload, timestamps, sequence or revision.

Ordering is mandatory:

```text
semantic validation + durable transaction
        ↓
successful commit
        ↓
one local-state-changed batch
```

Every successful write, including an idempotent no-op, emits its conservative batch. Conflict or failure emits nothing. Event delivery failure cannot roll back or turn a committed write into failure; consumers recover by rereading P-01 state.

## Write-to-event mapping

| Successful write | Hints in its single batch |
| --- | --- |
| Account registration | accounts |
| Email collection | emails; emailMemberships; Email syncCursor |
| Mailbox collection | mailboxes; Mailbox syncCursor |
| Identity collection | identities; Identity syncCursor |
| EmailBody cache | emailBody |
| AttachmentRef replacement | attachmentRefs |
| MailboxView replacement | mailboxView |
| Send staging | pendingMutations |
| Optimistic keyword change | emails; pendingMutations |
| Optimistic membership change | emailMemberships; pendingMutations |
| Mutation CAS/removal | pendingMutations |

## Rust boundary and concurrency

Tauri manages a process-local handle to the thread-safe `PersistentLocalEngine`. Before Rust bootstrap installs an engine, commands return `unavailable`; no command receives a database path or key. Each handler decodes and validates its DTO, converts it to the Rust semantic model, invokes exactly one Local Engine operation, maps the result and emits post-commit invalidation when applicable.

Handlers contain no SQL and do not duplicate transaction semantics. SQLite connection serialization, transactions and SQLCipher remain owned by the Persistent Local Engine.

## Security boundary

IPC never transports the DEK, SQLCipher key, secure-store handles, JMAP token, raw SQL, filesystem paths or database row IDs. Handlers do not log EmailBody, SendIntent, PendingMutation, addresses, subject or preview. Rust performs no JMAP networking; TypeScript IPC does not expose secrets or persistence internals.

## Verification and drift control

`tests/fixtures/ipc-v1.json` is the shared canonical wire fixture. Rust Serde parity tests and TypeScript fixture/client tests freeze camelCase shapes, scoped IDs, null/empty preservation, lifecycle and commit discriminants, envelopes, events, and command inventory. TypeScript compile-time tests cover the closed unions and non-empty event batch.

Any incompatible wire change requires an explicit protocol-version decision and coordinated Rust/TypeScript update. Adding fields opportunistically or accepting generic JSON is not backward compatibility.

## Non-goals

IPC-00 does not implement Tauri Port adapters, production TypeScript contract conformance, JMAP normalization, Coordinator, Outbox, secure-store provisioning, attachment download, binary cache, UI state, SQL schema design, protocol negotiation, cross-write event coalescing or event replay.
