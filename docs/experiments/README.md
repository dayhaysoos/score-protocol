# SCORE experiment checkpoint

This directory records bounded experiments and their actual outcomes. An
experiment may support one Assurance Claim, but it does not become a production
feature or general guarantee.

## Current checkpoint

| Experiment | Result | What SCORE may conclude |
| --- | --- | --- |
| [Declaration-contract verification](declaration-contract-verification.md) | Successful feasibility experiment | Supported TypeScript declaration shapes can be compared deterministically in memory. |
| [Declaration-shape normalizer](declaration-shape-normalizer.md) | Revisions 2 and 3 accepted; revision 4 rejected | A small Agent-authored AST module can pass bounded behavior checks, while an independent declaration check can still catch public-contract drift. |
| [Assigned-file Agent preflight](agent-assigned-file-preflight.md) | Successful end-to-end experiment | One isolated Agent can receive typed declaration feedback, repair an exact mismatch, and finish with a verdict SCORE independently reproduces. |
| [Final-candidate declaration check](final-candidate-declaration-check.md) | Successful deterministic adapter-harness experiment | SCORE can independently reject declaration drift in the exact final bytes without depending on an Agent-side tool call. |
| [Automatic declaration repair loop](automatic-declaration-repair-loop.md) | Successful deterministic same-session adapter-harness experiment | SCORE can trigger one typed repair continuation only when needed, then independently accept or reject the new final bytes. |
| [Approved declaration input binding](approved-declaration-input-binding.md) | Successful deterministic preparation-to-adapter harness experiment | One exact approved revision can be the sole source of the target, baseline, declaration, and bounded repair configuration. |
| [Approved multi-declaration verification](approved-multi-declaration-verification.md) | Successful deterministic one-file scaling experiment | One approved Agent Brief can bind and verify two declarations together while reporting only the failing declaration. |
| [Production single-file candidate gate](../features/candidate-declaration-verification.md) | Applied, failed independent integration verification, then repaired locally | The final-byte admission seam and forward-only activation work in the current dirty worktree; imported project-local source routing remains unresolved. |
| [Effect external declaration evidence](effect-external-declaration-evidence.md) | Successful bounded resolver experiment | SCORE can select public Effect declarations and a small required support layer without loading the project TypeScript environment. |
| [External declaration resolution matrix](external-declaration-resolution-matrix.md) | Successful controlled package-layout experiment | Exact exports, conditional type routes, bounded `typesVersions`, and precise refusal can be tested without claiming every package layout. |
| [External evidence Agent Brief binding](external-evidence-agent-brief-binding.md) | Successful preparation-to-Agent-Input experiment | Full provenance can remain in prepared evidence while the Agent receives a path-sanitized contract projection. |

## Latest experiment

The first production single-file candidate gate was generated and atomically
applied as six File Candidates in Run
`50d78e0b-0bbc-4ac2-8849-12e414066bf2`. Candidate generation succeeded, but
independent repository verification failed. Local repairs were required before
the current worktree passed typecheck, build, all 340 tests, package smoke
testing, and `git diff --check`.

The current result supports a narrow conclusion:

1. exact final candidate bytes can be checked at the production OpenCode
   success boundary;
2. a failed check can retain sanitized findings and digests through existing
   Runner evidence and presentation paths; and
3. current regression and package checks pass after local integration repair.

It does not support the stronger conclusion that the approved Slice generated
correctly on its own. It also does not prove imported declaration source
routing, forward-only Profile and Agent Package activation, multi-file
candidate-set verification, project correctness, or general TypeScript
semantics.

## Why this followed approved-input binding

The approved-input and multi-declaration experiments proved that one frozen
Agent Brief could supply bounded declaration expectations without runtime
retyping. The production Slice tested the smallest admission seam that could
turn those expectations into an authoritative File Candidate result.

## Current boundary and next decision

Forward-only activation and bounded selected external-declaration evidence are
now integrated in the current dirty worktree. The dependency experiment retains
external packages as closure boundaries: only reviewed public members and one
direct supporting layer enter context, and Agents receive no package access.

The next declaration question is imported project-local source routing. The
multi-file complete-set gate remains deliberately stopped until this worktree is
curated and that smaller routing seam is designed. Project commands and broader
TypeScript semantics remain outside this track.

After the declaration-verification sequence is resolved, the explicitly
deferred follow-on is [real-project verification](../features/real-project-verification.md):
typecheck, build, tests, and bounded behavioral criteria in the real project
environment. It must not be folded into the current experiments.
