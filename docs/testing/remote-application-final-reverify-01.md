# REMOTE-APPLICATION-REVERIFY-AND-FREEZE-01 — Phase A evidence

## Result

`PHASE_A_PASS` — the repair at
`fc048f361119b7e978963e15aaadc0e42f4d5695` survived independent
falsification on integrated baseline
`5e57acc5463977db559e85825e30320207a38c03`.

Unresolved product/security/session P0: **0**. Unresolved P1: **0**.
Production files modified by this verifier: **0**.

This record does not perform or declare the Phase B freeze. ADR-010, Persona C
planning, and the roadmap remain untouched for the integrating verifier.

## Independence and primary evidence

The new deterministic primary harness is:

```text
src/app/remote/__tests__/remote-application-final-reverify.test.ts
```

It does not import the repair test, the old independent harness, or any helper
from either. Its gates, sessions, factories, mail fakes, requests, counters,
and expected observations are independently constructed. It exercises public
`DefaultRemoteApplication` behavior and productive
`createTauriRemoteApplication` composition.

Focused result:

```text
18/18 PASS
```

The harness proves all three authority timings through observable effects:

| Authority loss | Factory | Open | Register | Result | Cleanup |
| --- | ---: | ---: | ---: | --- | --- |
| authenticating listener → disconnect | 0 | 0 | 0 | cancelled | anonymous/offline/null |
| authenticating listener → dispose | 0 | 0 | 0 | cancelled | disposed |
| factory → disconnect | 1 | 0 | 0 | cancelled | anonymous/offline/null |
| factory → dispose | 1 | 0 | 0 | cancelled | disposed |
| disconnect after open starts | 1 | 1 | 0 | cancelled | late session closed once |
| dispose after open starts | 1 | 1 | 0 | cancelled | late session closed once |

Both authenticating-listener cancellation and factory-time cancellation permit
a later fresh connect; no `pendingConnects` generation leaks.

The same harness independently covers disconnect during registration,
refresh/disconnect, concurrent refresh/expiry, observer exception isolation,
synchronous subscription mutation, A/B isolation, authenticated-listener
disconnect, keep/expire matrices, close failure, best-effort disposal, the
fresh credential canary, productive native composition, and a real Coordinator
vertical.

## RA-VF-001

Observed status sequence for reentrant disconnect:

```text
anonymous/offline/null
→ authenticating/offline/null
→ anonymous/offline/null
```

Observed counters and result:

```text
factory: 0
open: 0
registerAccount: 0
connect: cancelled
active session: none (refresh returns notConnected)
```

Reentrant dispose likewise produced `0/0/0`, `cancelled`, and the frozen
disposed behavior for subsequent `connect`, `disconnect`, `refreshAccount`,
and `subscribe` calls.

The source order in `DefaultRemoteApplication.connect` is:

```text
reserve generation + pendingConnect
try
publish authenticating
assertConnectAuthority
connectionFactory
assertConnectAuthority
connection.open
assertConnectAuthority
resolve binding
assertConnectAuthority
activate
finally delete pendingConnect only when generation still matches
```

No `AbortController`, cancellation map, credential/config cache, provider
branch, or second lifecycle authority was introduced. Generation plus the
generation-owned `pendingConnects` entry remains the authority model.

## Old verifier classification

Before its expectation was realigned, the old independent reentrant verifier
failed `2/2`: it positively expected `factory` and `open` after synchronous
disconnect/dispose. Actual output contained only the listener events, proving
that the repair prevents both effects.

```text
ID: RA-RV-TEST-001
severity: P2
classification: TEST_ASSUMPTION_ERROR
scenario: historical RA-VF-001 reproducer run after the repair
expected by stale test: factory and open occur
actual: factory = 0; open = 0
implication: the product repair is effective; the historical positive-defect
             assertion is no longer a valid regression oracle
action: preserve the independently built new oracle and invert only the two
        stale lifecycle expectations
```

After this test-only correction, the old independent verifier passes `56/56`.
The historical report in `docs/testing/remote-application-verify-01.md` remains
unchanged as evidence of the original finding.

## Credential safety

Fresh canary:

```text
BOXPL0T_RA_FINAL_FREEZE_SECRET_52917
```

The canary was exercised through successful connect, authenticating-listener
cancellation, factory-time cancellation, authentication error, network error,
and productive IMAP/SMTP composition. It was absent from results, typed errors,
statuses, subscription observations, application JSON serialization, and the
verifier's captured observations. Source inspection confirms that
`RemoteConnectionConfig` is passed directly to the factory and is not stored by
RemoteApplication.

## Real Coordinator vertical

The new harness composes:

```text
DefaultRemoteApplication
→ real Coordinator
→ real MemoryLocalEngine
→ verifier-owned RemoteMail
```

One explicit refresh commits and verifies through `ReadRepository`:

```text
identities: 2
mailboxes: 2
emails: 2
memberships: 3
mailbox views: 2
collection cursors: 3
remote data returned by RemoteApplication: no (refresh resolves void)
```

This preserves SQLite/Local Engine as the only source read by Application.

## Architecture and frozen lower layers

The four core files import no Vue, Pinia, stores, concrete JMAP/IMAP/SMTP/native
implementation, Tauri, `invoke`, `fetch`, or WebSocket. The public interface
contains exactly:

```text
connect
disconnect
refreshAccount
getStatus
subscribe
dispose
```

