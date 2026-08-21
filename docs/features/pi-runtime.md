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

Pi must not create its own candidate-acceptance policy. Runner-owned
complete-set declaration-route verification, successful-candidate retention,
targeted retry, target-drift checks, and atomic application remain unchanged.
The supported owned-declaration check currently inside OpenCode must move to an
adapter-neutral candidate boundary before Pi can be accepted as equivalent.

## Production sequence from the current repository

1. Extract the existing disposable workspace, target inspection, candidate
   extraction, and cleanup behavior from OpenCode into the shared Runtime
   Adapter invocation boundary. Prove OpenCode behavior is unchanged.
2. Move supported owned-declaration verification to that shared final-candidate
   boundary. Keep the complete-set project-local route gate in the Runner,
   where it already applies independently of runtime kind.
3. Reinspect the current official Pi SDK, choose and pin one exact version and
   worker-protocol version, and make any Node-version change explicit in the
   reviewed Slice. Do not copy API assumptions from the dated research record.
4. Add the isolated Pi worker protocol, SCORE-owned confined tools, empty
   ambient resources, in-memory settings/session state, fail-closed lifecycle,
   and bounded abort/termination behavior using deterministic fakes first.
5. Add the Pi catalog and Runtime Adapter, then runtime selection, diagnostics,
   and separately authorized live acceptance as later small Slices.

Each step is independently reviewed and must pass focused tests, typecheck,
build, the full test suite, package smoke, and the whitespace-error check before
the next step begins.

## Acceptance examples

- Deterministic fake-provider tests cover success, terminal failures, malformed
  worker messages, crashes, cancellation, cleanup, and concurrency.
- Live acceptance is separately bounded and explicitly authorized; it is never
  implied by unit tests.
- Pi and OpenCode return the same adapter-neutral candidate and failure shapes.

## Dependencies

The implementation begins from the completed Runtime Adapter foundation. Pi
activation depends on the shared disposable Agent workspace and candidate
boundary, then the Pi worker/catalog/adapter, runtime selection, and diagnostics.

## Historical evidence

- [Retired Pi primitives Slice](../../score/retired-slices/pi-runtime-primitives.json)
- [Retired Pi worker-lifecycle Slice](../../score/retired-slices/pi-worker-lifecycle.json)
- [Retired Pi adapter Slice](../../score/retired-slices/pi-adapter.json)
- [Pi adapter research](../research/pi-adapter-implications.md)
