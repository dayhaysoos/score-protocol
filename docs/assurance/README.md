# SCORE Assurance Case

Status: experimental and forward-only. This document records what the current
SCORE implementation can support with identified evidence. It is not a Core
Protocol artifact, does not approve work, and does not turn an experiment into
a general guarantee.

## Purpose

SCORE is a new approach to agentic coding. Its claims therefore need the same
discipline as its code: exact scope, attributable evidence, reproducible checks,
and an explicit boundary.

The **Assurance Case** is the maintained account. Each **Assurance Claim** is one
falsifiable statement. The **Assurance Envelope** is the set of claims currently
supported by evidence. A **Non-Claim** says what that evidence does not
establish.

The canonical glossary already defines **Evidence** and **Verification Result**.
This document reuses those terms rather than creating a parallel evidence
model.

## Claim statuses

| Status | Meaning |
| --- | --- |
| Enforced | Deterministic implementation logic rejects a violating case, with regression coverage in the current source. |
| Demonstrated | A controlled execution produced the stated result for the exact recorded inputs and runtime. |
| Verified | A named check passed against an identified source state. |
| Unproven | Current evidence does not support the statement. |

`Demonstrated` never means universally reliable. `Verified` never expands the
scope of the named check. `Enforced` is version-bound and must be re-evaluated
when the enforcing seam changes.

## Admission rule

An Assurance Claim belongs in the envelope only when it records:

1. one precise statement;
2. its status and exact scope;
3. attributable Evidence;
4. at least one Non-Claim;
5. a reproduction command or deterministic implementation seam.

Claims must not be inferred from Agent completion text, candidate application
alone, test names without execution, a dirty-worktree commit identifier, or a
single stochastic run generalized beyond its inputs.

## Current assurance envelope

