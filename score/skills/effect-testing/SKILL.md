---
name: effect-testing-for-score
description: Test SCORE Effect services, concurrency, and lifecycle behavior deterministically with this repository's node:test stack.
license: MIT
compatibility: effect 4.0.0-beta.104 with node:test
provenance: Adapted from Kit Langton's effect skill, kitlangton/skills at 0cace2ae0bd65e0cb03ab12860b62ae5e043f0df.
---

# Deterministic Effect tests for SCORE

Keep this repository's `node:test` and `node:assert` stack. Execute Effects with
`Effect.runPromise`; do not introduce Vitest, `@effect/vitest`, or `it.effect`
for this Slice.

## Test through services

- Supply fake implementations with explicit `Layer.succeed`, `Layer.effect`,
  or the repository's existing layer helpers.
- Let one fake object back the service under test and any test-only inspection
  controls when both must observe the same state.
- Assert typed failures and stable sanitized evidence, not provider prose,
  response bodies, or incidental stack traces.

## Synchronize deterministically

- Use `Deferred` for one-shot readiness or completion, `Queue` for controlled
  handoff, and `Ref` for shared observation state.
- When virtual time is genuinely required, import the pinned API from
  `effect/testing/TestClock` and advance it explicitly.
- Do not add arbitrary sleeps, timing margins, or polling races to make a
  concurrent test pass.
- Prove concurrency with gates and counters: observe admission, hold work,
  release it deliberately, and assert the maximum and final state.

## Boundary cases

- Exercise success, typed failure, interruption, finalization, rollback,
  malformed persistence, and compatibility mismatch where the File Brief owns
  those behaviors.
- Prove pre-admission rejection by asserting the runtime fake received no
  session, gateway, network, or child-process call.
- Keep tests hermetic: no credentials, paid models, network access, or real
  runtime child processes.
- Preserve existing regression coverage unless the File Brief explicitly
  changes that behavior.

The test change is complete when each claimed state or lifecycle transition is
driven by a deterministic signal and no assertion depends on wall-clock luck.
