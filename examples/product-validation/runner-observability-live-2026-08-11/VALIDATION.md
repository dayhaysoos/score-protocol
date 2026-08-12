# Runner observability live validation

Validated on 2026-08-11 in real interactive terminals. The final post-review
Run completed successfully on the observation implementation captured here, all
three isolated candidates were applied atomically, the durable status view
matched the live view, and the fixture's external project checks passed. Earlier
successful Runs are retained below to preserve the validation chronology.

The later responsive table and 100 ms Run-level liveness animation changed only
the presentation path and are not claimed as part of this archived live capture.
They passed the current deterministic repository gates (`npm test`: 195 tests
across 23 suites, plus typecheck, build, reproduce, and diff check). Use
`../runner-observability-manual-live` for a disposable real-TTY check of the
current presentation.

## Final post-review deterministic verification

After observer/reporter isolation, terminal-evidence fail-closed behavior,
privacy migration hardening, and terminal-safe rendering were complete, the
settled repository passed:

- `npm run typecheck`
- `npm test` — 181 tests passed across 23 suites
- `npm run build`
- `npm run reproduce`
- `git diff --check`

The final renderer suite includes malicious TTY and append-mode labels and paths,
ANSI/C0/C1 controls, Unicode format and bidi controls, bounded fields, and an
identifiable fallback for a target with no printable representation.

## Final post-review preparation

- Change Plan: `redacted`
- Review: `.score/reviews/runner-observability-terminal-safe-three-file-proof-review.html`
- Command: `npm run score:prepare`
- Source-file SHA-256 sets matched before and after preparation, and the three
  planned gauge targets remained absent.
- The connected OpenCode catalog was inspected again immediately before the
  Run. It advertised GPT-5.6 Luna and the `medium` variant.

## Final post-review guided Run

- Command: `npm run score:start -- --variant medium --concurrency 3`
- Terminal: real TTY captured with `script`
- Run: `redacted`
- Provider: `opencode` (displayed as OpenCode Zen)
- Model: `gpt-5.6-luna` (displayed as GPT-5.6 Luna)
- Variant: `medium`
- Runtime SDK/CLI: `0.0.0-next-17111` / `0.0.0-next-17111`
- Maximum concurrency: `3`
- Created: `2026-08-11T20:02:34.504Z`
- Applied: `2026-08-11T20:02:49.492Z`
- End-to-end Run time: `14.988s`
- Retries: none
- Generated source edits after the Run: none

| Target | Job | Attempt | Runtime session | Claimed | Terminal | Attempt time |
| --- | --- | --- | --- | --- | --- | ---: |
| `src/format-gauge.ts` | `redacted` | `redacted` | redacted | `20:02:34.514Z` | `20:02:44.554Z` | `10.040s` |
| `src/gauge-summary.ts` | `redacted` | `redacted` | redacted | `20:02:34.955Z` | `20:02:42.765Z` | `7.810s` |
| `src/gauge.ts` | `redacted` | `redacted` | redacted | `20:02:34.957Z` | `20:02:49.428Z` | `14.471s` |

The initial frame showed all three files as `waiting`. They independently moved
through `starting` and `Agent working`; the five-second heartbeat repainted
elapsed time without changing stages. `src/gauge-summary.ts` reached
`checking output`, `candidate ready`, and durable `succeeded` at about eight
seconds while both siblings remained active. `src/format-gauge.ts` completed at
about ten seconds while `src/gauge.ts` remained active; the last file completed
at about fourteen seconds. Candidate-ready and succeeded frames still said that
nothing had been applied. Only after target-state and complete-set checks did the
Run show applying and then applied.

Post-process `status` returned sequence `24`, phase `applied`, application state
`applied`, `filesApplied: true`, and all three files at durable sequence `6` and
stage `succeeded`. Timestamps, model selection, and application time match the
live result and local database. Runtime session identifiers were verified locally
and redacted from public evidence. The fixture then passed `npm run
typecheck`, `npm run build`, and `npm run qa`; these remain external project
checks, not SCORE verification.

## Preserved post-isolation, pre-terminal-safety Run

Run `redacted` used GPT-5.6 Luna, medium reasoning,
and concurrency three after reporter/observer isolation landed. It applied three
reading files in `8.527s`; status matched at sequence `24`, and fixture
typecheck/build/QA passed. A later deterministic review found terminal-control
injection possible for malicious labels and paths. That renderer boundary was
fixed before the final gauge Run above. A subsequent guided prompt was cancelled
before approval while the final Unicode-format hardening landed; it created no
Run and changed no application files.

## Initial preparation (preserved)