| ID | Status | Assurance Claim | Scope and Evidence | Non-Claim |
| --- | --- | --- | --- | --- |
| AC-001 | Enforced | An unapproved prepared Change cannot create a Runner Run or Job. | Current Runner approval seam; regression coverage in [`test/runner-approval.test.ts`](../../test/runner-approval.test.ts). | Does not prove the human understood or correctly approved the review. |
| AC-002 | Enforced | Enqueue freezes one pending Job for each exact approved Agent Package. | Current approval-to-enqueue seam; regression coverage in [`test/runner-approval.test.ts`](../../test/runner-approval.test.ts). | Does not prove an Agent Package contains sufficient or correct context. |
| AC-003 | Enforced | The OpenCode Adapter rejects undeclared files and symbolic-link escapes produced during a File Job. | Current OpenCode V2 candidate-inspection seam; regression coverage in [`test/open-code-adapter.test.ts`](../../test/open-code-adapter.test.ts). | Does not establish equivalent containment for an untested Runtime Adapter. |
| AC-004 | Enforced | Repository application rejects candidate digest mismatch and applies one complete integrity-checked candidate set to approved targets as one guarded operation. | Current repository-application seam; regression coverage in [`test/repository-application.test.ts`](../../test/repository-application.test.ts). | Does not claim project compilation, tests, runtime behavior, staging, or deployment. |
| AC-005 | Enforced | A changed approved target blocks complete-set application. | Current final target-state check; regression coverage in [`test/repository-application.test.ts`](../../test/repository-application.test.ts) and [`test/guided-start.test.ts`](../../test/guided-start.test.ts). | Does not prohibit unrelated repository changes that are outside the approved targets. |
| AC-006 | Enforced | The canonical HTML review is a deterministic presentation of stored review facts and exact Agent Brief content. | Current renderer seam; regression coverage in [`test/render.test.ts`](../../test/render.test.ts) and the immutable review snapshot pair. | Does not prove that a review is easy to understand or that its plan is correct. |
| AC-007 | Demonstrated | One reviewed single-file create Agent produced and SCORE atomically applied `src/declaration-shape.ts`. | Pass `a92b1d68-e478-4b58-b3f6-4c5a62e1b7df`; Run `5a5f574a-f2a5-49d0-a654-618965ee3951`; candidate digest `sha256:8f97ad387560a0fef435ab8801d2554cb83301f84ee605011006ba8a56660791`. | The completed acceptance harness later exposed a missed rest-parameter requirement, so this was delivery evidence, not accepted implementation evidence. |
| AC-008 | Demonstrated | One reviewed single-file corrective revision repaired the observed rest-parameter defect without manual production editing. | Pass `27cc72ac-e763-4270-9682-6fdd40721c41`; Run `f6cc8d72-bd1e-4ad6-bd38-b7f815c5bfe0`; final candidate digest `sha256:1d1d1561f8b989a4e5bf0fc4e1f1dc926ebefd70cee905178d16847a362ae400`; full history in the [experiment record](../experiments/declaration-shape-normalizer.md). | One successful correction does not establish first-pass plan correctness or long-term model reliability. |
| AC-009 | Verified | The revision 2 declaration normalizer passed its independent public-interface harness, and `inspect-module --closure` reproduced its complete approved export with no supporting declarations. | Exact candidate digest from AC-008; commands recorded in the [experiment record](../experiments/declaration-shape-normalizer.md). | This verifies only the bounded declaration subset in that revision, not later candidates or the planned Declaration Evidence system. |
| AC-010 | Verified | The post-correction worktree passed TypeScript typecheck, build, all 316 tests, and the whitespace-error check. | Verification executed immediately after Run `f6cc8d72-bd1e-4ad6-bd38-b7f815c5bfe0`; branch `plan/pi-adapter`; HEAD `6aed0233ce6351de8ede893a95d69e3d626f86bb`; commands recorded in the [experiment record](../experiments/declaration-shape-normalizer.md). | The worktree contained unrelated uncommitted changes, so this is not a clean-commit, package-release, merge, deployment, or hosted-acceptance claim. |
| AC-011 | Demonstrated | One reviewed single-file revision deepened the accepted normalizer with bounded primitive, named-reference, and flat-union type aliases without manual production editing. | Pass `5d54659b-995b-41ab-9059-574b0548a8b3`; Run `eff11baa-476b-488d-98aa-d4c97323c3e3`; one Attempt; candidate digest `sha256:217c6e301757a55e96ef885df27f2f07ee7551649be75be02c2a17b33a0b3673`; full history in the [experiment record](../experiments/declaration-shape-normalizer.md). | This one run does not establish general first-pass reliability, multi-file integration, or support for arbitrary TypeScript declarations. |
| AC-012 | Verified | The revision 3 normalizer preserved the accepted function cases, normalized the reviewed type-alias cases, rejected the explicitly excluded forms, and preserved flat-union member order. | Independent harness and requirement-level probes executed against the exact AC-011 candidate; `inspect-module --closure` reproduced the complete public export with no supporting declarations. | These bounded structural checks do not establish TypeScript assignability, semantic typechecking, declaration closure, or preparation integration. |
| AC-013 | Verified | The revision 3 worktree passed TypeScript typecheck, build, all 316 tests, and the whitespace-error check. | Verification executed immediately after Run `eff11baa-476b-488d-98aa-d4c97323c3e3`; commands and source digest recorded in the [experiment record](../experiments/declaration-shape-normalizer.md). | The worktree contained unrelated uncommitted changes, so this is not a clean-commit, package-release, merge, deployment, or hosted-acceptance claim. |
| AC-014 | Verified | The experimental pathless assigned-file checker deterministically rejects the observed private-return-alias substitution, accepts the exact reviewed inline declaration, and returns byte-identical verdicts for identical inputs. | Focused pure-model and MCP protocol regression coverage; reproduction commands and boundary are recorded in the [preflight experiment](../experiments/agent-assigned-file-preflight.md). | This is prototype verification, not a production Candidate Declaration Gate or a claim about unsupported TypeScript syntax. |
| AC-015 | Demonstrated | One Terra-medium file Agent used the job-bound checker to observe an exact declaration mismatch, repair it, receive a valid result, and finish in the same invocation; an independent check reproduced the final verdict digest. | Observed sequence `invalid → valid`; verdict digest `sha256:480daf5128cbc5a835fd9625e8af360e06c14434fc21ddc40a65973ba3ef169e`; candidate digest `sha256:ad62e9697a8787912159eef0eb2b24dfaed750672fc32d5d3aaa5955b92a2f5a`; full record in the [preflight experiment](../experiments/agent-assigned-file-preflight.md). | One controlled run does not establish universal instruction-following, production completion enforcement, retry behavior, or long-term reliability. |
| AC-016 | Verified | The opt-in OpenCode Adapter experiment independently accepts valid final bytes without a preflight call and rejects invalid final bytes, including bytes edited after an earlier valid check. | Public `RuntimeAdapter.invoke` regression coverage binds the checker result and returned File Candidate to the same candidate digest; exact cases and reproduction are recorded in the [final-candidate experiment](../experiments/final-candidate-declaration-check.md). | This prototype check is not enabled for production File Jobs and does not establish complete-set gate, persistence, repair, or general TypeScript behavior. |
| AC-017 | Verified | The opt-in OpenCode Adapter experiment can send one deterministic typed repair continuation to the same session only after an invalid first candidate, accept repaired valid final bytes, and fail closed without a third prompt when repair remains invalid. | Public `RuntimeAdapter.invoke` regression coverage exercises valid-first, invalid-to-valid, and invalid-to-invalid cases; the [automatic-repair experiment](../experiments/automatic-declaration-repair-loop.md) records the exact seam and cost boundary. | This deterministic harness does not prove that a real model will repair every finding or that production Jobs receive automatic repair. |
| AC-018 | Verified | For one Agent Brief with one owned declaration, the verifier and bounded repair configuration can be derived solely from the exact approved revision and claimed Job, with a frozen digest-bound result. | Real Change preparation, approval, approved export, substitution cases, and public `RuntimeAdapter.invoke` coverage are recorded in the [approved-input binding experiment](../experiments/approved-declaration-input-binding.md). | This prototype does not prove automatic production Runner binding, several declarations, or multi-file candidate-set verification. |
| AC-019 | Verified | One approved Agent Brief can bind two owned declarations, check both against the same exact candidate bytes, report only the failing declaration, repair once, and independently accept the corrected final candidate. | Approved-order binding, aggregate model checks, and public `RuntimeAdapter.invoke` coverage are recorded in the [multi-declaration experiment](../experiments/approved-multi-declaration-verification.md). | This is still a deterministic prototype, not production candidate admission or a multi-file gate. |
| AC-020 | Enforced | In the current dirty worktree, the OpenCode Adapter cannot return a successful create or replace File Candidate with a non-empty supported owned-declaration list unless SCORE checks the exact captured bytes and returns a valid declaration verdict. | Production `readCandidate`-to-success seam in [`src/runner/open-code-adapter.ts`](../../src/runner/open-code-adapter.ts), pure gate in [`src/runner/candidate-declaration-gate.ts`](../../src/runner/candidate-declaration-gate.ts), and focused regression coverage in [`test/runner-candidate-declaration-gate.test.ts`](../../test/runner-candidate-declaration-gate.test.ts). Failed verdict evidence is sanitized, persisted through the existing Failure Evidence path, and rendered without source bytes. | Does not cover another Runtime Adapter, empty or absent declaration inputs, imported declaration source routing, unsupported TypeScript semantics, multi-file completeness, or target-project correctness. The forward-only profile/package activation is not implemented. |
| AC-021 | Verified | After local integration repair, the current dirty worktree passes TypeScript typecheck, build, all 340 tests, package smoke testing, and the whitespace-error check. | `npm run typecheck`; `npm run build`; `npm test` (340 pass, 0 fail); `npm run test:package`; `git diff --check`, executed after Run `50d78e0b-0bbc-4ac2-8849-12e414066bf2` and the documented local repairs. | The original six applied candidates did not pass repository verification, and the current source is not byte-identical to them. This is not a clean-commit, release, imported-routing, semantic-correctness, deployment, or user-acceptance claim. |
| AC-022 | Enforced | Trusted preparation accepts external declaration evidence only for explicitly reviewed public members of one lock-bound installed package and freezes at most one direct supporting layer. | [`src/external-declaration-evidence.ts`](../../src/external-declaration-evidence.ts), shared Plan Intake binding, and nine focused cases in [`test/external-declaration-evidence.test.ts`](../../test/external-declaration-evidence.test.ts), including Effect, conditional exports, `typesVersions`, pre-review typed refusal, deterministic bytes, source preservation, and symlink rejection. | Does not support every package layout, recursively close a dependency type graph, cross into another package, or prove candidate package usage, assignability, compilation, or behavior. |
| AC-023 | Verified | The forward-only alpha.5/alpha.6 worktree with selected external declaration evidence passes typecheck, build, all 349 tests, package smoke testing, and the whitespace-error check. | `npm run typecheck`; `npm run build`; `npm test` (349 pass, 0 fail); `npm run test:package`; `git diff --check`, executed after D-094 and ADR-0014 reconciliation. | This dirty worktree is not a clean commit, release, multi-file declaration gate, project-local imported-source-routing proof, deployment, or user-acceptance result. |
| AC-024 | Verified | In one deterministic two-file experiment, a wrong consumed-declaration route blames only the consumer, retains the exact owner candidate, leaves the repository unchanged after rejection, retries only the consumer, rechecks the complete set, and applies both files together. | Public experiment seam in [`src/prototypes/cross-file-declaration-route-retry.ts`](../../src/prototypes/cross-file-declaration-route-retry.ts); regression coverage in [`test/cross-file-declaration-route-retry.test.ts`](../../test/cross-file-declaration-route-retry.test.ts); exact observations in the [experiment record](../experiments/cross-file-declaration-route-retry.md). The focused check, typecheck, build, all 350 tests, package smoke test, and whitespace-error check passed. | This is not production Runner behavior. The reviewed consumed-declaration source route is supplied directly to the experiment because current approved Agent Input does not preserve it. It does not prove general TypeScript integration, project correctness, or arbitrary multi-file blame. |

