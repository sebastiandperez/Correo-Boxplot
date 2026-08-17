# Persistence Contract — PERSIST-00

## 1. Status, scope, and authority

**PERSIST-00: COMPLETE.** This document is the normative, implementation-neutral contract for durable local state behind `ReadRepository` P-01 and `SyncPort` P-02. It governs PERSIST-01 design and implementation.

Domain D-01→D-10 and Ports P-01→P-03 remain authoritative. Persistence MUST preserve their vocabulary, identities, presence states, invariants, and atomic effects. Memory is a conformant development/integration adapter, but it is not the source of persistence semantics.

`LocalChangeSource` P-03 is not durable persistence. Its notifications invalidate reads after a commit; they are not a replay log, state transport, or durability mechanism.

## 2. Non-goals

PERSIST-00 does not choose or define:

- SQL tables, columns, indexes, foreign keys, query plans, or physical cascade policy;
- SQLite PRAGMAs, WAL mode, connection ownership, or pooling;
- SQLCipher configuration or key-management APIs;
- Rust traits, crate APIs, `rusqlite` queries, or error structs;
- Tauri commands, IPC DTOs, serialization formats, or event names;
- JMAP DTOs or normalization algorithms;
- performance budgets, tuning, backup, or remote synchronization services.

## 3. Logical durable state

Production persistence MUST represent the following logical state without semantic loss:

| Concept | Semantic identity | Owner | Durable payload source | Presence semantics |
| --- | --- | --- | --- | --- |
| Account | `AccountKey` | none | frozen `Account` | absent or present |
| Mailbox | `ScopedMailboxId` | Account | frozen `Mailbox` | owner absent, entity absent, or present |
| Identity | `ScopedIdentityId` | Account | frozen `Identity` | owner absent, entity absent, or present |
| Email | `ScopedEmailId` | Account | frozen `Email` | absent or present |
| EmailMailbox | `ScopedEmailId + ScopedMailboxId` | Email | frozen `EmailMailbox` | owner absent or complete present snapshot, including empty |
| EmailBody cache | `ScopedEmailId` | Email | frozen `EmailBody` | owner absent, not cached, or complete cached value |
| AttachmentRef cache | `ScopedEmailId + AttachmentPartId` per item | Email | frozen `AttachmentRef` collection | owner absent, not cached, or complete cached snapshot, including empty |
| MailboxView cache | exact semantic `MailboxViewSpec` | Mailbox | frozen `MailboxView` | owner absent, not cached, or complete cached value |
| CollectionSyncCursor | `AccountKey + CollectionDataType` | Account | frozen `CollectionSyncCursor` | owner absent, no checkpoint, or present checkpoint |
| PendingMutation | `AccountKey + MutationId` | Account | complete frozen D-08 union | owner absent, absent, or present |

Remote textual JMAP IDs are scoped values and MUST NOT be assumed globally unique. SQLite row IDs or other physical surrogates, if used later, MUST remain persistence details and MUST NOT replace these semantic identities at Port boundaries.

## 4. Ownership and visibility

The observable ownership model is:

- Account owns Mailboxes, Identities, collection cursors, and PendingMutations.
- Email owns its EmailMailbox snapshot, EmailBody cache, and AttachmentRef cache.
- Mailbox owns each MailboxView cache selected by exact semantic spec.

Owner absence MUST control P-01 visibility. When an Email is absent, its memberships, body, and attachment reads return `ownerAbsent`; when a Mailbox is absent, its View read returns `ownerAbsent`; when an Account is absent, its owned collection and operational reads return `ownerAbsent` as specified by P-01.

PERSIST-00 does not require physical cleanup of inaccessible dependent records. An implementation MAY delete them or retain them invisibly. It MUST NOT invent owner-destruction/recreation resurrection behavior beyond current Port semantics.

## 5. Presence and cache materialization

Persistence MUST encode presence explicitly rather than infer it from payload truthiness or collection length.

For EmailBody it MUST distinguish:

1. Email absent;
2. Email present and body `notCached`;
3. Email present and cached `{ text: null, html: null }`;
4. Email present and cached empty-string representations.

For AttachmentRefs it MUST distinguish `notCached` from `cached []`. For MailboxView it MUST distinguish no cache from a cached View. A cache-presence marker may have any future physical representation, but the observable distinction is mandatory.

Cursor presence likewise MUST distinguish no checkpoint from a present cursor whose opaque state is `""`. State tokens MUST NOT be interpreted through truthiness, ordering, or monotonic comparison.

## 6. Lossless representation and rehydration

Persistence MUST preserve every field required to reconstruct frozen Domain values through their factories and invariants. It MUST preserve, among other distinctions:

