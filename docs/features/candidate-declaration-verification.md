# Candidate declaration verification

**Status:** Experimental production integration implemented in the current dirty
worktree. It is not yet an accepted release feature.

## Outcome

SCORE independently verifies that final candidate bytes conform to the approved
Documented Declarations before those candidates can be accepted for atomic
application. An Agent may receive the same bounded findings while it works, but
correctness never depends on the Agent choosing to request or obey that
feedback.

## Expected behavior

- The final check uses the exact returned candidate bytes and frozen approved
  declaration inputs.
- A valid verdict is bound to the candidate content digest.
- Missing, unexpected, rerouted, incomplete, unsupported, or structurally
  mismatched relevant declarations produce precise typed findings.
- Editing a candidate after an in-session valid check cannot bypass the final
  check.
- Equivalent frozen inputs and candidate bytes produce byte-identical verdicts
  and digests.
- Candidate verification remains entirely in memory and makes no source-file
  changes.
- In-session Agent feedback is optional and non-authoritative; the independent
  final check is authoritative.
- An optional bounded repair continuation may use deterministic findings from
  that check, but final acceptance still depends on rechecking the new bytes.
- Verifier and repair expectations are derived from the exact approved Agent
  Package; target, Agent Input, package, or declaration substitutions fail
  before verification begins.
- Every approved owned declaration relevant to the assigned file is checked
  against the same exact candidate bytes; findings identify only the declarations
  that fail.

## Boundaries

This feature does not prove TypeScript assignability, semantic typechecking,
builds, tests, linting, runtime behavior, deployment, or user acceptance. It
does not authorize repository browsing, environment loading, dependency
installation, or project command execution by an Agent. Repair Notices and
manual retry remain separate behavior.

## Production entry boundary

The bounded prototype sequence is complete for a one-file gate: approved-input
binding, multiple owned declarations, exact final-byte verification, precise
findings, and one optional repair continuation have each passed independently.

Run `50d78e0b-0bbc-4ac2-8849-12e414066bf2` applied the first production
single-file gate Slice with six successful File Candidates. Independent
repository verification then failed: the generated integration used an
unsupported Effect schema API, inferred incompatible evidence types, read one
evidence field from the wrong object, did not narrow delete operations before
the verifier, and shipped invalid test fixtures. Those defects were repaired
locally after the Run. The resulting dirty worktree passes typecheck, build,
all 340 tests, package smoke testing, and `git diff --check`; it is not
byte-identical to the six applied candidates.

The current gate enforces the exact-final-byte check for non-empty owned
declarations handled by the OpenCode Adapter. Its Coding Profile, Agent Input,
Agent Package, and Runner activation is now forward-only at the alpha.5
boundary. It does not yet complete the accepted feature boundary:

- the current consumed-declaration input does not identify an expected source
  module, so the gate cannot prove that an imported project-local declaration
  was routed from the correct module.

Until those gaps are addressed and the work is curated into an identified
source revision, this is experimental enforcement rather than a production
readiness claim. Selected external-declaration evidence supplies Agent context
but does not verify candidate package API usage. Multi-file complete-set
verification and project command execution remain out of scope.

## Historical evidence

- [Approved multi-declaration verification experiment](../experiments/approved-multi-declaration-verification.md)
- [Approved declaration input binding experiment](../experiments/approved-declaration-input-binding.md)
- [Automatic declaration repair loop experiment](../experiments/automatic-declaration-repair-loop.md)
- [Final-candidate declaration check experiment](../experiments/final-candidate-declaration-check.md)
- [Assigned-file Agent preflight experiment](../experiments/agent-assigned-file-preflight.md)
- [Declaration-shape normalizer experiment](../experiments/declaration-shape-normalizer.md)
- [Verify candidate declarations in memory](../adr/0006-verify-candidate-declarations-in-memory.md)
- [Keep live module inspection out of Agent execution](../adr/0010-keep-live-module-inspection-out-of-agent-execution.md)
- [Introduce declaration verification forward-only](../adr/0013-introduce-declaration-verification-forward-only.md)