## Explicitly outside the envelope

| ID | Status | Non-Claim | Evidence needed to reconsider it |
| --- | --- | --- | --- |
| NC-001 | Unproven | SCORE plans are always complete or correct. | Repeated plan-quality evaluation with independently complete acceptance coverage; revision 1 of the normalizer experiment is direct counterevidence to a universal claim. |
| NC-002 | Unproven | An acceptance harness always covers every reviewed requirement. | Deterministic requirement-to-check traceability that fails preparation or approval when a promised behavior lacks a check. |
| NC-003 | Unproven | Independently generated multi-file candidates always integrate correctly. | Controlled multi-file experiments with complete cross-file contracts and pre-application or exact post-application project verification. |
| NC-004 | Unproven | Passing declared checks proves complete behavioral correctness. | No finite bounded check supports this universal claim; every Verification Result must retain its criterion boundary. |
| NC-005 | Unproven | A successful Agent or model run predicts long-term reliability. | Repeated controlled trials across fixed workloads, runtimes, models, and failure classes. |
| NC-006 | Unproven | The complete Declaration Evidence preparation and candidate-gate design works in production. | AC-022 proves only selected locked external-package evidence. Project-local existing, greenfield, and mixed preparation evidence, complete Agent Brief routing, candidate conformance, and separately bounded target-project verification remain required. |
| NC-007 | Unproven | The current dirty worktree is release-ready, merged, deployed, or accepted by users. | Curated commit state plus the separate package, review, merge, deployment, and user-acceptance evidence appropriate to the release. |
| NC-008 | Unproven | Every applied candidate conforms to its frozen documented declaration. | Revision 4 of the [normalizer experiment](../experiments/declaration-shape-normalizer.md) is direct counterevidence: behavior, typecheck, build, and 316 tests passed while closure inspection rejected the private `Result` alias. A deterministic candidate declaration gate is needed to enforce this claim. |
| NC-009 | Unproven | Every production File Job receives or successfully uses in-session declaration feedback. | The [preflight experiment](../experiments/agent-assigned-file-preflight.md) is explicitly opt-in and records two diagnostic runs without tool use before the availability seam was corrected. Production feedback remains undecided and must not become a correctness dependency. |
| NC-010 | Unproven | Every production File Candidate returned by every Runtime Adapter and historical Profile has passed an independent declaration check against its exact final bytes. | AC-020 covers only the current dirty-worktree OpenCode seam for non-empty supported owned declarations. Forward-only activation is now enforced for new work, but other adapters, imported project-local source routing, package-API usage verification, historical records, and complete-set enforcement remain outside the claim. |
| NC-011 | Unproven | Every applied SCORE candidate set typechecks, compiles, builds, or passes the target project's tests. | The current Runner deliberately performs none of these checks. After the declaration track, investigate exact candidate-bound checks through the [real-project verification research track](../features/real-project-verification.md). |
| NC-012 | Unproven | Every invalid production File Candidate automatically receives and successfully completes an in-session repair. | The [automatic-repair experiment](../experiments/automatic-declaration-repair-loop.md) is opt-in, bounded to one declaration case, and uses a deterministic fake runtime. Production policy, durable evidence, and live-model behavior remain unproven. |
| NC-013 | Unproven | Every production verifier and repair input is automatically derived from its exact approved revision. | The [approved-input binding](../experiments/approved-declaration-input-binding.md) and [multi-declaration](../experiments/approved-multi-declaration-verification.md) experiments prove the prototype seam for one Agent Brief. Production Runner invocation, durable storage, arbitrary relevant declarations, and complete candidate-set enforcement remain unproven. |

## Reproduction

Run the current deterministic repository checks from the project root:

```sh
npm run typecheck
npm run build
npm test
npm run test:package
git diff --check
```

Run the declaration-normalizer evidence separately:

```sh
npx tsx .score/experiments/declaration-shape-harness.ts
npx tsx src/cli.ts inspect-module src/declaration-shape.ts \
  --export normalizeDeclarationShape \
  --closure
npm run runner -- status
npm run experiment:agent-preflight:mcp-smoke
npm run experiment:final-candidate-check
npm run experiment:automatic-repair
npm run experiment:approved-input-binding
npm run experiment:approved-multi-declaration
npm run experiment:cross-file-route-retry
npm exec -- tsx --test test/external-declaration-evidence.test.ts
```

The harness is intentionally private local experiment state under `.score` and
is not publishable repository evidence by itself. The durable experiment record
contains its expected behavior and exact observed outcomes.

## Maintenance rule

- Add a claim only after evidence exists.
- Preserve failed and superseded evidence; do not rewrite it into success.
- Narrow or remove a claim when its supporting seam changes or reproduction
  fails.
- Keep intended features in the feature roadmap, not in the Assurance Envelope.
- Keep release, deployment, and user acceptance as separate claims.
