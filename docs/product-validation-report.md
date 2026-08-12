# SCORE Protocol product-validation report

Validation date: 2026-08-09 EDT (stored evidence spans 2026-08-10 UTC)

## 1. Executive summary

SCORE is technically credible and internally consistent across its central delivery contract. Fresh preparation did not touch application sources; HTML reviews were deterministic and readable; approval did not claim implementation or project verification; isolated per-file Jobs produced candidate sets; target drift and Job failures failed closed; successful candidate sets were applied atomically as ordinary unstaged changes; stable slice identities produced immutable revisions; and ordered slices unblocked only after the exact predecessor revision was applied.

The strongest result is the separation of delivery from product correctness. Several live model attempts produced invalid or semantically wrong code. SCORE either rejected those candidates before application, applied nothing when one Job failed, or truthfully reported only that candidates had been generated and applied. Real project typechecking then caught two cross-file prop-name errors that SCORE intentionally did not claim to verify. This boundary behaved as documented.

The largest risks are not confirmed Core or Runner correctness defects. They are model/context reliability and first-time-user friction:

- A small realistic React application required multiple retries and two fixture-plan revisions before all generated files both passed SCORE and passed the real project checks.
- One lower-capability model produced declaration-compatible but behaviorally wrong code; SCORE correctly could not infer that semantic failure from its deterministic declaration checks.
- The Runner has a bounded 30-minute model deadline but no periodic per-Job progress, so a slow provider can look idle.
- Recovery after a real SIGINT was safe, but the first work retry returned a generic RunnerStoreError instead of the documented RunRecoveryRequired wording.
- The exact persisted-candidate-missing corruption case is not directly covered by an existing Runner-level failure-injection test.
- Actual keyboard activation in the browser remained blocked by the validation environment: native controls and focus were visible, but the in-app browser did not deliver synthetic Enter/Space activation, and the physical computer-control fallback could not proceed while the Mac was locked.

No confirmed SCORE product defect was found at baseline. The report does identify documentation/UX defects, model-output defects, plan/context defects in the validation fixture, expected strict behavior, and one environment blocker.

## 2. Overall launch-readiness score

**7/10**

SCORE is ready for a controlled alpha with technically capable users who understand that:

1. Plan approval freezes instructions; it does not verify an implementation.
2. SCORE verifies its own delivery and integrity contract, not the target project.
3. Project typecheck/build/tests and human acceptance remain mandatory after application.
4. Model retries and plan refinement are normal when cross-file behavior is subtle.

It is not ready for a broad self-serve launch where users may interpret successful application as a verified product result or may assume that a quiet terminal is hung.

## 3. Exact baseline and environment

| Item | Evidence |
|---|---|
| Requested baseline | 41025c5 chore: align repository with current SCORE workflow |
| Exact commit | 41025c5f4e5d963d301af6838139b21efa41ffbe |
| Validation branch | product-validation-2026-08-09 |
| Starting branch/state | clean main at the requested commit; no staged or unstaged files |
| Final Git state | same commit; no staged files; only untracked validation fixtures and this report |
| Primary worktree | Current SCORE repository root |
| Preserved other worktree | Separate disposable worktree retained during validation |
| OS | macOS 26.5.2 (25F84), arm64 |
| Node | v26.5.0 |
| npm | 11.17.0 |
| OpenCode CLI/SDK | 1.18.14 / 1.18.14 |
| Connected providers at discovery | opencode (OpenCode Zen), anthropic (Anthropic) |

Baseline confirmation commands:

    git status --short
    git branch --show-current
    git rev-parse HEAD
    git switch -c product-validation-2026-08-09
    git worktree list --porcelain
    sw_vers
    uname -m
    node --version
    npm --version
    ./node_modules/.bin/opencode --version

Baseline and final product gates:

    npm ci
    npm test
    npm run typecheck
    npm run build
    npm run reproduce

Results:

- npm test: 154 passed, 0 failed, 23 suites. The final rerun completed in 5.23 seconds.
- npm run typecheck: passed.
- npm run build: passed.
- npm run reproduce: passed.
- Reproduction review ID: redacted.
- Reproduction pass ID: redacted.

The validation did not stage, commit, merge, push, or open a pull request. No SCORE implementation source was changed.

## 4. Scenario matrix

| # | Scenario | Status | Direct basis |
|---:|---|---|---|
| 1 | Fresh preparation and execution | **Pass** | Three-file TypeScript chain prepared without source mutation, reviewed, approved, generated, atomically applied, then typechecked/built/QA-checked successfully. |
| 2 | Editable revisions | **Pass** | Same slice_id produced immutable v1/v2; title change retained identity; unchanged preparation reused v2; both reviews remain inspectable. |
| 3 | Multiple ordered slices | **Pass** | A alone prepared; approval alone did not unblock B; exact applied A unblocked B; B bytes fed its preparation; B application unblocked C; cumulative behavior passed checks. |
| 4 | Dependency-graph errors | **Pass** | Five isolated malformed fixtures returned the exact typed graph finding before database/review creation. |
| 5 | Rerunning a slice | **Pass** | Unchanged, changed, missing, occupied, and valid replacement states were shown and bound; each confirmed state applied completely; prior SCORE-output recognition was not required. |
| 6 | Drift and atomicity | **Partial** | Strong deterministic coverage plus a real interrupted Run; one exact gap remains: no direct Runner-level corruption test removing a persisted candidate from an otherwise completed multi-file Run. |
| 7 | Model/provider/variant behavior | **Pass** | Live connected catalog, four invoked models, multiple variants/default/no-variant/opaque max, invalid preflight with no Run, stored timings and diagnostics. |
| 8 | Larger realistic application | **Partial** | Final 8-file React app passed typecheck/build/QA and browser interaction/mobile review, but required plan corrections and model retries; physical keyboard activation remained blocked. |
| 9 | Human experience | **Partial** | Review and confirmation are clear and truthful; model discovery/progress/recovery language still creates avoidable friction. |

There were no fully failed scenarios. Partial means the requested area had a material evidence gap or required corrective iteration, not that SCORE applied a known-invalid partial candidate set.

## 5. Commands and evidence by scenario

### Scenario 1 — fresh preparation and execution

