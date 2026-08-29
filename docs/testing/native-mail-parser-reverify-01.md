# Native Mail Parser — Independent Reverification 01

## Target and independence

- Integrated production baseline: `8009092b76e74b42ccac36715774efbc6900172c`.
- Parser repair: `d1db01dbd704e97e4d2b71ff865bcbd3492e45f9`.
- Original independent verifier: `5c930e97da4582dddfcb730b525303cb5f93e0d4`.
- Production modified by this reverification: **no**.
- Servidor-Boxplot production modified by this reverification: **no**.

The independent suite uses a new test-owned TCP actor and exercises only the
public `ManagedNativeMailRuntime` API. It does not reuse the repair suite's
`ImapPeer` or production parser helpers as an oracle.

## Adversarial evidence

The new harness passes 12/12 test functions covering 36 wire scenarios:

- full-FETCH UID mismatch, absence, malformed/overflow values, sequence-number
  independence and duplicate literal-bearing results;
- the exact 65,536-byte line boundary, 65,537-byte rejection, unterminated
  overflow and byte-at-a-time fragmentation;
- the exact 2,097,152-byte literal boundary, max+1 rejection before payload,
  numeric overflow, malformed markers and cumulative literal accounting;
- response line-count and cumulative-text budgets;
- session invalidation after parser aborts;
- malformed tagged status while preserving normal `NO`/`BAD` rejection;
- malformed greetings, missing UIDVALIDITY, truncated literals and invalid
  literal trailers;
- exact FLAGS and UID-set snapshot consistency plus ambiguous STORE
  `reconcile`/`unknown` behavior.

Static inspection independently confirms bounded `fill_buf`/`consume` line
acquisition, checked response accounting before allocation, and mandatory UID
validation before fetched content can be exposed under the requested identity.

## Regression evidence

- Repair parser scenarios: 7/7 pass.
- Full native adversarial suite: 27/27 pass.
- Real Servidor-Boxplot: 2/2 pass, including unread-preserving `BODY.PEEK[]`.
- Remote Boundary verification: 68/68 pass.
- JMAP: 79/79 pass.
- Full Vitest: 843/843 pass; TypeScript typecheck passes.
- Rust: 137 pass, four declared environment/real-server ignores; the real
  server tests pass separately.
- Production contracts: 179/179 pass; production smoke: 5/5 pass.
- Persona A initial/reopen integration: pass.

The known Rust 1.98 Clippy lint in `linux_dek_codec.rs` and the known rustfmt
debt in two persistence files remain unrelated. With only that Clippy lint
suppressed, all targets pass; verifier-owned files pass rustfmt and the full
repository passes Prettier.

## Verdict

All PV01–PV40 gates pass. No P0 or P1 finding remains. Native Mail Protocols
are fully frozen, and `REMOTE-APPLICATION-01` is unblocked.