- `null` versus `""`;
- nullable address lists versus empty lists;
- custom Keyword strings exactly;
- open Mailbox roles versus `null`;
- attachment `name`, `disposition`, and `cid` null versus empty;
- MailboxView sort direction, coverage boundaries, positions, total, and opaque `queryState`;
- complete PendingMutation kind, target, payload, lifecycle, attempt count, retry instant, and confirmation where applicable;
- raw, untrusted canonical EmailBody HTML rather than a sanitized rendering copy.

Persisted representations MUST be rehydrated through Domain factories or equivalent invariant validation. Unsafe casts are not rehydration. If committed persisted data cannot form the required Domain value or violates semantic uniqueness/integrity, the Local Engine MUST surface `corruptState` according to existing Port semantics; it MUST NOT return a partial collection success.

## 7. Semantic uniqueness and integrity

The production implementation MUST enforce or transactionally validate:

- one logical entity per semantic identity;
- no duplicate EmailMailbox identity in one Email snapshot;
- no duplicate AttachmentRef identity (`ScopedEmailId + AttachmentPartId`) in one cache snapshot;
- one collection cursor per `AccountKey + CollectionDataType`;
- one PendingMutation per `AccountKey + MutationId`, across mutation kinds;
- one MailboxView per exact semantic `MailboxViewSpec`;
- all same-account and owner preconditions frozen by Domain and P-02.

The physical enforcement mechanism remains deferred.

## 8. Read consistency

Each `ReadRepository` call MUST observe one committed persistence state. It MUST NOT expose any subset of a P-02 transaction while another subset remains uncommitted.

`readEmails` MUST preserve input length, order, duplicates, and per-position absence. Collection reads retain their existing absence and ordering semantics. Separate P-01 calls do not share a guaranteed snapshot and MAY observe different committed transactions.

## 9. Normative transaction matrix

Successful `SyncPort` resolution in production means the complete listed durable effect has committed. Every failed precondition or storage failure before commit leaves the prior committed semantic state intact.

| SyncPort operation | Required single atomic durable effect | Required precondition/result semantics |
| --- | --- | --- |
| `registerAccount` | Account registration and RemoteAccountRef binding | Same binding MAY succeed idempotently; different binding conflicts with no change. |
| `applyCollectionSync` — Email | Email delta/replacement, complete memberships for changed/snapshot Emails, destruction semantics, and next Email cursor | Account and exact cursor precondition required; surviving EmailBody/AttachmentRef caches remain intact; MailboxViews are not rewritten. |
| `applyCollectionSync` — Mailbox | Mailbox delta/replacement and next Mailbox cursor | Account, kind/scope, uniqueness, disjointness, and exact cursor precondition required. |
| `applyCollectionSync` — Identity | Identity delta/replacement and next Identity cursor | Account, kind/scope, uniqueness, disjointness, and exact cursor precondition required. |
| `cacheEmailBody` | Cache-presence materialization and complete EmailBody payload | Email owner must exist at commit. |
| `replaceAttachmentRefs` | Cache-presence materialization and complete AttachmentRef snapshot, including empty | Email owner, exact ownership, scope, and unique ref identities required. |
| `replaceMailboxView` | Exact complete MailboxView snapshot for its semantic spec | Mailbox owner must exist at commit; `queryState` is opaque. |
| `stageSendMutation` | Exact SendMutation only | Account exists and MutationId is unused; no fake Email or optimistic membership/View effect. |
| `applyOptimisticKeywordMutation` | Updated Email KeywordSet and exact PendingMutation | Account and Email exist; MutationId unused; both effects commit or neither. |
| `applyOptimisticMailboxMembershipMutation` | Updated canonical EmailMailbox snapshot and exact PendingMutation | Account, Email, and referenced Mailboxes exist; MutationId unused; final membership remains non-empty. |
| `replacePendingMutationIfCurrent` | Atomic full-snapshot comparison and valid lifecycle replacement | Mismatch or invalid transition conflicts with zero modification. |
| `removeConfirmedMutation` | Verify current lifecycle is confirmed and remove the exact mutation | Missing or non-confirmed mutation conflicts with zero modification. |

The interface has ten methods; `applyCollectionSync` is shown by its three discriminated collection branches because each branch has a distinct durable atomic set.

## 10. Collection delta and replacement

Collection `replace` is logical materialization replacement for one Account and data type. Omitted previously materialized entities become absent.

For Email replacement, the complete membership snapshot accompanies every supplied Email. A surviving identical `ScopedEmailId` MUST retain its independent EmailBody and AttachmentRef caches. An implementation MUST NOT blindly delete and recreate all owner-dependent state if doing so loses those caches.

Delta requires the exact expected cursor. Changed/destroyed scope, uniqueness, disjointness, and Email membership ownership remain P-02 preconditions. Destroying an already absent entity is idempotent, and a valid empty or destroy-absent delta MAY still advance its cursor.

## 11. Optimistic atomicity

After a successful optimistic operation, persistence MUST never expose either of these states:

- optimistic projection changed but PendingMutation absent;
- PendingMutation present but its required optimistic projection unchanged.

