# Runtime diagnostics and acceptance

**Status:** Planned. No active Slice.

## Outcome

A person can determine whether a runtime is locally usable, understand safe
repair guidance, and distinguish deterministic repository verification from
explicit live acceptance.

## Expected behavior

- Runtime diagnostics inspect only the selected adapter.
- Checks cover compatible runtime dependencies, authentication availability,
  model discovery, and packaged worker resources without sending a model
  prompt.
- Human and JSON output report bounded versions, counts, and repair guidance.
- Diagnostics never expose credentials, private state paths, raw SDK errors,
  prompts, responses, or transcripts.
- Documentation explains runtime selection, process isolation, workspace tools,
  candidate extraction, cancellation, cleanup, and failure boundaries.
- A release acceptance contract separately names deterministic tests and any
  explicitly authorized live scenarios.

## Boundaries

A successful diagnostic does not prove that a paid Agent invocation, candidate,
or hosted workflow will succeed. Deterministic verification and live acceptance
remain separate claims.

## Acceptance examples

- Diagnostic execution makes zero model requests.
- Missing authentication and unavailable models produce stable, safe repair
  instructions in both text and JSON output.
- Existing OpenCode diagnostic behavior remains compatible when no runtime is
  selected.

## Historical evidence

- [Retired runtime-diagnostics Slice](../../score/retired-slices/pi-doctor-documentation.json)