Fixture: examples/product-validation/fresh-typescript

Shape:

- src/product.ts creates the Product contract.
- src/format-product.ts consumes Product and formats a price.
- src/catalog-summary.ts consumes Product and formatProduct and summarizes featured products.
- docs/product-intent.md is read-only context routed to all three targets.
- No automated test was placed in the SCORE slice. qa/acceptance.mjs remained a separate QA-owned check.

Commands:

    npm run score:prepare
    npm run score:list
    npm run score:start
    npm run typecheck
    npm run build
    npm run qa

Guided selection:

- Provider: opencode / OpenCode Zen.
- Model: longcat-2.0-free / LongCat-2.0 Free.
- Variant: low.

Evidence:

- Before preparation, src did not exist. Preparation left it absent.
- Review scope said “3 files will change” and “3 new · 3 isolated file-agents”; it did not count the one context document as a target.
- Review target paths were exactly src/catalog-summary.ts, src/format-product.ts, and src/product.ts.
- The first expanded file row showed purpose, requirements, owned and consumed declarations, context, selected skills, file access, prohibited access, rules, and exact machine evidence.
- Approval copy said: “Approval freezes these instructions. It does not run them.”
- Review header said “No decision recorded.”
- Browser inspection confirmed the review was usable at desktop width and 320 px without horizontal overflow.
- Guided confirmation named the exact repository root and listed each target on its own line.
- Run redacted completed in 27.806 seconds.
- The success message said all three candidates were generated and applied. It did not claim typecheck, build, tests, or project verification.
- All three generated files were ordinary unstaged files.
- Real typecheck, build, and QA passed afterward.

Prepared IDs:

| Value | ID |
|---|---|
| slice_id | featured-catalog-summary |
| Revision | 1 |
| Change Plan / pass | redacted |
| Manifest | redacted |
| Review | redacted |
| Run | redacted |

Classification: **Expected behavior**. Anything applied: yes, the complete three-file set.

### Scenario 2 — editable revisions

Fixture: examples/product-validation/editable-revisions

Commands:

    npm run score:prepare
    shasum -a 256 src/greeting.ts
    # edit the same draft while retaining slice_id stable-greeting
    npm run score:prepare
    npm run score:prepare
    ../../../node_modules/.bin/tsx ../../../src/runner/cli.ts list --score-db .score/score.db --runner-db .score/runner.db
    sqlite3 -readonly .score/score.db 'SELECT slice_id, display_title, revision, manifest_id, review_id, artifact_stem FROM v_prepared_slice_revisions ORDER BY revision;'

Evidence:

- Source digest remained 9e3203... throughout preparation.
- v1 title: Friendly greeting.
- v2 title: Warm greeting.
- Both rows retain slice_id stable-greeting.
- Changed title/objective/requirements/file instructions created v2; it did not mutate v1.
- A third unchanged prepare returned the same v2 IDs and created no v3.
- Normal Runner listing exposed only Warm greeting v2 as Ready.
- Historical artifacts remain:
  - .score/reviews/friendly-greeting-review.html
  - .score/reviews/friendly-greeting-review.snapshot.json
  - .score/reviews/friendly-greeting-review-v2.html
  - .score/reviews/friendly-greeting-review-v2.snapshot.json

Revision ledger:

| Rev | Title | Pass | Manifest | Review |
|---:|---|---|---|---|
| 1 | Friendly greeting | redacted | redacted | redacted |
| 2 | Warm greeting | redacted | redacted | redacted |

Classification: **Expected behavior**. Anything applied: no; this scenario stopped at preparation/listing.

### Scenario 3 — multiple ordered slices

Fixture: examples/product-validation/ordered-slices

All three drafts intentionally target src/pipeline.ts:

- A / pipeline-foundation creates baseMessage.
- B / pipeline-emphasis follows A and adds emphasize.
- C / pipeline-summary follows B and adds summarize.

Commands:

    npm run score:prepare
    npm run score:list
    # approval-only proof used the exported ScoreAlpha approval API for A
    npm run score:prepare
    npm run score:start
    npm run score:prepare
    npm run score:start
    npm run score:prepare
    npm run score:start
    npm run typecheck
    npm run build
    npm run qa
    sqlite3 -readonly .score/score.db 'SELECT dependent_manifest_id, prerequisite_slice_id, prerequisite_revision, prerequisite_pass_id, prerequisite_run_id FROM prepared_slice_dependencies ORDER BY dependent_manifest_id;'

Evidence:

1. Initial preparation produced A only. B reported waiting for pipeline-foundation; C reported waiting for pipeline-emphasis.
2. A was approved without execution. Decision ID: redacted.
3. Preparing again still left B and C waiting. Approval alone did not unblock.
4. Applying exact A Run redacted unblocked B.
5. B’s repository snapshot contained the actual A-generated bytes, and prepared_slice_dependencies bound A revision 1, its pass, and its Run.
6. Applying exact B Run redacted unblocked C.
7. C bound B’s exact applied revision/pass/Run.
8. Each slice remained a separate Change Plan and Run. No combined agent workspace or temporary combined project appeared in the fixture.
9. Final src/pipeline.ts contained baseMessage, emphasize, and summarize in the intended order; typecheck, build, and QA passed.

Ledger:

| Slice | Pass | Manifest | Review | Run | Model/variant |
|---|---|---|---|---|---|
| pipeline-foundation | redacted | redacted | redacted | redacted | LongCat high |
| pipeline-emphasis | redacted | redacted | redacted | redacted | LongCat default |
| pipeline-summary | redacted | redacted | redacted | redacted | Ling, no variant |

Classification: **Expected behavior**. Anything applied: yes, one complete one-file candidate set per Run.

### Scenario 4 — dependency-graph errors

Fixture: examples/product-validation/graph-errors

Command:

    cd examples/product-validation/graph-errors
    ../../../node_modules/.bin/tsx run.mjs

Results:

