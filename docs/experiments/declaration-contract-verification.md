# Declaration Contract Verification Experiment

Status: successful feasibility experiment; not a production integration.

## Question

Can SCORE use OXC ASTs to derive complete declaration-only context and reject
candidate contract drift deterministically, in memory, without copying the
repository, constructing a TypeScript project, loading environment variables,
or running project commands?

## Result

Yes, for the deliberately supported declaration subset. The executable
prototype in `src/prototypes/`:

- normalizes declaration structure while ignoring formatting and bodies;
- follows complete project-local declaration closures, including local support;
- terminates cyclic declaration graphs;
- distinguishes TypeScript globals, Node platform imports, and locked external
  package leaves;
- preserves frozen exports and import routes for replacement targets;
- rejects missing or extra exports, wrong signatures, changed support types,
  unapproved project imports, changed reference routing, unsupported export
  forms, missing external lock evidence, and oversized inputs;
- emits stable declaration, evidence, candidate-set, and verdict digests with
  exact structural mismatch paths.

Sixteen synthetic positive and negative scenarios passed. Four read-only trials
against real SCORE sources passed: the validation API, an Effect schema closure,
a React TSX component contract, and a Node platform type. Two independent
process executions produced byte-identical JSON. Hashes of every tracked and
untracked non-ignored repository file were unchanged by execution.

Verification on 2026-08-15:

```text
npm run experiment:declaration-contracts  PASS
npm run typecheck                         PASS
npm test                                  PASS (316/316)
npm run build                             PASS
git diff --check                          PASS
```

## What This Does Not Prove

This proves technical feasibility of declaration evidence and conformance, not
that the prototype is ready to become SCORE's gate. It does not prove TypeScript
assignability, whole-project compilation, tests, runtime behavior, or product
correctness. Unsupported relevant syntax intentionally fails closed. The next
step must harden the supported syntax model and schemas, add durable tests, and
integrate preparation and candidate verification without copying this throwaway
harness wholesale.
