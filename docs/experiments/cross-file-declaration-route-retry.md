# Cross-file declaration route retry

**Status:** Successful deterministic two-file experiment. Not production Runner
behavior.

## Question

When an owner candidate is valid but a consumer imports its declaration from
the wrong module, can SCORE identify only the consumer as failed, preserve the
owner candidate, retry one Agent, recheck the complete set, and still apply both
files atomically?

## Controlled setup

- `src/account.ts` owns `Account` and produces a valid candidate.
- `src/format-account.ts` consumes `Account`.
- The reviewed route is `./account.js`.
- The first consumer candidate imports `Account` from `./wrong.js`.
- One repaired consumer candidate imports `Account` from `./account.js`.
- OXC inspects only the two supplied candidate strings in memory.
- The existing repository application seam writes files only after the final
  complete-set verdict is valid.

## Observed result

The first complete-set check returned one exact
`CONSUMED_DECLARATION_ROUTE_MISMATCH` finding against only
`src/format-account.ts`. The repository still contained both original files.
The owner candidate remained retained with digest:

```text
sha256:73497468b33d8284076f62ad5b62eb09af90e1b7f3488f99029aa87240e2d962
```

Only the consumer was invoked again. The repaired two-file set passed, and the
existing guarded application seam applied both candidates together.

| Observation | Result |
| --- | --- |
| Initial paid Agent invocations | 2 |
| Candidates retained after rejection | `src/account.ts` |
| Retry targets | `src/format-account.ts` |
| Additional paid Agent invocations | 1 |
| Partial application after rejection | None |
| Final application | Both files together |

## Reproduction

```sh
npm run experiment:cross-file-route-retry
```

The executable model is
[`src/prototypes/cross-file-declaration-route-retry.ts`](../../src/prototypes/cross-file-declaration-route-retry.ts),
and the public-seam harness is
[`test/cross-file-declaration-route-retry.test.ts`](../../test/cross-file-declaration-route-retry.test.ts).
The [interactive state prototype](cross-file-declaration-route-retry-prototype.html)
can be opened directly in a browser.

## Conclusion

Atomic application and economical recovery are compatible. A complete-set
route gate does not need to discard or regenerate valid candidates. Its finding
must identify one repairable target; the existing manual retry model can then
reuse every other candidate and rerun the gate before application.

## What this does not prove

- The current approved Agent Input does not yet preserve the reviewed source
  module for a consumed declaration. The experiment receives that route as an
  explicit frozen input.
- This is not wired into Runner state, Failure Evidence, Repair Notices, or the
  interactive retry CLI.
- It covers one named import between two project-local files, not aliases,
  namespace imports, re-exports, cycles, several consumers, or ambiguous blame.
- It does not typecheck, build, run tests in the target project, or prove runtime
  behavior.