| Isolated fixture | Finding | Database created | Reviews created | Partial state |
|---|---|---:|---:|---|
| duplicate-id | SLICE_ID_DUPLICATE | no | 0 | none |
| missing-predecessor | SLICE_DEPENDENCY_MISSING | no | 0 | none |
| self-dependency | SLICE_DEPENDENCY_SELF | no | 0 | none |
| dependency-cycle | SLICE_DEPENDENCY_CYCLE | no | 0 | none |
| unordered-shared-target | SLICE_TARGET_ORDER_AMBIGUOUS | no | 0 | none |

Each message named the relevant slice/path or cycle/shared target. Every failure occurred before review, approval, execution, or application.

Additional deterministic command:

    ./node_modules/.bin/tsx --test test/slice-draft-graph.test.ts test/plan-intake-set.test.ts

Result: 5 passed, 0 failed. The isolated fixtures provide the direct end-to-end no-partial-state evidence for all five requested malformations; the repository suite independently covers the common graph-before-write control flow.

Classification: **Expected behavior**. Anything applied: no.

### Scenario 5 — rerunning a slice

Fixture: examples/product-validation/rerun-states

Plan:

- Modify src/theme.ts to return validation-blue.
- Create src/banner.ts consuming themeName.

Commands:

    npm run score:prepare
    npm run score:start
    # repeat npm run score:start after each controlled target-state change
    npm run typecheck
    npm run build

State/result ledger:

| Confirmed state | Run | Model/variant | Result | Evidence |
|---|---|---|---|---|
| Original plan state | redacted | DeepSeek max | applied | Both files generated; correct result. |
| Targets unchanged from prior output | redacted | Ling default | applied | Guided mode did not require recognition of prior SCORE output. |
| Modify target manually changed | redacted | DeepSeek max | applied | Warning named changed theme and occupied banner; correct bytes restored. |
| Modify target missing | redacted | DeepSeek max | applied | Warning said theme missing/will be recreated; prior bytes preserved at evidence/theme-before-missing-run.ts. |
| Create target occupied | every rerun above | mixed | applied after confirmation | banner.ts shown on its own line as existing/will be replaced. |
| Previously generated target replaced with different valid content | redacted | DeepSeek max | applied | Run bound exact pre-run digest sha256:fb07829a... and replaced it. |

Guided mode consistently:

- displayed the repository-relative `examples/product-validation/rerun-states` path;
- put each target on a separate readable line;
- named changed, missing, and occupied states;
- explained that continuing permits replace/recreate only if the confirmed state remains unchanged during execution;
- asked one final confirmation;
- stored the exact current digest or absence for that Run;
- applied both candidates together.

One model-quality defect occurred on the unchanged rerun: Ling changed themeName back to legacy even though validation-blue was required. The declaration/signature remained valid, so SCORE’s deterministic contract accepted it and truthfully reported application. This is classified and reproduced in section 10.

Prepared IDs:

| Value | ID |
|---|---|
| slice_id | theme-banner |
| Pass | redacted |
| Manifest | redacted |
| Review | redacted |

Classification of rerun mechanics: **Expected behavior**. Anything applied: yes, complete two-file sets. The wrong Ling semantics are separately **Model output quality defect**.

### Scenario 6 — drift and atomicity

Live interruption reproduction:

    cd examples/product-validation/rerun-states
    npm run score:start
    # confirm a two-file Ling Run, then send Ctrl-C while both Jobs are active
    ../../../node_modules/.bin/tsx ../../../src/runner/cli.ts status --runner-db .score/runner.db --run redacted
    ../../../node_modules/.bin/tsx ../../../src/runner/cli.ts recover --runner-db .score/runner.db --run redacted
    ../../../node_modules/.bin/tsx ../../../src/runner/cli.ts work --runner-db .score/runner.db --run redacted

Observed:

- Process exited 130.
- CLI said SIGINT interrupted the Runner, active sessions were asked to abort, cleanup was awaited, and no automatic redelivery would occur.
- Before recovery, Run state was running, application was not_applied, and both Jobs/Attempts were still running.
- Both target hashes were unchanged.
- Explicit recover marked two Attempts recovered and Jobs needs_attention.
- work then completed with failures and said no files were applied.
- Final application state remained not_applied.

Deterministic commands:

    ./node_modules/.bin/tsx --test test/repository-application.test.ts
    ./node_modules/.bin/tsx --test test/runner-workers.test.ts test/open-code-adapter.test.ts test/guided-start.test.ts

Results: 30/30 and 37/37 passed.

| Requested failure | Direct evidence | Outcome |
|---|---|---|
| Target changes while agents run | test/guided-start.test.ts:734 and test/repository-application.test.ts:879 | Typed conflict; sibling candidate not installed; concurrent user edit survives. |
| Unrelated file changes while agents run | test/guided-start.test.ts:623 and test/repository-application.test.ts:805, 841 | Declared target applies; unrelated edit survives. |
| One per-file Job fails | Live React Runs redacted and others; test/runner-workers.test.ts:406 | Successful sibling candidates retained for inspection, but nothing applied. |
| Missing candidate output | test/open-code-adapter.test.ts:611 plus completed candidate-count guard at src/runner/runner.ts:574 | Adapter fails closed and cleans workspace; exact persisted-candidate corruption case remains untested. |
| Candidate digest mismatch | test/repository-application.test.ts:314 | Rejected before any target application. |
| Undeclared workspace file | test/open-code-adapter.test.ts:737 | AdapterBoundaryError names extra path; disposable workspace removed. |
| Multi-file application failure | test/repository-application.test.ts:473, 618, 670 | Original targets restored and new targets removed; manual recovery evidence retained if rollback is obstructed. |
| Interruption during active Run | Live Run redacted | No apply; explicit recovery required. |
| Ambiguous Attempt recovery | Live Run plus test/runner-workers.test.ts:553 | No redelivery before recovery; stale completion rejected in deterministic test. |

Why Partial:

- Expected: corrupting/removing one persisted candidate from an otherwise completed multi-file Run must apply nothing.
- Observed: adjacent guards are present and green, but no direct Runner-level failure injection reproduces that exact stored-state corruption.
- Reproduction gap: there is no supported non-destructive CLI path to create that invalid completed state; manual database corruption would test SQLite tampering more than the public workflow.
- Relevant path: src/runner/runner.ts:574-597.
- Applied: no application occurred in any covered failure case.
- Severity: Medium test-coverage risk, not a confirmed production defect.
- Primary ownership: **Expected behavior** for covered cases; the remaining item is **Untested**, not classified as a defect.
- Possible direction: add a deterministic Runner integration that removes one persisted candidate after all Jobs are marked succeeded and asserts completed-set validation blocks repository application.

