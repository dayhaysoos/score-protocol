# Runner observability: live progress and retained failure evidence

Status: exploration note, not an accepted decision or implementation plan

Reviewed: 2026-08-11

## Summary

SCORE should make every File Job understandable while it is running and after
it fails. The first observability work should provide two things:

1. a compact, filename-first live feed showing what stage each isolated Agent
   has reached; and
2. durable, sanitized failure evidence that remains inspectable after OpenCode
   sessions and disposable workspaces are deleted.

This is a dashboard and flight recorder, not another pilot. Observability must
not change prompts, retry work, decide whether a Job succeeded, weaken an
integrity check, or influence whether files are applied.

## Goal

A user who starts a Run should be able to answer these questions without
knowing SCORE's storage model:

- Which files are waiting, active, complete, or failed?
- Is the Runner still alive, and when did its stage last change?
- How long has each active file been running?
- Did a failure happen while starting the runtime, while the Agent was working,
  while SCORE inspected the output, or while the complete set was applied?
- Did the failed Agent produce no target, leave the starting target unchanged,
  or produce different bytes?
- Was anything applied?
- Which Run can be inspected later for the full local diagnostic record?

The normal display should answer the common questions in plain language. IDs,
digests, timestamps, and runtime-specific details should remain available in a
diagnostic view rather than dominating the ordinary experience.

## Current gap

The Runner already has a durable Run, Job, and Attempt state machine in
`runner.db`. It records pending and running work, terminal Job state, claim and
completion times, successful candidates, runtime session IDs on success, and a
failure tag and message on ordinary failure.

The normal CLI does not expose most of that information. It prints a starting
line, waits for the complete Run, and then prints final file states and the
application result. A healthy but slow Agent can therefore look stalled for
minutes.

Important evidence is also lost on failure. Failed Attempts usually do not
retain their runtime session ID. If the Agent wrote bytes before a runtime or
workspace-integrity failure, those diagnostic bytes disappear when the
disposable workspace is cleaned up. Complete-set integrity and application
failures are reported to the current process but are not fully retained as
Run-level diagnostics.

OpenCode V2's experimental session log is not a solution. At the pinned V2
version it is not a durable replayable record, and D-087 explicitly keeps it out
of the success gate. SCORE should report facts observed at its own Runner and
Runtime Adapter seams.

## Desired live experience

The interactive CLI should show one stable line per target file and a separate
line for the whole Run:

```text
Running Focus Board · GPT-5.6 Luna · Medium
Run 25cb4508 · 01:42 elapsed

✓ src/domain/task.ts                  succeeded         0:31
● src/App.tsx                         Agent working      1:42
● src/components/TaskList.tsx         checking output    1:17
○ src/components/FilterBar.tsx        waiting

Generating candidates · 1 of 4 complete · nothing has been applied
```

Only state changes and elapsed time should update. The display should not stream
model prose, tool arguments, or token-level activity. A short heartbeat should
show that the Runner process is alive and the Attempt remains nonterminal even
when its state has not changed. It must not imply that the model itself is
making measurable progress.

When the terminal is not interactive, the same facts should be printed as
append-only lines without cursor control. This keeps CI logs and captured
terminal output readable.

Per-file progress and whole-Run progress must remain visibly separate. A file
can have a candidate ready while the repository is still untouched. Application
begins only after every required Job succeeds and the complete candidate set
passes the existing integrity and target-state checks.

## Slice 1: live per-file progress

The feed should use a small fixed vocabulary based only on milestones SCORE
directly observes:

| Display stage | Authoritative observation |
| --- | --- |
| `waiting` | The Job is durably pending. |
| `starting` | The Attempt has been claimed and runtime setup is underway. |
| `Agent working` | The runtime session exists and the frozen Agent Input has been admitted. |
| `checking output` | Runtime work has ended and the Adapter is inspecting the assigned workspace and target. |
| `candidate ready` | The Adapter returned complete target bytes to the Runner. Nothing has been applied. |
| `succeeded` | The candidate and terminal Attempt/Job state were durably stored. |
| `failed` | The terminal failure and Attempt/Job state were durably stored. |
| `needs attention` | The Runner stopped with an externally ambiguous Attempt; it was not retried. |

