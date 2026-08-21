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
| [Cross-file declaration route retry](cross-file-declaration-route-retry.md) | Successful deterministic two-file experiment | A wrong consumer route can blame and retry only the consumer while retaining the owner and preserving atomic application. |

## Latest experiment

The two-file cross-route experiment deliberately gave one consumer the wrong
module specifier. The complete-set check blamed only that consumer, preserved
the owner candidate, observed no repository change, retried the consumer once,
and applied the repaired two-file set atomically. This proves the intended
recovery state model is feasible without regenerating successful candidates.

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

The next decision is how to preserve the reviewed source module for each
consumed declaration in approved input, then bind this proven route-and-retry
behavior to existing Runner state. Project commands and broader TypeScript
semantics remain outside this track.

After the declaration-verification sequence is resolved, the explicitly
deferred follow-on is [real-project verification](../features/real-project-verification.md):
typecheck, build, tests, and bounded behavioral criteria in the real project
environment. It must not be folded into the current experiments.