### Scenario 7 — model, provider, and variant behavior

Live catalog discovery at 2026-08-10T00:39:23.841Z:

| Provider ID | Label | Models | Models with variants |
|---|---|---:|---:|
| opencode | OpenCode Zen | 60 | 47 |
| anthropic | Anthropic | 15 | 15 |
| Total |  | 75 | 62 |

Representative advertised models:

| Model | Variants |
|---|---|
| opencode/longcat-2.0-free | low, medium, high |
| opencode/ling-3.0-tiny-free | none |
| opencode/deepseek-v4-flash-free | low, high, max |
| opencode/gpt-5.4 | none, low, medium, high, xhigh |
| anthropic/claude-sonnet-4-6 | low, medium, high, max |

Only connected providers were returned. Catalog membership proves advertised connectivity, not per-model entitlement. The bounded live execution matrix used OpenCode Zen models; Anthropic was catalog-inspected but not invoked.

Invalid preflight:

    npm run runner -- start --score-db <isolated-score.db> --runner-db <isolated-runner.db> --pass unreachable-pass --provider opencode --model gpt-5.4 --variant definitely-invalid

Observed:

    Error: GPT-5.4 does not advertise variant definitely-invalid
    runner-db-not-created
    exit-status=1

No approval, Run, Job, session, or model request was created.

The full live Run/timing ledger is in section 7 below. The representative requirements were all exercised:

- Two or more models: LongCat, Ling, DeepSeek, GPT-5.4.
- Two explicit variants for one model: LongCat low and high.
- Omitted variant: LongCat default; Ling also has no variant choice.
- Invalid variant: definitely-invalid, rejected before Run creation.
- Nonstandard opaque variant: DeepSeek max.
- No-variant model: Ling skipped the variant question.
- Confirmation/output displayed provider, model, and chosen variant/default.
- Every Job inherited its Run’s single stored variant; deterministic tests cover forwarding the same variant to every session and prompt.
- Provider/model failures returned typed diagnostics and completed rather than hanging.

Classification: **Expected behavior**. Anything applied: varies by Run; see section 7.

### Scenario 8 — larger realistic application

Fixture: examples/product-validation/realistic-react-app

Product shape:

- Three ordered slices: domain foundation, primary interface, filtering follow-up.
- Eight unique SCORE-owned product files with meaningful cross-file imports:
  - src/domain/task.ts
  - src/domain/task-operations.ts
  - src/domain/task-query.ts
  - src/App.tsx
  - src/components/TaskComposer.tsx
  - src/components/TaskItem.tsx
  - src/components/TaskList.tsx
  - src/components/FilterBar.tsx
- main.tsx, styles.css, configuration, and QA acceptance remained fixture-owned context rather than SCORE targets.
- No automated test was added to any SCORE slice. qa/acceptance.ts was run separately.

Core commands after each applied slice:

    npm run score:prepare
    npm run score:start
    npm run typecheck
    npm run build
    npm run qa

Final browser command:

    npm run dev -- --host 127.0.0.1

The application was inspected in the real in-app Chromium browser at default desktop width and at an explicit 320 by 640 viewport.

Prepared revision ledger:

| Slice | Rev | Pass | Manifest | Review |
|---|---:|---|---|---|
| focus-board-domain | 1 | redacted | redacted | redacted |
| focus-board-interface | 1 | redacted | redacted | redacted |
| focus-board-interface | 2 | redacted | redacted | redacted |
| focus-board-filtering | 1 | redacted | redacted | redacted |
| focus-board-filtering | 2 | redacted | redacted | redacted |
| focus-board-filtering | 3 | redacted | redacted | redacted |

Final applied Runs:

| Slice | Run | Result |
|---|---|---|
| Domain v1 | redacted | Applied; project checks passed. |
| Interface v2 | redacted | Applied; project checks passed. |
| Filtering v3 | redacted | Applied; project checks passed. |

Iteration evidence:

- Interface v1 had two no-apply Job failures, then one applied Run whose App used onAddTask/onToggleTask rather than the exact component props. Real typecheck failed. The Run’s candidate bytes remain in runner.db.
- A guided rerun against the applied bytes showed App changed and all three create targets occupied, then two more no-apply attempts failed TaskList declaration/import verification.
- The fixture instruction was clarified and its already-created component operations were corrected from create to modify. Immutable interface v2 was prepared and applied.
- Filtering v1 produced two no-apply FilterBar declaration failures.
- Filtering v2 corrected an internally contradictory empty-state instruction and made TaskList own one caller-supplied empty message. It applied, but App used currentFilter instead of current; real typecheck failed.
- Filtering v3 explicitly froze the prop name and applied successfully.

Final generated-code checks:

- npm run typecheck: passed.
- npm run build: passed; Vite transformed 22 modules. Final JS bundle was 193.55 kB (60.91 kB gzip); CSS was 2.73 kB (1.19 kB gzip).
- npm run qa: “Focus Board QA acceptance passed.”
- Impeccable static detector across all eight generated product files: no findings.

Browser evidence:

- Initial accessibility tree: one main, one h1 “Focus Board,” region “Task board,” visible Task and Group labels, native textbox/select/submit button, native pressed buttons in a group named “Task filters,” an always-present list, and one “No tasks yet.” empty message.
- Valid personal task creation cleared only the title, retained Personal, created one accessible checkbox named “Write release notes Personal,” and updated the summary to 0 of 1 complete.
- A blank three-space submission created nothing and did not clear the title.
- Toggling updated checked state, visible strike-through, and summary.
- A second Work task preserved creation order.
- Active showed only the active task; Completed showed only the completed task; aria-pressed moved to the selected filter.
- With no completed items, Completed retained the semantic list and showed exactly “No completed tasks.”
- At 320 px: innerWidth 320, document scrollWidth 320, no horizontal overflow. Add task was 270 by 44 px; filter buttons were 40 px high and remained on one readable row.
- Actual keyboard activation is explicitly blocked: focus visibly moved to the native buttons/checkbox, but the in-app browser did not deliver synthetic Enter/Space activation, and the computer-control fallback reported the Mac was locked.

