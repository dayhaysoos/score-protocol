# Runtime Adapter foundation

**Status:** Implemented and verified. No active Slice.

## Outcome

The Runner can execute a frozen Agent Package through different coding-agent
runtimes without moving SCORE's approval, isolation, recovery, or atomic
application rules into those integrations.

## Expected behavior

- A frozen Run records one complete, explicit runtime configuration.
- A claimed Job retains the existing Run, target, operation, package, and
  attempt identity while carrying that runtime configuration intact.
- The Runner invokes a small adapter-neutral interface and receives either one
  bounded candidate or a typed, sanitized failure.
- Runtime identity mismatches fail before Agent Input is delivered.
- Historical OpenCode Runs continue to decode and behave as before.
- Rolling concurrency, sibling independence, recovery, evidence retention, and
  complete-set application remain Runner-owned.

## Boundaries

The foundation does not select a runtime, implement Pi, add a dynamic plugin
system, or change the meaning of an approved Agent Package. Runtime-specific
lifecycle and filesystem mechanics stay behind the relevant adapter.

## Acceptance examples

- Existing OpenCode behavior remains unchanged through the shared seam.
- A Job configured for one runtime cannot be admitted by another runtime.
- Persisted runtime versions are reported according to their actual runtime
  kind and are never mislabeled.
- The complete repository passes typecheck, build, tests, and guided Runner
  startup after each foundation Slice.

## Current implementation

The Runner now depends on the adapter-neutral `RuntimeAdapter` service and its
Run-scoped `withRun` lifecycle. Persisted configuration is a closed
`opencode | pi` union, and runtime identity is carried through claimed Jobs.
OpenCode runs through that seam without changing Runner-owned concurrency,
recovery, evidence, or application behavior.

This foundation does not mean Pi is executable yet. The reusable disposable
workspace and candidate-extraction logic still lives inside the OpenCode
adapter, and runtime selection still defaults to OpenCode.

## Historical evidence

- [Retired foundation Slice](../../score/retired-slices/runtime-adapter-foundation.json)
- [Retired foundation repair Slice](../../score/retired-slices/runtime-adapter-foundation-repair.json)
- [Runtime Adapter design](../runtime-adapters.md)
