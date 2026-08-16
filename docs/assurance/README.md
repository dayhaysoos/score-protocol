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
| AC-009 | Verified | The final declaration normalizer passes its independent public-interface harness, and `inspect-module --closure` reproduces its complete approved export with no supporting declarations. | Exact candidate digest from AC-008; commands recorded in the [experiment record](../experiments/declaration-shape-normalizer.md). | This verifies only the bounded declaration subset in that harness, not the planned Declaration Evidence system. |
| AC-010 | Verified | The post-correction worktree passed TypeScript typecheck, build, all 316 tests, and the whitespace-error check. | Verification executed immediately after Run `f6cc8d72-bd1e-4ad6-bd38-b7f815c5bfe0`; branch `plan/pi-adapter`; HEAD `6aed0233ce6351de8ede893a95d69e3d626f86bb`; commands recorded in the [experiment record](../experiments/declaration-shape-normalizer.md). | The worktree contained unrelated uncommitted changes, so this is not a clean-commit, package-release, merge, deployment, or hosted-acceptance claim. |
| AC-011 | Demonstrated | One reviewed single-file revision deepened the accepted normalizer with bounded primitive, named-reference, and flat-union type aliases without manual production editing. | Pass `5d54659b-995b-41ab-9059-574b0548a8b3`; Run `eff11baa-476b-488d-98aa-d4c97323c3e3`; one Attempt; candidate digest `sha256:217c6e301757a55e96ef885df27f2f07ee7551649be75be02c2a17b33a0b3673`; full history in the [experiment record](../experiments/declaration-shape-normalizer.md). | This one run does not establish general first-pass reliability, multi-file integration, or support for arbitrary TypeScript declarations. |
| AC-012 | Verified | The revision 3 normalizer preserved the accepted function cases, normalized the reviewed type-alias cases, rejected the explicitly excluded forms, and preserved flat-union member order. | Independent harness and requirement-level probes executed against the exact AC-011 candidate; `inspect-module --closure` reproduced the complete public export with no supporting declarations. | These bounded structural checks do not establish TypeScript assignability, semantic typechecking, declaration closure, or preparation integration. |
| AC-013 | Verified | The revision 3 worktree passed TypeScript typecheck, build, all 316 tests, and the whitespace-error check. | Verification executed immediately after Run `eff11baa-476b-488d-98aa-d4c97323c3e3`; commands and source digest recorded in the [experiment record](../experiments/declaration-shape-normalizer.md). | The worktree contained unrelated uncommitted changes, so this is not a clean-commit, package-release, merge, deployment, or hosted-acceptance claim. |

## Explicitly outside the envelope

| ID | Status | Non-Claim | Evidence needed to reconsider it |
| --- | --- | --- | --- |
| NC-001 | Unproven | SCORE plans are always complete or correct. | Repeated plan-quality evaluation with independently complete acceptance coverage; revision 1 of the normalizer experiment is direct counterevidence to a universal claim. |
| NC-002 | Unproven | An acceptance harness always covers every reviewed requirement. | Deterministic requirement-to-check traceability that fails preparation or approval when a promised behavior lacks a check. |
| NC-003 | Unproven | Independently generated multi-file candidates always integrate correctly. | Controlled multi-file experiments with complete cross-file contracts and pre-application or exact post-application project verification. |
| NC-004 | Unproven | Passing declared checks proves complete behavioral correctness. | No finite bounded check supports this universal claim; every Verification Result must retain its criterion boundary. |
| NC-005 | Unproven | A successful Agent or model run predicts long-term reliability. | Repeated controlled trials across fixed workloads, runtimes, models, and failure classes. |
| NC-006 | Unproven | The complete Declaration Evidence preparation and candidate-gate design works in production. | Sequential Slices proving preparation evidence, Agent Brief routing, candidate conformance, and target-project verification without expanding the current experiment's claim. |
| NC-007 | Unproven | The current dirty worktree is release-ready, merged, deployed, or accepted by users. | Curated commit state plus the separate package, review, merge, deployment, and user-acceptance evidence appropriate to the release. |

## Reproduction

Run the current deterministic repository checks from the project root:

```sh
npm run typecheck
npm run build
npm test
git diff --check
```

Run the declaration-normalizer evidence separately:

```sh
npx tsx .score/experiments/declaration-shape-harness.ts
npx tsx src/cli.ts inspect-module src/declaration-shape.ts \
  --export normalizeDeclarationShape \
  --closure
npm run runner -- status
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