Why Partial:

- Expected: three ordered slices should generate an app that follows frozen instructions and passes real project/browser checks without hand-editing generated files.
- Observed: final output did pass, with no generated-file hand edits, but several model attempts failed and the QA-authored plan required immutable corrective revisions.
- Reproduction: use the stored v1/v2 reviews and Runs listed above, then run npm run typecheck immediately after Runs redacted and redacted.
- Relevant paths: score/slices/02-primary-interface.json, score/slices/03-filtering-follow-up.json, src/App.tsx, src/components/TaskList.tsx, src/components/FilterBar.tsx.
- Applied: failed Jobs applied nothing; the two cross-file model errors were applied as complete candidate sets and then caught by real typecheck.
- Severity: Medium for model/context reliability; Low for the keyboard evidence blocker.
- Primary ownership: **Model output quality defect**, **Plan/context defect**, and **Environment or credential blocker**, separated in sections 10 and 13.
- Possible direction: make exact named imports/JSX prop names prominent in authored skills, consider deterministic consumed-declaration usage checks that remain within SCORE’s declared integrity boundary, and repeat physical keyboard acceptance when the Mac is unlocked.

## 6. Prepared revision and Run ledger

This section is the compact audit index. Historical HTML and snapshot artifacts are under each fixture’s .score/reviews directory; Runner evidence and candidate content are retained in each fixture’s .score/runner.db.

| Fixture / slice | Rev | Pass | Review | Applied Run |
|---|---:|---|---|---|
| editable-revisions / stable-greeting | 1 | redacted | redacted | — |
| editable-revisions / stable-greeting | 2 | redacted | redacted | — |
| fresh-typescript / featured-catalog-summary | 1 | redacted | redacted | redacted |
| ordered-slices / pipeline-foundation | 1 | redacted | redacted | redacted |
| ordered-slices / pipeline-emphasis | 1 | redacted | redacted | redacted |
| ordered-slices / pipeline-summary | 1 | redacted | redacted | redacted |
| rerun-states / theme-banner | 1 | redacted | redacted | five successful Runs; see section 7 |
| realistic-react-app / focus-board-domain | 1 | redacted | redacted | redacted |
| realistic-react-app / focus-board-interface | 1 | redacted | redacted | redacted |
| realistic-react-app / focus-board-interface | 2 | redacted | redacted | redacted |
| realistic-react-app / focus-board-filtering | 1 | redacted | redacted | none |
| realistic-react-app / focus-board-filtering | 2 | redacted | redacted | redacted |
| realistic-react-app / focus-board-filtering | 3 | redacted | redacted | redacted |

