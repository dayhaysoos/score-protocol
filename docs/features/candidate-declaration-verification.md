# Candidate declaration verification

**Status:** Experimental production integration implemented and verified on the
current branch. It is not a release or real-project-correctness claim.

## Outcome

SCORE independently checks supported owned declarations and reviewed
project-local import routes in exact final candidate bytes before atomic
application. Agent-side feedback remains optional; acceptance does not depend on
the Agent requesting or obeying it.

## Production behavior

- Every project-local `consumes` entry requires `name`, owning target `from`, and
  the exact reviewed `module_specifier`.
- Preparation freezes that route into the consumed Documented Declaration in
  Agent Input and shows the same owner target and import spelling in the HTML
  review.
- The forward-only boundary is Compilation Bundle, Coding Profile, compiler
  input, Plan Review, Agent Input, and Runner control `0.1.0-alpha.6`, with
  Approved Pass Export `0.1.0-alpha.7`.
- The OpenCode Adapter checks supported non-empty owned declarations against the
  exact final File Candidate bytes.
- After all candidates exist, the Runner uses OXC on those final in-memory bytes
  and checks every relevant named import against its frozen route.
- Missing, ambiguous, wrong, unsupported, or syntactically invalid relevant
  imports produce precise typed findings bound to candidate, binding, and
  verdict digests.
- A route failure changes only blamed consumer Jobs to failed, discards their
  rejected bytes, retains safe evidence and rejected-output digests, preserves
  every unrelated successful candidate, and applies nothing.
- A manually authorized retry invokes only selected failed consumers with the
  frozen runtime and Agent Package. SCORE then rechecks the complete set before
  one atomic application.
- Repeated identical checks produce byte-identical verdicts and digests.

## Failure presentation

Runner status states the failure category, exact finding code, declaration,
approved module specifier, and safe digests on separate readable lines. It never
prints or persists the rejected candidate source or an unapproved observed
module specifier.

## Preserved boundary

Candidate acceptance remains entirely in memory. It does not read the target
project's `tsconfig.json`, `node_modules`, package metadata, environment,
network, installer, shell, compiler, repository source, or project commands. It
does not construct a TypeScript Program or synthetic project and does not claim
assignability, compilation, builds, tests, linting, runtime behavior,
deployment, or user acceptance.

Selected external-declaration evidence remains preparation context only. It
does not prove that a candidate imports, calls, typechecks against, or behaves
correctly with an external package API.

## Current evidence

The production route-binding test exercises real Change preparation, HTML
review, approval, Approved Pass Export, and Runner enqueue. The complete-set
recovery test then proves this exact sequence:

1. owner and consumer candidates finish;
2. the consumer imports the declaration through the wrong module specifier;
3. SCORE rejects only the consumer and persists no rejected source bytes;
4. the owner candidate remains unchanged and saved;
5. one manual consumer retry returns the reviewed import;
6. SCORE rechecks the complete set and atomically applies both files.

The focused gate covers exact, missing, ambiguous, wrong, unsupported, relevant
invalid syntax, unrelated syntax isolation, missing-owner, deterministic-order,
and safe-evidence cases. The full worktree passes typecheck, build, all 361
tests, package smoke testing, and `git diff --check`.

## Historical evidence

- [Approved multi-declaration verification experiment](../experiments/approved-multi-declaration-verification.md)
- [Approved cross-file route binding experiment](../experiments/approved-cross-file-route-binding.md)
- [Cross-file declaration route retry experiment](../experiments/cross-file-declaration-route-retry.md)
- [Approved declaration input binding experiment](../experiments/approved-declaration-input-binding.md)
- [Automatic declaration repair loop experiment](../experiments/automatic-declaration-repair-loop.md)
- [Final-candidate declaration check experiment](../experiments/final-candidate-declaration-check.md)
- [Assigned-file Agent preflight experiment](../experiments/agent-assigned-file-preflight.md)
- [Declaration-shape normalizer experiment](../experiments/declaration-shape-normalizer.md)
- [Verify candidate declarations in memory](../adr/0006-verify-candidate-declarations-in-memory.md)
- [Bind reviewed local routes and retry only consumers](../adr/0015-bind-reviewed-local-routes-and-retry-only-consumers.md)
