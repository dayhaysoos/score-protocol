# Text-only OpenCode V2 model matrix — 2026-08-11

## Executive result

This was a no-retry comparison of the current text-only SCORE protocol and the
OpenCode V2 Runtime Adapter against the same three-slice Focus Board workload.
The matrix launched 27 isolated File Job Attempts across eight Runs.

- 26 Attempts succeeded and one failed.
- Seven complete candidate sets were atomically applied.
- One four-file Run failed and applied nothing.
- OpenCode V2 reached a bounded terminal result for every Attempt; none hung.
- Only GLM-5.2 finished with a compile-valid, browser-accepted final product.
- No model completed every ordered slice with every intermediate project gate
  passing.

That makes the Runtime Adapter/Core result strong, but the first-shot generated
product result mixed.

## Conditions

- Repository: SCORE Protocol, addressed below as `$SCORE_PROTOCOL_ROOT`
- Branch: `product-validation-2026-08-09`
- HEAD: `12834d16e4f88130560cf4394fbdff7da8ab9d67`
- OpenCode provider: OpenCode Zen (`opencode`)
- OpenCode V2 client and CLI: `0.0.0-next-17111`
- Concurrency: 5
- Retries: none
- Generated files were never hand-edited.
- Nothing was staged, committed, merged, or pushed.

The live catalog was discovered through SCORE before the Runs. It advertised:

| Model | Runtime identity | Variant |
|---|---|---|
| GPT-5.6 Luna | `opencode/gpt-5.6-luna` | `medium` |
| GLM-5.2 | `opencode/glm-5.2` | `high` |
| LongCat-2.0 Free | `opencode/longcat-2.0-free` | omitted; the model advertises none |

The deterministic SCORE baseline passed before live execution:

```sh
npm run typecheck
npm test                 # 144/144 passed
npm run build
npm run reproduce
git diff --check
```

## Fixture correction and comparison boundary

The current Slice Drafts describe the UI targets as `modify`. The first fixture
reconstruction incorrectly restored an older historical state in which those
targets were absent. SCORE correctly rejected Slice 2 preparation with
`PROJECT_FILE_UNREADABLE`; it produced no Slice 2 revision or Run.

The newly created fixtures were then corrected mechanically by restoring the
same tracked component bytes in all three lanes. Luna's already-applied domain
slice did not target those components, so the correction produced the same
effective starting state for all models.

Those restored components were the final/pre-satisfied implementations. This
means the matrix is also a rerun/replacement stress test: several Jobs were
asked to replace a file that already satisfied either the current slice or a
later slice. That is useful evidence for guided reruns, but it is a meaningful
confound when judging fresh-code generation.

## Result matrix

| Model | SCORE Runs / Jobs | Project gates | Final result | Classification |
|---|---|---|---|---|
| GPT-5.6 Luna medium | 3/3 Runs applied; 10/10 Jobs succeeded | S1 pass, S2 pass, S3 typecheck/build fail | `FilterBar.tsx` was the correct module repeated twice | SCORE delivery Pass; generated product Fail |
| GLM-5.2 high | 3/3 Runs applied; 10/10 Jobs succeeded | S1 pass, S2 typecheck/build fail, S3 pass | Final typecheck/build/QA/browser pass | Final product Pass; ordered workflow Partial |
| LongCat-2.0 Free default | S1 applied 3/3; S2 had 3/4 Jobs succeed and applied nothing | S1 pass; S2 stopped before project checks; S3 blocked | TaskComposer made an invalid identical-text edit tool call | SCORE atomicity Pass; model lane Fail/Blocked |

## Run ledger and timing

### GPT-5.6 Luna medium

| Slice | Run ID | Jobs | Create to apply |
|---|---|---:|---:|
| Domain foundation | `redacted` | 3/3 | 13.952s |
| Primary interface | `redacted` | 4/4 | 19.914s |
| Filtering follow-up | `redacted` | 3/3 | 19.248s |

Average Attempt duration was 15.080s; maximum was 19.795s. All Attempts were
Attempt 1 with no stored failure.

Post-application checks:

- Slice 1: typecheck and build passed.
- Slice 2: typecheck and build passed.
- Slice 3: typecheck and build failed on duplicate `JSX`, `FilterBarProps`, and
  `FilterBar` declarations.
- The domain-only QA script passed, demonstrating that this QA check does not
  cover React compilation or rendering.

Static audit found 9/10 candidates instruction-faithful. The failed candidate is
job `redacted`, digest
`sha256:d9c9d3c77bbc856a0bd5d29bcee1571e0c263e73bbaa86c77090d464b69b697d`.
It is exactly the already-correct 968-byte FilterBar target concatenated with
itself, producing 1,936 bytes. SCORE applied exactly those candidate bytes; it
did not concatenate them during installation.

### GLM-5.2 high

| Slice | Run ID | Jobs | Create to apply |
|---|---|---:|---:|
| Domain foundation | `redacted` | 3/3 | 35.072s |
| Primary interface | `redacted` | 4/4 | 32.038s |
| Filtering follow-up | `redacted` | 3/3 | 49.526s |

Average Attempt duration was 29.969s; maximum was 49.431s. All Attempts were
Attempt 1 with no stored failure.

Post-application checks:

- Slice 1: typecheck and build passed.
- Slice 2: both failed with TS2741 at `src/App.tsx`: the generated App correctly
  used the two-prop Slice 2 `TaskListProps`, but the TaskList candidate retained
  the later required `emptyMessage` prop.
- Slice 3: typecheck and build passed.
- Final direct QA passed.
- Final real-browser acceptance passed for blank rejection, trimmed task
  creation, Work/Personal grouping, order, toggling, summary changes, All / Active
  / Completed filtering, pressed state, filter-specific empty copy, named native
  controls, one `h1`, and an always-present semantic list.