Projection and mutation commit together or neither commits. No automatic mutation coalescing is implied.

## 12. PendingMutation durability and CAS

Persistence MUST represent the complete discriminated D-08 union.

- Send persists the immutable SendIntent snapshot.
- Keyword persists target Email and exact add/remove KeywordSets.
- Mailbox membership persists target Email and exact add/remove Mailbox identity collections.
- Every kind persists AccountKey, MutationId, createdAt, status, attempt count, and kind-specific lifecycle fields such as nextAttemptAt or Send confirmation.

`replacePendingMutationIfCurrent` MUST compare the complete current durable snapshot, including kind, target, immutable payload, and lifecycle—not only MutationId or MutationId plus status. The replacement MUST preserve immutable semantic content and perform only a valid D-08 lifecycle transition.

Conflicting semantic writes MUST be serialized or receive equivalent transactional isolation. Of two CAS attempts based on the same current snapshot, at most one may commit.

Only a currently confirmed mutation may be removed. An `inFlight` mutation is durable across process restart and MUST NOT be reset automatically to pending; reconciliation policy belongs to Outbox.

## 13. Durability, crash, and notifications

For production persistence:

```text
validate and transact
        ↓
durable commit
        ↓
LocalChangeSource invalidation
```

A process failure after successful durable commit MUST NOT revert that commit. A failure before commit MUST NOT expose a partial transaction. Exact SQLite durability configuration is deferred to PERSIST-01.

P-03 notifications remain non-durable. If the process fails after commit but before notification, the commit remains authoritative. Restart recovery is `subscribe → ReadRepository read`, not replay of old notifications.

## 14. Error mapping

Future persistence MUST map failures to existing Port categories only:

| Condition | Port error |
| --- | --- |
| Semantic command or precondition mismatch | `conflict` |
| Committed persisted state violates Domain or integrity | `corruptState` |
| Storage cannot provide service | `unavailable` |
| Unexpected unclassified infrastructure failure | `unexpected` |

No failure before commit may leave a partial durable effect visible through P-01.

## 15. Migration and versioning requirements

Production persistence MUST have an explicit schema/data version and deterministic migrations. It MUST reject or explicitly migrate unknown layouts rather than silently reinterpret them. Migration application MUST avoid an observable half-migrated canonical state.

There MUST be no plaintext or destructive fallback. Reset is an authorized external lifecycle operation to be designed separately; PERSIST-00 adds no reset/delete Port API but MUST not make a future explicit cache reset impossible.

## 16. Security boundary

Canonical production local persistence MUST be encrypted at rest. PERSIST-00 does not design SQLCipher integration, DEK generation, or secure-store access. It forbids requiring a plaintext canonical database or fallback. DEK ownership and secure-store handling remain governed by the security architecture.

Persisted EmailBody HTML remains raw and untrusted. Presentation sanitizes on every render; persistence MUST NOT replace the canonical raw body with sanitized HTML as a second authority.

## 17. Prohibited designs

The following designs violate PERSIST-00:

1. committing Email changes separately from their cursor;
2. committing an optimistic projection separately from PendingMutation;
3. CAS implemented as an unlocked read followed by write without equivalent atomic protection;
4. testing cursor state through truthiness;
5. inferring attachment-cache materialization from array length;
6. inferring EmailBody-cache materialization from body contents;
7. assuming global uniqueness for JMAP IDs;
8. blind Email replace that loses surviving lazy caches;
9. persisting sanitized HTML instead of canonical raw cached HTML;
10. reconstructing Domain through unsafe casts instead of validation/factories;
11. requiring a durable P-03 event log.

## 18. Deferred implementation decisions

PERSIST-01 review will decide, without reopening this contract:

- SQLite table layout, normalization/denormalization, indexes, and foreign keys;
- physical cascade and cleanup policy;
- WAL, PRAGMAs, durability settings, and connection model;
- SQLCipher setup and lifecycle integration;
- Rust trait shape and `rusqlite` implementation;
- physical encodings/codecs and migration details;
- IPC DTOs and Tauri command design;
- performance budgets and query tuning.

## 19. PERSIST-00 acceptance matrix

- [ ] All P-01 durable reads are representable.
- [ ] All P-02 transaction effects are representable.
- [ ] Owner semantics are representable.
- [ ] Cache presence is representable independently from payload values.
- [ ] A present cursor with empty state is representable.
- [ ] The complete PendingMutation union is representable.
- [ ] Full durable-snapshot CAS is feasible.
- [ ] Surviving Email lazy caches are preserved.
- [ ] Conflict leaves zero partial durable change.
- [ ] Invalid persisted state can surface `corruptState`.
- [ ] Notification occurs only after durable commit.
- [ ] No global JMAP ID assumption exists.
- [ ] No plaintext canonical-store requirement exists.
- [ ] No implementation-specific SQL decision is frozen.

These items are acceptance obligations for PERSIST-01; they are not claims that production persistence already exists.
