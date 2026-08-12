# Agent-authored Change dogfood — August 11, 2026

This was a real installed-package and real-model test, not a mocked integration
test. SCORE was packed into a tarball, installed in this fixture, and invoked
only through the installed `score` executable.

## What was tested

- One Change coordinating one existing file and two new files.
- Strict stdin JSON, generated identity, immutable review artifacts, and an
  idempotent resubmission with the returned `changeId`.
- The generated HTML review in the in-app browser at desktop and phone widths.
- A guided cancellation before approval.
- Searchable model selection, reasoning selection, final confirmation, live
  per-file observations, retained status, and atomic application.
- A superseding v2 revision after the first applied implementation failed the
  fixture's real project checks.
- TypeScript checking, build output, and behavioral acceptance after v2.

## Runs

Both paid Runs used GPT-5.6 Terra through OpenCode Zen with Medium reasoning.

| Revision | Run ID | Live time | SCORE result | Project result |
| --- | --- | ---: | --- | --- |
| v1 | `redacted` | 10s | 3/3 candidates applied atomically | Failed NodeNext import checks |
| v2 | `redacted` | 8s | 3/3 candidates applied atomically | Typecheck, build, and acceptance passed |

The v1 behavior was functionally close, but it omitted required `.js` relative
import specifiers and imported `Reading` through the wrong module. The original
Change did not provide `tsconfig.json` or a NodeNext skill, so the missing
extensions were an authoring-context failure. Importing `Reading` from a module
other than its declared owner was also a model-quality failure.

The v2 review froze the failed v1 source, supplied `tsconfig.json`, named the
exact owner modules and import statements, and preserved all behavioral
requirements. Terra then produced the exact owner imports. The independent QA
covered zero and negative totals, negative and excessive progress, floor
rounding, exact aggregate text, remaining-page math, and input immutability.
The retained resettable fixture input now includes the successful NodeNext and
owner-import guidance so a future first revision tests the learned contract
rather than deliberately repeating the v1 authoring omission.

## Actual product defects found

1. Fast model search could render and confirm GPT-5.6 Terra while returning the
   first unfiltered model internally. The original guided flow then offered no
   Terra reasoning prompt and proposed Nemotron in the final confirmation. The
   Run was declined, so nothing was approved or started. A public prompt-level
   regression now reproduces the one-write `Terra` + Enter race, and the fixed
   prompt keeps the returned model bound to the newest visible result.
2. Printed/PDF reviews omitted every default-collapsed File Brief and audit
   body. Reviews now open every disclosure for printing and restore the prior
   screen state afterward, with a renderer regression and browser verification.

## Final fixed-worktree verification

After both fixes, SCORE was rebuilt, packed, and reinstalled in this fixture.
The final generated review used renderer `0.1.0-alpha.19`. In the in-app browser,
the print lifecycle opened all 18 disclosures, temporarily removed the three
accordion group names, rendered the File Brief contents, and then restored every
original open state and group name exactly.

The final installed guided flow was also exercised without starting another
paid Run. A single input write containing `Terra` and Enter visibly selected
GPT-5.6 Terra, offered its reasoning variants, and produced a final confirmation
for GPT-5.6 Terra through OpenCode Zen with Medium reasoning. That confirmation
was declined. The installed CLI then reported zero Runs, zero Jobs, and zero
Attempts, and neither create target existed.

Final repository gates on this exact worktree:

- `npm run typecheck`: passed.
- `npm test`: 219 tests passed across 26 suites.
- `npm run test:package`: passed from a freshly packed and installed tarball.
- `git diff --check`: passed.

## Experience concerns to discuss

- The HTML review is readable and responsive, but approval readiness is buried
  in the collapsed audit and the page does not tell the reviewer the next CLI
  command.
- A Change review still calls itself a Plan Review, and authored `modify`
  operations appear as `Replace`.
- Collapsed file rows omit their purpose. Inside an open row, requirements are
  shown only as `R1`/`R2`/`R3`, and consumed declarations do not display their
  owner paths. Reviewing cross-file meaning therefore requires jumping around.
- The file order was consumer-first rather than dependency-first.
- Formal declaration routing forced the already-correct owner file into the v2
  repair Change so both consumer declarations could resolve.
- The CLI returns an HTML path but does not open it or point directly to
  `score start`. `score status` also requires the exact Run ID instead of
  offering a latest-Run default.
- npm 11 warned that dependency install scripts were not on its allow-scripts
  list, even though the installed OpenCode executable worked in this test.

Those concerns were intentionally not redesigned during dogfood. They should be
discussed as product choices rather than folded into an unrelated bug fix.

## Post-dogfood UX follow-up

The agreed follow-up was then implemented and exercised again through a freshly
packed and installed SCORE CLI. The same clean fixture prepared a new revision-1
Change Review with renderer `0.1.0-alpha.20` and returned the structured next
action `{ "command": "score start", "condition": "after_review" }`.

The generated review now:

- identifies itself as a Change Review;
- puts `Ready for approval` and `score start` at the top;
- displays `Modify` and `Create` without changing canonical operation data;
- shows a dependency-first File/Action/Purpose/Uses table;
- includes complete requirement statements, context purposes, and declaration
  owner paths inside each File Brief;
- keeps the complete frozen existing target available in its collapsed context;
- states that implementation quality is evaluated outside SCORE instead of
  implying that SCORE will run project checks.

The installed `score doctor` human and JSON modes both returned `ready` while
discovering 88 enabled models. Their retained safety facts reported zero model
requests and no project or persistent SCORE writes. Before any Run existed,
`score status` without `--run` failed with the intended current-project message
instead of selecting unrelated global history.

Final deterministic gates on the completed worktree:

- `npm run typecheck`: passed.
- `npm test`: 232 tests passed across 27 suites.
- `npm run test:package`: passed from a freshly packed and installed tarball.
- `git diff --check`: passed.
- The Impeccable mechanical UI detector returned no findings for
  `src/render.ts`.

## Final review hardening

A final independent Spec and Standards review found several deterministic
edge cases after that installed UX exercise. The settled implementation now
uses renderer `0.1.0-alpha.21`, includes `humanApprovalRequired: true` in a
successful Change response, shows each File Brief purpose while collapsed, and
defines Change Review and Slice Review as entity-specific presentations of the
protocol-level Plan Review.

Doctor now rejects conflicting `.score` and `score.db` paths without writing
them, validates supported credential record shapes without retaining or
rendering secrets, checks every packaged migration, and exposes only `doctor`
and `--json` as public arguments. The package smoke test exercises Doctor
deterministically without contacting a live catalog.

The final tarball was also installed into this clean fixture and
`score doctor --json` returned `ready` with 88 enabled models from one provider.
It reported zero model requests and created no `.score` state.

Final post-review gates on the exact commit candidate:

- `npm run typecheck`: passed.
- `npm test`: 239 tests passed across 28 suites.
- `npm run test:package`: passed from a freshly packed and installed tarball.
- `git diff --check`: passed.