Read-only reproduction query:

    for validation_db in examples/product-validation/*/.score/score.db; do
      sqlite3 -separator '|' "$validation_db" +        "SELECT v.slice_id,v.display_title,v.revision,c.pass_id,v.manifest_id,v.review_id,v.artifact_stem
         FROM v_prepared_slice_revisions v
         JOIN coding_passes c ON c.manifest_id=v.manifest_id
         ORDER BY v.slice_id,v.revision;"
    done

## 7. Model/provider/variant matrix with timing

Duration is measured from the earliest Job claim to applied_at, or to the latest completed Attempt for a failed Run. All timestamps and candidate bodies remain in the local Runner databases.

| Fixture | Provider | Model | Variant | Duration (s) | Result | Application | Run ID |
|---|---|---|---|---:|---|---|---|
| fresh | opencode | longcat-2.0-free | low | 27.806 | completed | applied | redacted |
| ordered A | opencode | longcat-2.0-free | high | 14.139 | completed | applied | redacted |
| ordered B | opencode | longcat-2.0-free | OpenCode default | 15.968 | completed | applied | redacted |
| ordered C | opencode | ling-3.0-tiny-free | no variants | 13.836 | completed | applied | redacted |
| rerun initial | opencode | deepseek-v4-flash-free | max | 11.771 | completed | applied | redacted |
| rerun unchanged | opencode | ling-3.0-tiny-free | no variants | 44.463 | completed; semantic miss | applied | redacted |
| rerun changed | opencode | deepseek-v4-flash-free | max | 11.494 | completed | applied | redacted |
| rerun missing | opencode | deepseek-v4-flash-free | max | 11.983 | completed | applied | redacted |
| rerun valid replacement | opencode | deepseek-v4-flash-free | max | 11.869 | completed | applied | redacted |
| rerun interrupted | opencode | ling-3.0-tiny-free | no variants | 51.605 through recovery | completed_with_failures | not_applied | redacted |
| React domain | opencode | gpt-5.4 | medium | 13.513 | completed | applied | redacted |
| React interface v1 attempt 1 | opencode | gpt-5.4 | medium | 23.848 | completed_with_failures | not_applied | redacted |
| React interface v1 attempt 2 | opencode | gpt-5.4 | medium | 19.604 | completed_with_failures | not_applied | redacted |
| React interface v1 attempt 3 | opencode | gpt-5.4 | medium | 18.807 | completed; project typecheck failed | applied | redacted |
| React interface v1 attempt 4 | opencode | gpt-5.4 | high | 35.324 | completed_with_failures | not_applied | redacted |
| React interface v1 attempt 5 | opencode | deepseek-v4-flash-free | max | 36.615 | completed_with_failures | not_applied | redacted |
| React interface v2 | opencode | gpt-5.4 | medium | 20.619 | completed | applied | redacted |
| React filtering v1 attempt 1 | opencode | gpt-5.4 | medium | 20.383 | completed_with_failures | not_applied | redacted |
| React filtering v1 attempt 2 | opencode | gpt-5.4 | high | 56.668 | completed_with_failures | not_applied | redacted |
| React filtering v2 | opencode | gpt-5.4 | medium | 21.665 | completed; project typecheck failed | applied | redacted |
| React filtering v3 | opencode | gpt-5.4 | medium | 18.001 | completed | applied | redacted |
| invalid preflight | opencode | gpt-5.4 | definitely-invalid | < 1 | rejected before Run | no Runner DB | — |

No credentials, auth contents, response headers, or private provider metadata are included.

Every Job received the same selected variant because adapter selection is frozen once at Run creation and each Job reads the same Run-level adapter configuration. This was checked through status output and runner_runs.variant_id, and is directly covered by the passing Runner/adapter tests.

Observed failure behavior was bounded and diagnostic:

- Candidate verification failures named the target and exact declaration/import mismatch.
- Provider/session interruption reported cleanup and recovery requirements.
- Invalid variants failed before approval and Run creation.
- No live failure remained silently active indefinitely.

## 8. Generated-code quality and browser review

### Small TypeScript projects

| Fixture | SCORE result | Project typecheck | Build | QA | Quality result |
|---|---|---|---|---|---|
| fresh-typescript | applied | pass | pass | pass | Correct Product, formatter, featured filtering, ordering, count, and empty behavior. |
| ordered-slices | three applied Runs | pass | pass | pass | Correct cumulative baseMessage, emphasize, and summarize behavior in dependency order. |
| rerun-states final | applied | pass | pass | no separate script | Correct final theme/banner after DeepSeek reruns. Ling’s earlier semantic regression is retained as evidence. |

### Realistic React application

The final generated app follows the corrected frozen instructions:

- Domain state is readonly and immutable.
- createTask trims the title, assigns monotonic IDs, and appends in creation order.
- toggleTask changes only the matching record.
- filterTasks preserves order and delegates all/active/completed selection.
- TaskComposer uses a native form, visible labels, native select, and native submit button.
- TaskItem uses a native checkbox with a visible associated task/group label.
- TaskList always retains a semantic ul and owns exactly one supplied empty message.
- FilterBar uses three native buttons in a named group with accurate aria-pressed values.
- App delegates domain transitions, retains underlying task state while filtering, and updates completed/total summary.

The two applied-but-not-project-correct Runs demonstrate why SCORE success cannot be treated as application correctness:

    cd examples/product-validation/realistic-react-app
    npm run typecheck

After Run redacted:

    Property 'onAddTask' does not exist on type 'TaskComposerProps'.
    Property 'onToggleTask' does not exist on type 'TaskListProps'.

After Run redacted:

    Property 'currentFilter' does not exist on type 'FilterBarProps'.

Both Runs applied complete candidate sets, and SCORE made no project-verification claim. Their exact candidate content remains in runner_attempts.candidate_content.

Final acceptance:

- typecheck: pass.
- Vite production build: pass.
- QA-owned acceptance script: pass.
- Desktop browser interaction: pass.
- 320 px mobile viewport: pass with no horizontal overflow.
- Semantic structure and accessible names: pass.
- Visible empty/checked/pressed/summary transitions: pass.
- Physical keyboard activation: blocked by the environment, not passed by inference.

## 9. Confirmed SCORE product defects

**None confirmed at commit 41025c5f4e5d963d301af6838139b21efa41ffbe.**

This is not a claim that SCORE is defect-free. It means every directly observed problem in this pass had a more specific primary owner:

- model output quality;
- validation plan/context;
- validation fixture;
- documentation/UX;
- expected strict behavior;
- environment.

The atomicity, target-binding, revision, ordering, catalog-selection, and truthful-output expectations all held under the evidence exercised.

No Runtime Adapter defect was confirmed. The live adapter catalog and four invoked models worked; adapter failures completed with diagnostics and cleanup.

## 10. Model-quality and context-quality defects

### MQ-01 — behaviorally wrong but declaration-valid rerun

- Primary category: **Model output quality defect**
- Severity: Medium
- Expected: themeName returns validation-blue as frozen by the approved slice.
- Observed: Ling returned legacy while preserving the required export/signature, so deterministic declaration verification passed.
- Reproduction:

      cd examples/product-validation/rerun-states
      ../../../node_modules/.bin/tsx ../../../src/runner/cli.ts status --runner-db .score/runner.db --run redacted
      sqlite3 .score/runner.db "SELECT candidate_content FROM runner_attempts a JOIN runner_jobs j ON j.job_id=a.job_id WHERE j.run_id='redacted' AND j.target_path='src/theme.ts';"

- Relevant path/ID: src/theme.ts; Run redacted.
- Applied: yes, both candidates were applied.
- SCORE behavior: correct and truthful; it did not claim semantic/project verification.
- Possible direction: select a stronger model for semantic requirements or freeze a deterministically checkable return expression when exact bytes/behavior are essential.

### MQ-02 — applied React candidates used invented prop names

- Primary category: **Model output quality defect**
- Severity: Medium
- Expected: App uses the exact props supplied by consumed declarations: onAdd/onToggle, then current/onChange.
- Observed:
  - Run redacted used onAddTask and onToggleTask.
  - Run redacted used currentFilter.
- Exact reproduction:

      cd examples/product-validation/realistic-react-app
      sqlite3 .score/runner.db "SELECT j.target_path,a.candidate_content FROM runner_jobs j JOIN runner_attempts a ON a.job_id=j.job_id WHERE j.run_id IN ('redacted','redacted') AND j.target_path='src/App.tsx';"
      npm run typecheck

- Relevant paths: src/App.tsx, src/components/TaskComposer.tsx, src/components/TaskList.tsx, src/components/FilterBar.tsx.
- Applied: yes, each Run applied its full candidate set; no partial set was applied.
- SCORE behavior: correct boundary behavior; the complete files met deterministic per-file checks, and the project check afterward caught the cross-file mismatch.
- Possible direction: make exact JSX prop names unusually prominent in authoring skills, and investigate a deterministic consumed-declaration-use check without adding whole-project typechecking to SCORE.

### MQ-03 — exact declaration instructions were not followed

- Primary category: **Model output quality defect**
- Severity: Low to Medium
- Expected: generated interfaces exactly match frozen inline declarations.
- Observed:
  - Run redacted: TaskComposerProps.onAdd type mismatch.
  - Runs redacted and redacted: FilterBarProps.current/onChange used a nonmatching form, likely a shared alias.
- Reproduction:

      sqlite3 -header -column examples/product-validation/realistic-react-app/.score/runner.db +        "SELECT j.run_id,j.target_path,a.failure_tag,a.failure_message FROM runner_jobs j JOIN runner_attempts a ON a.job_id=j.job_id WHERE j.run_id IN ('redacted','redacted','redacted');"

- Applied: no; SCORE rejected each complete Run because a required Job failed.
- Possible direction: retain the current strict verifier; improve brief emphasis around syntactically exact interface declarations.

### PC-01 — fixture brief underspecified one named import

- Primary category: **Plan/context defect**
- Severity: Medium for generation reliability
- Expected: TaskList imports the named TaskItem export from ./TaskItem.
- Observed: three independent attempts failed “TaskItem must be imported from ./TaskItem; TaskItem must have exactly one import binding.”
- Runs: redacted, redacted, redacted.
- Relevant draft: score/slices/02-primary-interface.json revision 1.
- Applied: no for these Runs. SCORE retained successful sibling candidates but applied none.
- Fixture correction: clarified the named syntax { TaskItem } and, because v1 had previously created the component files, changed v2 operations from create to modify. No generated file was hand-edited.
- Possible direction: authoring guidance should prefer literal import syntax when the deterministic verifier requires a particular binding form.

### PC-02 — fixture plan would have produced duplicate empty messages

- Primary category: **Plan/context defect**
- Severity: Medium UX defect if shipped
- Expected: each filtered empty view presents one concise message while retaining the semantic list.
- Observed before final application: v1 required TaskList’s generic “No tasks yet.” and also required App to render a filter-specific empty paragraph, which would duplicate messages.
- Relevant draft/reviews: focus-board-filtering-follow-up-review.html and v2.
- Applied: the contradictory v1 never applied; its two Runs failed earlier at FilterBar verification. The plan was corrected before a successful application.
- Fixture correction: filtering v2 added TaskList.tsx as a target with one emptyMessage prop and forbade a second App paragraph.
- Possible direction: add an author checklist for requirements that allocate the same visible state to multiple target owners.

## 11. UX friction and confusing language

### What worked well

- The project-local commands are short:

      npm run score:prepare
      npm run score:list
      npm run score:start

- A typical guided start has four decisions: plan, model, optional variant, final confirmation. A model without variants skips that question.
- No approval rationale is requested.
- The plan review leads with title, objective, target count, operation count, and “Approval freezes these instructions. It does not run them.”
- File count, per-file context routing, requirement coverage, skills, declarations, and limits are understandable without opening machine JSON.
- Audit IDs/digests are subordinate disclosures rather than the primary review surface.
- Changed/missing/occupied warnings name the root and paths, explain the consequence, and ask one final confirmation.
- Success output is concise and truthful.
- Job/candidate failure output says nothing was applied and gives a Run ID in guided mode.
- Revision listing clearly shows v2/v3 and historical implemented revision counts.

### UX-01 — recovery retry uses generic storage language

- Primary category: **Documentation or UX defect**
- Severity: Low to Medium
- Expected: attempting work on an interrupted running Run should produce the documented RunRecoveryRequired diagnostic.
- Observed: work returned “RunnerStoreError: Run 88d... is running and cannot be started.”
- Reproduction:

      npm run score:start
      # interrupt after Jobs start
      ../../../node_modules/.bin/tsx ../../../src/runner/cli.ts work --runner-db .score/runner.db --run redacted

- Relevant Run: redacted.
- Applied: no.
- Possible direction: map this store-state rejection to the recovery-specific user message used by the documented workflow.

### UX-02 — long model work has no progress heartbeat

- Primary category: **Documentation or UX defect**
- Severity: Medium
- Expected: a bounded slow provider should look active and communicate elapsed time or Job state.
- Observed: the CLI prints the starting line and then no per-Job progress until completion/failure. One bounded Ling Run took 44.463 seconds; the adapter deadline is 30 minutes.
- Applied: unrelated; this is visibility, not atomicity.
- Possible direction: print periodic elapsed/Job-state updates and expose a safe execution-timeout option separately from start-timeout.

### UX-03 — catalog and opaque variant presentation

- Primary category: **Documentation or UX defect**
- Severity: Low
- Observed:
  - There is no standalone read-only Runner catalog command.
  - Exact raw provider/model/variant IDs are available in status JSON, while guided selection uses labels.
  - Every opaque non-none variant is called “reasoning,” including provider-defined IDs such as max or deterministic custom fast.
- Applied: no effect on application correctness.
- Possible direction: add a catalog command, optionally show raw IDs, and label opaque choices “variant” unless the provider supplies reasoning semantics.

### UX-04 — listing and search friction

- Primary category: **Documentation or UX defect**
- Severity: Low
- Observed:
  - Implemented plans can appear before the one Ready plan, adding navigation.
  - An approved-but-not-applied plan still uses a broad Ready/Approved presentation that is not always immediately distinguishable in every command.
  - While model discovery resolves, the searchable list can briefly show unrelated default choices before narrowing.
- Possible direction: sort runnable/needs-attention plans first and keep loading/search state visually explicit.

Why Scenario 9 is Partial:

- Expected: a first-time user can review, approve, monitor, recover, and understand outcomes without storage vocabulary or hidden commands.
- Observed: review/confirmation/success are strong, but catalog visibility, quiet execution, and recovery wording still require expert interpretation.
- Reproduction: the commands and Run IDs in UX-01 through UX-04.
- Relevant paths: src/runner/guided-start-cli.ts, src/runner/cli.ts, src/runner/open-code-catalog.ts.
- Applied: no UX issue caused a partial application.
- Severity: Medium overall.
- Primary ownership: **Documentation or UX defect**.
- Possible direction: progress heartbeats, recovery-specific messages, runnable-first plan ordering, and a read-only catalog command.

Internal IDs and storage vocabulary are generally well contained. Run IDs appear when useful for diagnosis. The main review does not lead with manifest/pass/review IDs, SQLite tables, or digests. The notable leak is the RunnerStoreError recovery wording.

## 12. Expected behavior that initially looked suspicious

Each item below has exactly the primary category **Expected behavior**.

1. Preparation rejected TypeScript settings it cannot reproduce. The initial fixture rootDir setting produced PROJECT_SETTINGS_UNSUPPORTED. Removing that fixture-only setting was correct; SCORE did not mutate application sources.
2. TypeScript 7 then required an explicit root directory at build time. Moving --rootDir src into the QA fixture build command was a fixture correction, not a SCORE change.
3. A changed revision with create operations could not prepare after v1 had already created those paths. Changing the later draft operations to modify was required by the current repository state.
4. A predecessor-owned symbol did not resolve through consumes in a later Change Plan. Cross-slice applied code belongs in ordinary source context; consumes resolves declarations owned inside the same plan.
5. Preparing or approving A did not unblock B. Only exact successful application did.
6. Guided mode could replace/recreate changed, missing, and occupied targets after confirmation; noninteractive start refused mismatched repository state and suggested --verbose.
7. Extra unrelated repository files did not block application.
8. A complete candidate set could apply while later project typecheck failed. SCORE correctly did not run or claim project verification.
9. Tests were absent from plans because the product requests did not explicitly ask SCORE to create tests; QA-owned checks ran afterward.
10. The default Runner database is user-global on macOS. Every fixture explicitly selected .score/runner.db to keep artifacts isolated.
11. A model without variants skipped the variant prompt. An omitted variant remained null instead of inventing a default ID.
12. Successful siblings remained inspectable after one Job failed, while the repository remained unchanged.

Fixture-only corrections classified as **Example or QA fixture defect**, not SCORE defects:

- Unsupported rootDir in three small TypeScript fixture configurations.
- Missing explicit JSX type import in the initial React scaffold/instructions before any SCORE Run.
- An invalid cross-slice consumes entry during filtering v2 preparation.
- Create operations that needed to become modify after an earlier revision had created the files.

## 13. Untested or blocked areas

### Explicitly untested

1. **Missing persisted candidate corruption:** no direct Runner-level test deletes one stored candidate from an otherwise completed multi-file Run. Adjacent adapter/count guards passed.
2. **Every advertised model:** intentionally not run. The live catalog had 75 choices; exhaustive execution would be wasteful and outside the requested bounded matrix.
3. **Anthropic model invocation:** provider connectivity and variants were inspected, but no Anthropic prompt was sent. The requirement was multiple available models, not every provider.
4. **Per-model entitlement:** catalog advertisement was recorded; it was not treated as proof that every listed paid model is entitled.
5. **Live target/unrelated drift during paid agents:** destructive timing races used deterministic fake-adapter tests rather than deliberately mutating live model Runs.
6. **Full Runner integration for an undeclared workspace file plus successful sibling:** adapter boundary and Runner sibling-failure atomicity are covered separately, not in one test.

### Blocked

Physical keyboard activation in the real browser:

- Primary category: **Environment or credential blocker**
- Expected: press Enter on native buttons and Space on the native checkbox and observe the same state transitions as clicks.
- Observed: the in-app browser moved focus but did not deliver synthetic activation. Computer Use could not target Codex and the Chrome fallback reported the Mac was locked.
- Reproduction: focus All/Active/Completed or the checkbox in the in-app browser, invoke the browser keypress API, then inspect aria-pressed/checked; state remains unchanged.
- Relevant fixture: examples/product-validation/realistic-react-app.
- Applied: not applicable; browser-only acceptance.
- Severity: Low validation gap.
- Possible direction: rerun this one acceptance check with the Mac unlocked or with a browser-control build whose keypress activation is working.

No credential blocker affected SCORE model execution. No secrets were printed or copied into the report.

## 14. Prioritized recommendations

### P0 — before broader than controlled alpha

1. Add deterministic cross-file consumed-declaration usage checks where feasible, especially JSX prop names and named import binding form. Do not turn this into whole-project typechecking; keep the check scoped to the frozen declarations SCORE already owns.
2. Add the exact missing-persisted-candidate Runner integration test and assert zero application.
3. Add periodic execution progress/elapsed output so the 30-minute adapter deadline cannot look like an indefinite hang.

### P1 — improve recovery and authoring reliability

4. Map interrupted running-state retries to a recovery-specific diagnostic rather than RunnerStoreError.
5. Strengthen authoring guidance with literal import/prop syntax when exact bindings matter.
6. Document the applied-revision authoring transition from create to modify and the distinction between same-plan consumes versus predecessor source context.
7. Add an authoring check or review hint for duplicate ownership of one visible empty/error state across files.

### P2 — improve first-time discovery

8. Add a read-only catalog command showing only connected providers, model labels/IDs, and opaque variants.
9. Use “variant” rather than assuming every opaque ID means reasoning.
10. Sort Ready and Needs attention plans before Implemented entries.
11. Repeat the physical keyboard acceptance check when the environment permits it.

### P3 — validation/example investments

12. Keep the realistic React fixture as a regression surface, including its three ordered slices and separate QA checks.
13. Add an optional documented post-SCORE checklist template: inspect diff, typecheck, build, run QA tests, and browser acceptance.
14. Preserve examples of model failures in Runner databases rather than sanitizing them into only successful demos; they are valuable boundary evidence.

## 15. Go/no-go recommendation

**GO for sharing SCORE as a controlled technical alpha. NO-GO for a broad self-serve or “implementation verified” launch.**

The alpha message should be explicit:

- SCORE reliably prepares, reviews, approves, generates, integrity-checks, and atomically applies a complete candidate set.
- SCORE does not verify the resulting project.
- Real project checks and human product acceptance are mandatory after every applied Run.
- Model and plan quality may require immutable revision and rerun cycles.

The controlled-alpha gate should require:

1. The exact missing-candidate integration test.
2. Recovery wording that points users directly to recover.
3. A progress heartbeat for long model Runs.
4. Prominent post-application project-check guidance.

With those conditions, the evidence supports sharing SCORE with other technically sophisticated users now. It does not support presenting SCORE as a one-shot autonomous implementation system.

## Artifact disposition

- Validation fixtures: examples/product-validation/
- Final report: docs/product-validation-report.md
- SCORE Core databases, reviews, Runner databases, build output, model sessions: local/ignored fixture artifacts.
- During validation, the Git staging area remained empty.
- During validation, no commits, pushes, merges, or pull requests were created.
- Existing examples: untouched.
- Other worktree: preserved.
