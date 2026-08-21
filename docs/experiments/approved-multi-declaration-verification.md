# Approved Multi-Declaration Verification Experiment

Status: successful deterministic one-file scaling experiment; not a production
Runner gate.

## Question

Can the approved-input binding and final-candidate repair design scale from one
owned declaration to two owned declarations in the same Agent Brief without
adding files, Agents, project commands, or a second source of truth?

## Experimental seam

The existing prototype binder now returns the complete non-empty ordered list
of approved owned declarations. Duplicate approved names fail as ambiguous.
The assigned-file checker evaluates that list together against one exact
candidate string and returns one candidate digest, one deterministic verdict
digest, and one ordered finding list.

The OpenCode Adapter uses that same list for both the automatic repair decision
and the independent final-candidate check.

## Result

The deterministic harness establishes that:

1. one real approved Agent Brief binds two owned declarations in approved
   order;
2. a candidate with a valid `prefix` declaration and an invalid `label`
   declaration produces one precise `EXPORT_SHAPE_MISMATCH` for `label` only;
3. repeated identical two-declaration checks produce byte-identical results and
   verdict digests;
4. the exact typed finding drives one repair continuation in the same session;
5. the repaired candidate containing both valid declarations passes the
   independent final-byte check; and
6. the experiment still uses one file, one Agent Brief, one session, and no
   project commands or source application.

No paid Agent was invoked.

## Reproduction

```sh
npm run experiment:approved-multi-declaration
npm run typecheck
```

## What this proves

The approved-input binding and deterministic candidate check are not limited to
a single declaration scalar. They can carry a small approved declaration set,
isolate the failing declaration, aggregate findings deterministically, and
retain one exact-candidate verdict.

## What this does not prove

This does not establish production Runner admission, durable gate evidence,
multi-file candidate-set verification, arbitrary declaration counts or
TypeScript syntax, TypeScript assignability, project compilation, tests,
runtime behavior, or universal live-model repair reliability.

## Next step

Prepare one production Slice for the single-file Candidate Declaration Gate.
It should derive all relevant owned declarations from the exact approved Agent
Package, check exact final candidate bytes before successful candidate
admission, emit deterministic typed findings, and remain independent of
optional Agent feedback. Do not add multi-file complete-set verification or
project command execution to that Slice.
