# Pi runtime

**Status:** Planned. No active Slice.

## Outcome

Pi can execute SCORE Agent Packages with the same frozen-input, isolation,
sanitized-evidence, and candidate boundaries as OpenCode, while Pi-specific
mechanics remain behind its Runtime Adapter.

## Expected behavior

- SCORE pins and validates the supported Pi SDK and worker protocol versions.
- Catalog discovery exposes only authenticated, exact provider and model
  identities and supported thinking variants.
- Every Job receives a fresh child process, one session, selected-only runtime
  state, and SCORE-owned workspace tools.
- The worker protocol carries only frozen Job input and bounded lifecycle facts;
  it never serializes credentials, transcripts, raw prompts, or model output.
- Workspace tools remain confined to the disposable workspace.
- Success requires an authoritative completed assistant result and valid target
  extraction. Missing, failed, aborted, truncated, or unknown completion fails
  closed.
- Cancellation is bounded and can terminate an unresponsive child process.
- Concurrent Jobs share no session, process, mutation queue, or conversation.

## Boundaries

Pi support does not weaken SCORE's human approval or atomic application gates.
It does not read ambient Pi extensions, prompts, skills, themes, or user state,
and deterministic tests must not require paid model calls.

## Acceptance examples

- Deterministic fake-provider tests cover success, terminal failures, malformed
  worker messages, crashes, cancellation, cleanup, and concurrency.
- Live acceptance is separately bounded and explicitly authorized; it is never
  implied by unit tests.
- Pi and OpenCode return the same adapter-neutral candidate and failure shapes.

## Dependencies

This capability depends on the Runtime Adapter foundation, runtime selection,
and disposable Agent workspace features.

## Historical evidence

- [Retired Pi primitives Slice](../../score/retired-slices/pi-runtime-primitives.json)
- [Retired Pi worker-lifecycle Slice](../../score/retired-slices/pi-worker-lifecycle.json)
- [Retired Pi adapter Slice](../../score/retired-slices/pi-adapter.json)
- [Pi adapter research](../research/pi-adapter-implications.md)
