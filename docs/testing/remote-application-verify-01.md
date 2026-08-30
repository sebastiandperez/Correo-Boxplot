# REMOTE-APPLICATION-VERIFY-01 — independent evidence

## Result

`PARTIAL` — selected lifecycle, binding, error, persistence, isolation,
subscription, disposal and productive-composition claims were independently
verified. Acceptance is blocked by the P1 finding below.

Recommendation:

```text
REMOTE_APPLICATION_REPAIR_REQUIRED
```

## Baseline and independence

- Starting `HEAD` and `origin/main`:
  `1daf035124abd742516a9964ca13fe9216a01a8e`.
- `2fccd0686d6c6e1ac35bf48a1a46829de77e8b84` and
  `31a88a88b6b61b9efb818feaee17053248ca835c` are ancestors of the baseline.
- Production files modified by this verifier: zero.
- The harness was written independently. The verifier did not open, import or
  reuse helpers from
  `src/app/remote/__tests__/remote-application.test.ts`.

## Finding RA-VF-001

```text
severity: P1
classification: SESSION_LIFECYCLE_DEFECT
production function: DefaultRemoteApplication.connect
recommendation: REMOTE_APPLICATION_REPAIR_REQUIRED
```

Scenario A:

```text
connect(A)
→ status listener observes authenticating
→ listener calls disconnect(A), synchronously removing connect authority
→ connectionFactory executes
→ RemoteConnection.open executes
→ late session is closed
→ connect rejects cancelled
```

Scenario B is identical except the listener calls `dispose()` and the
application is already disposed before `connectionFactory` and `open` execute.

Expected: once synchronous listener reentrancy has removed lifecycle authority,
the cancelled operation must not initiate a new remote authentication side
effect.

Actual: `connect()` publishes `authenticating`, then proceeds directly to the
factory and `open()`. Its first authority check occurs only after `open()`
resolves. Final status and cleanup are safe, but authentication was started
after cancellation/disposal. This is the explicit V22/V23 P1 condition.

Deterministic reproducer:

```text
src/app/remote/__tests__/remote-application-reentrant-independent.verify.test.ts
```

## Independent evidence executed

Focused independent suite: `56/56` passing across three test files.

- Deterministic verifier: binding matrices, opaque account IDs, concurrent
  registration, local/open error matrices, credential public surfaces,
  keep/expire semantics, real Coordinator + real MemoryLocalEngine vertical,
  multi-account isolation, subscriptions, disconnect/dispose races and
  productive composition.
- Model verifier: deterministic seeded two-account model, 80 operations, state
  comparison after every operation.
- Reentrant verifier: two minimal P1 reproducers for disconnect and dispose
  listeners.

Verification commands used the repository-installed binaries because `pnpm
exec` failed in this environment before Vitest with `unable to open database
file`:

```text
./node_modules/.bin/vitest run <three independent verifier files>
./node_modules/.bin/vue-tsc --noEmit
./node_modules/.bin/eslint <independent verifier files>
./node_modules/.bin/prettier --check <independent verifier files and this report>
git diff --check
```

The focused suite, typecheck, ESLint and test-file formatting passed before this
report was added. The final validation results are recorded in the verifier handoff.

## Scope note

This evidence does not claim RV01–RV75 all pass. A real P1 already forbids the
ready-to-freeze verdict. Broader repository and native regression results are
reported separately by the integrating verifier.