The whole Run has its own later stages:

```text
generating candidates
-> checking current target state
-> checking the complete set
-> applying all candidates
-> applied | not applied | application failed
```

The likely smallest implementation is one progress recorder around the existing
Runner transitions, plus a narrow Runtime Adapter notification when a session
is created, the prompt is admitted, and workspace inspection actually begins.
The recorder accepts fixed milestones, not arbitrary provider logs, and keeps
only the current observed stage rather than creating a general event stream.

The terminal renderer is a separate, optional consumer of those observations.
If no renderer is supplied, execution and durable evidence behave exactly the
same. A renderer error cannot become a Job failure.

New nonterminal milestone writes are also best-effort. If recording `Agent
working` or `checking output` fails, the display may retain its previous stage
or show `not observed`, but that failure alone cannot fail the Job or block
application. Terminal evidence should be folded into the existing required
claim, success, failure, recovery, and application transactions. Those existing
lifecycle writes retain the same fail-closed operational role they have today:
if the Runner cannot maintain its durable source of truth, it cannot safely
claim that execution succeeded.

The CLI can render elapsed time locally from recorded timestamps. It does not
need to write periodic heartbeat rows to SQLite or poll OpenCode for invented
activity.

## Slice 2: retained failure evidence

The existing Attempt record should remain the durable home for per-file
evidence. The first version does not need a general event table, tracing
platform, or second operational database.

For every failed or ambiguous Attempt, the diagnostic view should retain:

- Run, Job, Attempt, and runtime-session IDs when known;
- target path and operation;
- provider, model, variant, and pinned runtime version;
- claimed, last-updated, and completed timestamps;
- the last stage SCORE directly observed;
- a stable failure category and sanitized human-readable message;
- the terminal provider or tool outcome that SCORE used, without raw response
  bodies or private metadata;
- target-output state: not observed, missing, present for a create operation,
  still equal to the starting bytes, or different from the starting bytes;
- a digest of diagnostic target bytes when any were readable;
- a local rejected-output copy when safely available, clearly labeled as
  diagnostic and never as an accepted Candidate; and
- the final application state, including an explicit statement when nothing was
  applied.

The starting-byte comparisons apply only when the operation began with a target
file. An unchanged target is an observation, not automatically a failure. A
replace Job may legitimately return unchanged bytes under D-088. The actual
runtime, integrity, or application error remains the reason for failure; the
byte state only helps explain what happened. `not observed` is required when
startup, interruption, workspace access, or cleanup prevented SCORE from
truthfully classifying the target.

Successful candidate storage remains unchanged. Failed diagnostic bytes must
not enter the accepted-candidate set, satisfy a Job, or become eligible for
application. Any retained bytes belong in Runner-owned application storage
beside the selected `runner.db`, never implicitly inside the target repository.
An explicit export may copy them to a user-selected destination.

The read side should expose one sanitized Run observation containing the Run,
its files, and each file's latest Attempt evidence. Both the live CLI and the
`status` command should use that same read model so that current and historical
views do not disagree.

## Smallest Module seam

Observability should deepen the existing Runner rather than create a parallel
execution system.

The small Interface is conceptually:

```text
record a fixed observed milestone for an active Attempt
record a whole-Run phase or terminal application failure
read the sanitized observation for one Run
```

The implementation can hide SQLite joins, timestamps, diagnostic artifact
paths, and runtime-specific redaction behind that Interface. Attempt evidence
stays on the Attempt; whole-Run integrity and application evidence stays on the
Run rather than being copied onto every file. Runtime Adapters report only the
few milestones they uniquely know; they do not gain access to `runner.db`,
application policy, or the real repository. Terminal rendering sits outside
this Module and reads its sanitized observation.

Core lifecycle writes remain authoritative. A display failure must not fail an
Agent or prevent valid candidates from being applied. Conversely, a progress
message must never manufacture terminal success before the existing Adapter,
candidate, complete-Run, drift, and application checks have succeeded.

## Information levels

### Normal live display

