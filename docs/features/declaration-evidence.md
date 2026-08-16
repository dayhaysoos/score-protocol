# Declaration evidence

**Status:** Planned. No active Slice.

## Outcome

An Agent receives complete, deterministic interface context for the declarations
its work owns or consumes, without guessing signatures or searching the live
repository during execution.

Authored Documented Declarations remain authoritative. Information inspected
from existing source is supporting evidence, not a replacement for approved
product meaning.

## Expected behavior

- Existing declarations produce bounded, deterministic closures containing the
  relevant declaration and its project-local supporting declarations.
- New declarations are normalized from their authored contracts without
  requiring the target file to exist.
- Mixed work can combine existing and newly authored declarations.
- Declaration routes distinguish type and value namespaces and terminate on
  cycles.
- Missing, ambiguous, unsupported, incomplete, or over-limit relevant input
  produces precise findings before review.
- Identical input produces byte-identical evidence and digests.
- Preparation remains in memory and does not modify source files or construct a
  synthetic TypeScript project.

## Boundaries

This feature does not prove TypeScript assignability, runtime correctness, or
candidate correctness. It does not run builds, tests, package installation, or
paid Agents. Candidate verification and retry behavior are separate features.

## Smallest useful experiment

Build the pure declaration-evidence module without connecting it to Plan Intake.
Verify it with independently authored fixtures for existing, greenfield, mixed,
cyclic, dual-namespace, and create-to-create declaration relationships. Only
after that module passes typecheck and the full repository suite should a later
Slice connect it to shared preparation.

## Historical evidence

- [Retired declaration-evidence preparation Slice](../../score/retired-slices/declaration-evidence-preparation.json)
- [Declaration-contract experiment](../experiments/declaration-contract-verification.md)
- [Authored declarations remain authoritative](../adr/0001-authored-declarations-remain-authoritative.md)
