# Real-project verification

**Status:** Deferred research track. Not an accepted Runner capability and no
active Slice.

## Intended outcome

After the declaration-reliability experiments, explore how SCORE can bind named
project-owned checks to the exact candidate revision so a person can know
whether that code typechecks, compiles, builds, passes selected tests, or
satisfies other explicitly declared criteria.

Each passing check would support only its named claim. Even a complete passing
suite would not prove universal behavioral correctness.

## Why this is deferred

The accepted Runner currently stops after integrity-checked atomic candidate
delivery. Earlier synthetic-project verification reproduced compiler settings
without the target project's real dependencies and falsely rejected valid
projects. SCORE must not revive that approach under a new name.

Future research must use or faithfully delegate to the real project environment
without silently loading secrets, widening Agent authority, fabricating a
dependency installation, or confusing a command exit code with a broader
correctness guarantee.

## Questions the research must answer

- When are verification criteria selected, reviewed, and frozen?
- Does verification run before application, after guarded application, or in a
  user-controlled external integration?
- How are the exact candidate digest, project state, command, toolchain, and
  environment bound to one Verification Result?
- How are credentials, environment variables, command output, and local paths
  kept private while retaining useful failure evidence?
- What happens to the candidate set when one check fails?
- How can browser, integration, or other behavioral checks make bounded claims
  without being mislabeled as complete behavioral correctness?

## Candidate experiment sequence

Do not begin this sequence until the current declaration-verification track is
resolved.

1. Bind one harmless project-owned command to one exact already-applied
   candidate digest and record a bounded Verification Result.
2. Prove that changing either project bytes or the command invalidates reuse of
   that result.
3. Exercise one passing and one failing typecheck or build in the real project
   environment without copying dependencies or loading undeclared environment
   state.
4. Exercise one focused behavioral test and preserve its narrower claim
   separately from compilation and build claims.
5. Only then compare pre-application, guarded post-application, and external
   verification workflows before proposing a production design.

## Success statement

If a future accepted design passes these experiments, SCORE may say:

> The identified candidate revision passed the named project-owned checks in
> the identified real project environment.

It still may not say that all behavior is correct, that unrun checks would pass,
or that deployment and user acceptance succeeded.

## Existing boundary

- [D-079: SCORE stops after integrity-checked atomic candidate delivery](../decisions.md#d-079-score-stops-after-integrity-checked-atomic-candidate-delivery)
- [Current Assurance Case](../assurance/README.md)
- [Candidate declaration verification](candidate-declaration-verification.md)
