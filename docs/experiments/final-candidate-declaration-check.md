# Final-Candidate Declaration Check Experiment

Status: successful deterministic adapter-harness experiment; not a production
Candidate Declaration Gate.

## Question

Can an opt-in Runtime Adapter experiment independently check the exact final
candidate bytes after Agent completion, accept a conforming candidate without
requiring an Agent-side tool call, and reject declaration drift even after an
earlier valid in-session check?

## Experimental seam

The experiment adds one opt-in `prototypeFinalCandidateCheck` configuration to
the OpenCode Adapter. After ordinary workspace containment and UTF-8 inspection,
the adapter passes its captured candidate string to the existing pure assigned-
file declaration checker. The checker receives only the frozen target,
baseline, declaration name, and Documented Declaration.

Every result now includes the SHA-256 digest of the exact candidate bytes. The
adapter compares that digest with the independently captured target-output
digest before returning a successful File Candidate. An invalid declaration or
digest mismatch fails as candidate integrity. The check does not consult the
Agent's preflight audit.

The production adapter behavior is unchanged unless the explicit prototype
option is supplied.

## Result

The public `RuntimeAdapter.invoke` seam proves that:

1. valid final bytes are accepted without an Agent-side preflight call;
2. final bytes with an export-shape mismatch are rejected as candidate
   integrity;
3. a valid earlier preflight result cannot authorize bytes edited afterward;
   and
4. identical checker inputs produce byte-identical results, candidate digests,
   and verdict digests.

No paid Agent was invoked. The experiment used deterministic adapter fixtures
and the existing pure declaration checker.

## Reproduction

```sh
npm run experiment:final-candidate-check
npm run typecheck
```

## What this proves

For one assigned file and one supported declaration, Agent self-checking is not
a correctness dependency. Deterministic SCORE code evaluates the captured final
candidate content and binds its verdict to the same content digest returned
with the File Candidate.

## What this does not prove

This is not production Runner admission, the complete-set Candidate Declaration
Gate, durable evidence, automatic Agent continuation, Repair Notices, retries,
multi-file declaration closure, arbitrary TypeScript verification, compilation,
tests of a generated project, or runtime correctness.

## Next decision

This experiment was accepted and followed by the bounded
[automatic-repair experiment](automatic-declaration-repair-loop.md). The next
experiment binds the same verifier and repair inputs to one exact prepared
revision. Do not combine that input-binding experiment with production
persistence, new declaration syntax, or multi-file integration.