The repair commit changes only
`src/app/remote/remote-application.ts` and its repair test. Diffs from the
RemoteApplication implementation through integrated HEAD contain no changes in
Domain, Ports, Coordinator, Outbox, Remote Boundary, Native Mail, SQLCipher,
E2EE, `JmapWorkerClient`, or `jmap-worker`. The already accepted remote-ID
compatibility helper is unchanged by the repair.

The production handler inventory remains 25 local IPC commands plus 9 native
mail commands. There is no RemoteApplication-specific command.

## Hard gate matrix

```text
RF01 PASS  RF02 PASS  RF03 PASS  RF04 PASS  RF05 PASS
RF06 PASS  RF07 PASS  RF08 PASS  RF09 PASS  RF10 PASS
RF11 PASS  RF12 PASS  RF13 PASS  RF14 PASS  RF15 PASS
RF16 PASS  RF17 PASS  RF18 PASS  RF19 PASS  RF20 PASS
RF21 PASS  RF22 PASS  RF23 PASS  RF24 PASS  RF25 PASS
RF26 PASS  RF27 PASS  RF28 PASS  RF29 PASS  RF30 PASS
RF31 PASS  RF32 PASS  RF33 PASS  RF34 PASS  RF35 PASS
RF36 PASS  RF37 PASS  RF38 PASS  RF39 PASS  RF40 PASS
RF41 PASS  RF42 PASS  RF43 PASS  RF44 PASS  RF45 PASS
RF46 PASS  RF47 PASS  RF48 PASS  RF49 PASS  RF50 PASS
RF51 PASS  RF52 PASS  RF53 PASS  RF54 PASS  RF55 PASS
RF56 PASS  RF57 PASS  RF58 PASS  RF59 PASS  RF60 PASS
RF61 PASS  RF62 PASS  RF63 PASS  RF64 PASS  RF65 PASS
RF66 PASS  RF67 PASS  RF68 PASS  RF69 PASS  RF70 PASS
```

Evidence mapping:

- RF04–RF29: new harness plus the implementation, repair, and independent
  lifecycle/model suites.
- RF30–RF32: fresh canary harness, complete binding matrix, conflict/reread
  cases, and source retention audit.
- RF33–RF45: new real Coordinator vertical, keep/expire and composition tests,
  plus existing full application regression.
- RF46–RF61: source/import/API/diff/IPC inventory audits.
- RF62–RF70: focused boundary/native/parser/JMAP suites, full TypeScript and
  Rust regressions, production conformance/smoke, and Persona A initial/reopen.

## Commands and actual results

```text
new independent reverify:                 18/18 PASS
old independent verifier:                 56/56 PASS
repair tests:                             10/10 PASS
RemoteApplication implementation:         39/39 PASS
RemoteApplication directory aggregate:   131/131 PASS
Remote Boundary focused:                  70/70 PASS
Native Mail TypeScript focused:           36/36 PASS
Native Mail Rust adversarial:             27/27 PASS
native parser independent reverify:       12/12 PASS
JMAP focused:                            101/101 PASS
full Vitest:                             974/974 PASS
vue-tsc --noEmit:                         PASS
full cargo test:                         137 passed, 0 failed, 4 ignored
real native server:                         2/2 PASS
production conformance:                  179/179 PASS
production smoke:                           5/5 PASS
Persona A initial/reopen:                 PASS/PASS
ESLint:                                   PASS (0 errors; 78 existing warnings)
Prettier:                                 PASS
git diff --check:                         PASS
pnpm check:                               reaches 974/974, then FAILS on
                                          pre-existing rustfmt debt below
```

The aggregate/full Vitest counts above include the 18-case final reverify.

## Pre-existing and environment-only debt

```text
ID: RA-RV-DEBT-001
severity: P2
classification: PRE_EXISTING_UNRELATED
actual: cargo clippy -D warnings fails at
        src/security/linux_dek_codec.rs (Rust 1.98
        chunks_exact_to_as_chunks)
```

```text
ID: RA-RV-DEBT-002
severity: P2
classification: PRE_EXISTING_UNRELATED
actual: cargo fmt --check reports existing formatting debt in
        src-tauri/src/persistence/engine.rs and
        src-tauri/tests/persistence_01.rs
```

```text
ID: RA-RV-ENV-001
severity: P2
classification: ENVIRONMENT_ONLY
actual: sandboxed pnpm run commands report "unable to open database file";
        repository-installed binaries and approved unsandboxed production
        runners execute successfully
```

```text
ID: RA-RV-ENV-002
severity: P2
classification: ENVIRONMENT_ONLY
actual: host Node v26.8.1 differs from pinned v24.19.0; the exercised checks
        and production runners pass, with the expected engine warning
```

The first sandboxed native-mail run also could not bind loopback sockets; the
same locked command outside the sandbox passed `27/27`, and the independent
parser passed `12/12`.

## Phase A conclusion

The final invariant is independently proven:

```text
A connect generation that has already lost lifecycle authority does not
initiate a new remote operation afterward.
```

Phase A has no unresolved P0/P1 and is eligible for the integrating verifier's
strictly subsequent Phase B documentation freeze.

## Phase B freeze

Phase B completed after the Phase A evidence commit remained green.

```text
RemoteApplication core: FULLY FROZEN
unresolved P0: 0
unresolved P1: 0
production files modified by verifier: 0
```

ADR-010, Persona C planning, and the executable roadmap now record the freeze.
The public API, exact account binding, generation authority, status,
subscriptions, keep/expire behavior, disposal, and protocol-neutral core are
read-only architecture for subsequent normal work.

This freeze does not implement body materialization, Outbox execution, SMTP
reconciliation, Alice/Bob acceptance, or JMAP Worker migration.
