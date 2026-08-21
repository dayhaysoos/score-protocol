# Approved Declaration Input Binding Experiment

Status: successful deterministic preparation-to-adapter harness experiment; not
a production Runner feature.

## Question

Can SCORE derive the one-file declaration verifier and bounded repair
configuration from the exact approved prepared revision, without retyping the
target, baseline source, declaration name, or documented declaration in a
separate runtime configuration?

## Experimental seam

The prototype `bindApprovedDeclarationRepair` module accepts:

- one `score.approved-pass-export@0.1.0-alpha.5` value obtained only after Plan
  Approval;
- the claimed Job target, Agent Input JSON, and Agent Package digest; and
- the fixed experimental limit of one repair continuation.

It verifies the approved Source Snapshot digest, every relevant Agent Package
digest, the claimed package identity, exact Agent Input bytes, and target path.
It then reads the baseline source or exact absence and the single owned
Documented Declaration from the approved Agent Input. The result is a frozen
configuration, approval evidence, and a digest binding all of those facts.

The module returns typed findings instead of a partial binding when any relevant
identity, digest, target state, or declaration is missing, ambiguous,
unsupported, or inconsistent.

## Result

The deterministic harness establishes that:

1. a real existing-file Change can be prepared, approved, exported, and bound
   without retyping its target bytes or declaration;
2. an approved greenfield target binds to exact absence and an empty baseline;
3. the same approved revision and claimed Job produce a byte-identical binding;
4. substituted target paths, Agent Inputs, package digests, or post-approval
   declaration bytes are rejected with exact typed findings;
5. an unapproved prepared revision cannot produce the required approved export;
6. neither existing nor greenfield source files change during binding; and
7. the derived configuration drives the existing one-session automatic repair
   loop through public `RuntimeAdapter.invoke` and its independent final check.

No paid Agent was invoked.

## Reproduction

```sh
npm run experiment:approved-input-binding
npm run typecheck
```

## What this proves

For one Agent Brief owning one supported declaration, SCORE can make the exact
approved revision the sole source of verifier and repair expectations. The
Agent receives findings derived from the same declaration the human approved,
and target or contract substitutions fail before the binding can be used.

## What this does not prove

The prototype binder is not automatically invoked for every production Runner
Job. It does not persist the binding, aggregate multi-file results, create
Declaration Evidence, broaden TypeScript syntax, or execute project typecheck,
builds, tests, or behavioral checks. The deterministic fake runtime does not
establish universal live-model repair ability.

## Next experiment

This follow-up is complete in the
[approved multi-declaration experiment](approved-multi-declaration-verification.md).