- Plan title and selected model/variant once
- Run elapsed time
- One target path, plain stage, and elapsed time per file
- Completed/total file count
- Current whole-Run stage
- A truthful reminder that nothing is applied until the complete set succeeds

### Diagnostic view

- Run, Job, Attempt, and runtime-session IDs
- Exact timestamps and durations
- Provider/model/variant/runtime versions
- Failure category, stage, and sanitized message
- Candidate presence, not-observed state, starting-byte comparison, and digests
- Local path to any retained diagnostic output
- Complete-set or application failure details

### Never retained or displayed

- Credentials, tokens, authorization headers, or provider secrets
- Raw HTTP response bodies or private response metadata
- Hidden reasoning or chain-of-thought
- An unrestricted model conversation transcript
- Ambient OpenCode configuration, skills, plugins, or user data
- Repository files other than the assigned target and existing frozen package
  references

The frozen Agent Input already has its own digest-bound storage. Observability
should reference that identity rather than create a second prompt archive.

## Invariants that cannot change

This work must preserve D-070, D-075, D-079, D-083, D-086, D-087, and D-088:

- SCORE Core remains non-agentic; the user explicitly starts the Runner.
- Every file still receives one isolated Agent session and disposable
  single-target workspace.
- The exact frozen Agent Input remains unchanged.
- No retry is introduced. An ambiguous Attempt still requires explicit
  recovery and is never automatically redelivered.
- One ordinary Job failure does not cancel successful siblings, but every Job
  must succeed before application.
- Target drift, candidate/package integrity, complete-set membership, and atomic
  unstaged application remain authoritative.
- A live progress stage is not proof of success.
- A generated candidate is not proof that the real project is correct.
- Project typechecking, builds, tests, linting, and browser QA remain
  post-application work in the real project.
- Failure evidence stays local and must not expose credentials or private
  provider metadata.

## Non-goals

The first observability work does not add:

- automatic or manual retry controls;
- an OpenTelemetry deployment, remote dashboard, or hosted log collector;
- per-token streaming, model thoughts, or full chat transcripts;
- a generic event-sourcing architecture;
- provider cost accounting or performance benchmarking;
- new Agent context, prompt rewriting, repository access, or semantic code
  verification;
- a synthetic project, AST analysis, typechecking, tests, builds, or execution
  inside SCORE; or
- a change to success, failure, recovery, or atomic-application policy.

## Acceptance criteria

### Live progress

1. Every target is visible before execution begins.
2. Concurrent files update independently using the fixed plain-language stages.
3. The display communicates elapsed waiting time often enough that a live
   Runner does not look abandoned, without claiming the model is advancing.
4. Whole-Run integrity and application phases are distinct from per-file Agent
   work.
5. Interactive terminals receive a compact updating view; non-interactive
   terminals receive stable append-only output.
6. Enabling, disabling, or breaking the renderer cannot change stored candidate
   bytes, Job outcomes, or application decisions.

### Failure evidence

1. A failed file remains diagnosable after its OpenCode session and workspace
   are deleted.
2. The evidence identifies the last observed stage and whether target bytes were
   not observed, missing, present, unchanged, or different as applicable.
3. A terminal failure retains any runtime-session identity known to the Adapter;
   a process interruption before terminal storage may honestly report it as not
   observed.
4. Rejected bytes, when retained, are local diagnostic evidence and can never
   enter the candidate set.
5. Provider, tool, integrity, interruption, and application failures use useful
   sanitized categories.
6. A `status` read after process exit reports the same terminal facts shown by
   the live CLI.
7. Tests prove that secrets and raw provider metadata are omitted.
8. Tests prove that observability cannot weaken all-Jobs, drift, integrity,
   recovery, or atomic-application rules.

## Open implementation questions

These choices can be explored before the note becomes an accepted decision:

1. Should the interactive heartbeat update every five or ten seconds?
2. Should rejected target bytes be retained by default in Runner-owned
   application storage, or only under an explicit local diagnostic option? In
   either case, the digest and byte-state classification should remain
   available.
3. Should the normal `status` command become human-readable with a separate
   `--json` form, or should the existing JSON command remain while guided
   execution owns the human view?

None of these choices changes SCORE's execution or application contract.
