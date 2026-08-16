# Runtime selection

**Status:** Planned. No active Slice.

## Outcome

A person can deliberately select a supported coding-agent runtime, review its
model configuration, and freeze that choice into a Run. Work and recovery then
use only the frozen choice.

## Expected behavior

- Guided start selects a runtime before discovering its models.
- Non-interactive commands accept an explicit supported runtime.
- Omitting runtime selection preserves the established OpenCode default.
- Model and thinking variants are validated against the selected runtime before
  Run creation.
- Work and recovery dispatch from the frozen runtime kind, not ambient CLI
  state.
- Unknown, unavailable, or mismatched runtimes fail before a Job is claimed.
- Human and machine-readable output identify the selected runtime without
  exposing credentials or private runtime state.

## Boundaries

The supported runtime set is source-controlled and closed. This feature does
not introduce dynamic third-party plugins or allow execution-time reselection.

## Acceptance examples

- Existing commands without a runtime option continue to select OpenCode.
- Guided and non-interactive Pi selection freeze the same configuration shape.
- Recovery cannot silently switch a frozen Pi Run to OpenCode or vice versa.

## Dependencies

This capability depends on a verified Runtime Adapter foundation and on each
selectable runtime having a trustworthy catalog and adapter implementation.

## Historical evidence

- [Retired runtime-selection Slice](../../score/retired-slices/runtime-adapter-selection.json)