- At 320px the document and body scroll widths were both exactly 320px; the
  toolbar changed to a column and the form to one grid column. No console
  warnings or errors appeared.
- Direct synthetic Enter activation through the browser-control surface did not
  trigger submission, so this matrix does not claim an independently proven
  keyboard-activation result. The rendered controls and implementation use
  native form, button, select, and checkbox semantics.

The Slice 2 TaskList miss was unambiguous model noncompliance against a
forward-contaminated target. Its candidate digest
`sha256:779482570515f004c18f3535092e6155c3914d95848af21fe7a3c38c81fdc731`
was byte-for-byte unchanged from the supplied future-shaped target. The exact
owned declaration and instruction required only `tasks` and `onToggle` plus the
literal `No tasks yet.`. Luna and LongCat both produced the correct Slice 2
TaskList candidate from the same base.

Strict audit result: eight clear candidate passes, one low-severity domain edge
case, and one material Slice 2 failure. Five of seven replacement candidates
were no-ops; GLM created or changed five of ten candidate files. Its changed
code was more verbose than Luna's, with JSDoc and a local empty-message map, but
the final behavior remained coherent.

### LongCat-2.0 Free, default variant

| Slice | Run ID | Jobs | Terminal window |
|---|---|---:|---:|
| Domain foundation | `redacted` | 3/3; applied | 49.048s |
| Primary interface | `redacted` | 3/4; not applied | 81.870s |
| Filtering follow-up | none | blocked by Slice 2 | — |

Average Attempt duration was 58.917s; maximum was 81.433s. Every Job had only
Attempt 1.

The failed Job was `src/components/TaskComposer.tsx`:

```text
AdapterInvocationError: OpenCode model execution request failed:
OpenCode tool failure: No changes to apply: oldString and newString are identical.
```

The target already satisfied the brief. The system instruction said to use an
edit tool when needed, so leaving it unchanged was permitted; LongCat instead
made an invalid no-op edit call. OpenCode surfaced the tool error, SCORE marked
the Job failed, waited for the three sibling Jobs to conclude, and applied none
of their candidates. Current hashes confirm that all four Slice 2 targets remain
at their confirmed pre-Run bytes.

LongCat's three applied domain candidates and three retained-but-unapplied Slice
2 candidates were otherwise reasonable on static inspection. The lane failed
on tool use, not on a hang, provider authentication, target drift, or partial
application.

## Commands

Each lane was prepared with:

```sh
export SCORE_PROTOCOL_ROOT=/absolute/path/to/score-protocol
"$SCORE_PROTOCOL_ROOT/node_modules/.bin/tsx" score/prepare.mjs
```

Each review-ready slice was approved and launched through the guided CLI:

```sh
# Luna
"$SCORE_PROTOCOL_ROOT/node_modules/.bin/tsx" \
  "$SCORE_PROTOCOL_ROOT/src/runner/cli.ts" start \
  --score-db .score/score.db --runner-db .score/runner.db \
  --variant medium --concurrency 5

# GLM
"$SCORE_PROTOCOL_ROOT/node_modules/.bin/tsx" \
  "$SCORE_PROTOCOL_ROOT/src/runner/cli.ts" start \
  --score-db .score/score.db --runner-db .score/runner.db \
  --variant high --concurrency 5

# LongCat
"$SCORE_PROTOCOL_ROOT/node_modules/.bin/tsx" \
  "$SCORE_PROTOCOL_ROOT/src/runner/cli.ts" start \
  --score-db .score/score.db --runner-db .score/runner.db \
  --concurrency 5
```

Applied slices were followed by:

```sh
npm run typecheck
npm run build
```

The copied package's `qa` script has the wrong relative path at this additional
matrix directory depth. Final QA was therefore invoked with the root binary:

```sh
"$SCORE_PROTOCOL_ROOT/node_modules/.bin/tsx" qa/acceptance.ts
```

That path issue is a QA fixture defect, not generated-code or SCORE ownership.

## Interpretation

### What worked well

- The simpler documented text context was sufficient for most files: Luna was
  faithful on 9/10 candidates, and GLM's changed candidates were generally
  strong.
- OpenCode V2 did not reproduce the old indefinite/ambiguous completion
  behavior in any of 27 Attempts.
- Every Job used the selected provider/model/variant consistently.
- Ordered dependencies advanced only after the exact predecessor Run applied.
- SCORE's all-Jobs and atomic-application contract worked. LongCat's one failed
  Job vetoed the complete four-file candidate set without disturbing targets.
- SCORE made no false project-verification claim. Post-application checks found
  defects that opaque artifact delivery intentionally does not inspect.

### What did not prove ready

- Only one of three models reached a valid final application.
- Even that model produced an invalid intermediate slice.
- Pre-satisfied/future-shaped targets materially affected all three failure
  modes, so this matrix should be read as rerun/replacement evidence, not a pure
  fresh-generation benchmark.
- The domain-only QA script is too narrow to establish UI correctness, and the
  copied script path needed a fixture-specific invocation.

## Bottom line

The SCORE delivery machinery is strong under this matrix. Model-independent
first-shot product correctness is not yet demonstrated. GLM-5.2 high was the
best overall result, GPT-5.6 Luna medium was fastest but produced a fatal final
candidate, and LongCat-2.0 Free was slowest and failed on a no-op tool call.

These results support the text-only, post-application-verification boundary,
but they do not support treating `completed/applied` as generated-product
success. Before using this matrix as a merge-confidence gate, build a clean
placeholder-based fresh fixture (not future-shaped targets), keep this current
fixture as the rerun stress case, and require every ordered slice's real project
check to pass.