- Change Plan: `redacted`
- Review: `.score/reviews/runner-observability-three-file-proof-review.html`
- Command: `npm run score:prepare`
- Preparation left `src/` empty. The three application files appeared only after the approved Runner application.
- The connected OpenCode catalog was inspected immediately before the Run. It advertised GPT-5.6 Luna and the `medium` variant.

## Initial real guided Run (preserved)

- Command: `npm run score:start -- --variant medium --concurrency 3`
- Terminal: real TTY captured with `script`
- Run: `redacted`
- Provider: `opencode` (displayed as OpenCode Zen)
- Model: `gpt-5.6-luna` (displayed as GPT-5.6 Luna)
- Variant: `medium`
- Runtime SDK/CLI: `0.0.0-next-17111` / `0.0.0-next-17111`
- Maximum concurrency: `3`
- Created: `2026-08-11T19:20:58.952Z`
- Applied: `2026-08-11T19:21:10.259Z`
- End-to-end Run time: `11.307s`
- Retries: none
- Generated source edits after the Run: none

| Target | Job | Attempt | Runtime session | Claimed | Terminal | Attempt time |
| --- | --- | --- | --- | --- | --- | ---: |
| `src/format-metric.ts` | `redacted` | `redacted` | redacted | `19:20:58.980Z` | `19:21:10.168Z` | `11.188s` |
| `src/metric-report.ts` | `redacted` | `redacted` | redacted | `19:20:59.580Z` | `19:21:08.005Z` | `8.425s` |
| `src/metric.ts` | `redacted` | `redacted` | redacted | `19:20:59.583Z` | `19:21:06.390Z` | `6.807s` |

## What the initial terminal demonstrated

The first live frame listed all three targets as `waiting` before any claim. All three then moved independently through `starting` and `Agent working`. `src/metric.ts` reached `checking output`, `candidate ready`, and durable `succeeded` at about six seconds while both siblings remained active. `src/metric-report.ts` completed at about eight seconds while `src/format-metric.ts` remained active; the last file completed at about eleven seconds.

Every candidate-ready/succeeded frame still said that nothing had been applied. After all three terminal file writes, the separate Run line advanced in this order:

1. `Generating candidates · 3 of 3 complete · nothing has been applied`
2. `Checking current target state · 3 of 3 complete · nothing has been applied`
3. `Checking the complete set · 3 of 3 complete · nothing has been applied`
4. `Applying all candidates · 3 of 3 complete · atomic application in progress; final outcome pending`
5. `Applied · 3 of 3 complete · all candidates were applied`

The live view also repainted elapsed time while stages were unchanged. The renderer labels this as local Runner liveness, not model progress.

## Initial durable status agreement

After process exit, `npm run score:status -- --run redacted` returned Run sequence `24`, phase `applied`, application state `applied`, `filesApplied: true`, and all three file observations at durable stage `succeeded` with sequence `6`. The status timestamps, provider/model/variant, and application time match the local Runner database and the live terminal result. Runtime session identifiers were verified locally and redacted from the sanitized public excerpt in `evidence/status-summary.json`.

## Initial external project checks

These checks ran after SCORE applied the complete set. They are fixture/project verification, not claims made by SCORE itself.

| Command | Result |
| --- | --- |
| `npm run typecheck` | passed |
| `npm run build` | passed |
| `npm run qa` | passed: `Runner observability live acceptance passed.` |

## Repository verification before the initial live Run

Before this live Run, the full repository gates passed on the implementation worktree:

- `npm run typecheck`
- `npm test` — 171 tests passed across 23 suites
- `npm run build`
- `npm run reproduce`
- `git diff --check`

The original deterministic renderer tests covered non-TTY append-only output
without cursor-control bytes. Later review hardening and the final gates are
recorded at the top of this file.

## Evidence and privacy

- `evidence/live-feed.txt` is a curated ANSI-free excerpt of the real TTY capture.
- `evidence/live-feed-terminal-safe.txt` is the curated ANSI-free excerpt of the
  final post-review TTY capture.
- `evidence/status-terminal-safe-summary.json` is the final sanitized status and
  identity summary.
- The original local capture is `.score/live-feed.raw`; `.score/` is ignored by this fixture and remains local.
- The post-isolation and final local captures are `.score/live-feed-final.raw`
  and `.score/live-feed-terminal-safe.raw`; both remain ignored and local.
- No credentials, authorization headers, raw provider bodies, private provider metadata, hidden reasoning, or unrestricted transcripts are preserved in the curated evidence.
- The validation preserves three successful explicit Runs across the hardening
  chronology. Failure paths, redaction, migration, recovery, non-TTY rendering,
  and observer-failure isolation are proven deterministically rather than by
  paid failure Runs. Failed readable output retains its state and digest, but raw
  rejected bytes are not copied automatically because arbitrary source cannot be
  proven credential-free.
