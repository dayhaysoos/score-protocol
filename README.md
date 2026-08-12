# SCORE Protocol

**Structured Context Orchestration for Reliable Execution**

SCORE is a protocol for compiling an approved product specification and a
source snapshot into complete, reviewable instructions for one file agent
per target file.

SCORE Core does not write code. A user-owned Runner using a Runtime Adapter
reads the approved SCORE definition, starts the file agents, and owns every
filesystem operation. This repository contains both the definition-only Core
alpha proof and the first experimental Runner with its OpenCode Adapter. The
Runner is implemented here for integration testing without becoming part of
the portable Core protocol.

## The idea in plain English

Coding agents often spend part of their limited context searching a repository,
guessing which examples matter, and reconstructing cross-file decisions. SCORE
moves that broad discovery into a separate compilation step.

The Plan Compiler can inspect the declared Source Snapshot. It then creates one
closed File Brief for every file that will be created or modified.
Each brief contains the exact instructions, contracts, target
content, declarations, examples, and skills that its file agent needs. The
agent receives that resolved content directly; it never follows a path or opens
another file to discover missing project information.

Shared cross-file decisions are fixed as versioned Contracts before any file
agent starts. Agents do not negotiate those decisions or inspect one another's
work.

## Current workflow

```text
Human + LLM product deliberation
        |
        v
Agent-authored Change or durable Slice
        |
        +---------------- Source Snapshot
        |                         |
        v                         v
        LLM Plan Compiler with broad source access
        |
        v
Complete Compiled Plan
        |
        v
Deterministic validation and atomic SQLite import
        |
        v
Named HTML Change Review or Slice Review
        |
        v
Explicit human approval
        |
        v
Frozen Change revision and one Agent Package per File Brief
        |
        v
User-invoked Runner                                   outside SCORE
        |
        +-- Runtime Adapter -> file agent 1 -> owns file 1
        +-- Runtime Adapter -> file agent 2 -> owns file 2
        `-- Runtime Adapter -> file agent N -> owns file N
```

The Runner may use OpenCode, Cursor, another agent SDK, or a custom runtime.
Those are integration choices, not SCORE dependencies.

### Default alpha entry point

The user begins in the capable agent they already use. After they settle small
implementation work, “use SCORE” authorizes preparation. The authoring LLM
chooses the complete scope: one or more target files, requirements, documented
declarations, explicit context and purposes, skills, and constraints. SCORE
validates and enforces only that declared scope; it does not discover more files
or context, split the work, or invent tests.

For normal agent-managed work, the agent sends one structured Change document
from the exact project directory:

```bash
score change --input -
```

Standard input is the non-interactive agent seam, not a stream of simulated TTY
keystrokes. A Change may contain one File Brief or several coordinated File
Briefs. It supports `create` for an absent target and `modify` for a present
target; delete and rename are not supported. Revising the same logical Change
creates an immutable superseding revision instead of rewriting prior history.
The first request omits `change_id`; SCORE returns `changeId`, and the agent
supplies that exact value as `change_id` only when it submits the complete next
revision. `score change --schema` prints the authoritative machine schema.

Use a Slice when the work needs durable feature identity, editable authored
source, or dependencies on applied work. Slice drafts live under
`score/slices/`, retain a stable `slice_id`, and may name predecessor Slices in
an acyclic `after` list. They use the same exact objective, requirements, File
Brief, declaration, context, skill, constraint, review, approval, Runner, and
atomic-application semantics as Changes. Several Slices may intentionally
modify the same file when their dependencies establish the order; SCORE waits
to prepare a dependent revision until the Runner has atomically applied its
exact predecessor.

Deterministic SCORE creates or opens `.score/score.db`, freezes only the
declared inputs, expands them into the retained protocol model, and writes a
named HTML Change Review or Slice Review under `.score/reviews/`. The authoring LLM never designs
tables, writes SQL, or mutates protocol rows directly. `SliceDraft`,
`prepareSlice`, Change Plan, Coding Pass, and `passId` remain implementation
compatibility names.

SCORE treats this durable local state as private. On operating systems with
POSIX permissions, SCORE state directories use mode `0700`; `score.db`, its
SQLite sidecars, review artifacts, and `runner.db` use mode `0600`. Existing
SCORE-owned state and database files are tightened before use. A custom
`--runner-db` inside an existing directory requires that directory to already
use mode `0700`; SCORE does not silently change an arbitrary parent chosen by
the user. When that custom database is inside a Git worktree, SCORE installs
exact local exclusions for the database and its SQLite sidecars before the
Runner may create it. SCORE rejects symlinks and non-regular database or review paths
instead of following them outside the selected project or Runner state
directory. This state remains on the local machine so review and execution
history survive restarts. Remove the project's `.score/` directory and the
platform-specific Runner data directory only when that retained local history
is no longer needed.

There is no required compile-then-approve command ceremony. Change or Slice
preparation stops at `review_ready`; it records no approval, starts no Runner,
creates no candidate, and applies no source change. A successful Change result
also returns `humanApprovalRequired: true` and the `score start` next action, so
an agent cannot mistake review readiness for authorization. The user later
reviews and explicitly approves that exact revision before the configured
Runner may use its Agent Packages.

The repository now builds an installable CLI package with a `score` executable.
`npm run test:package` creates a tarball, installs it into a clean temporary
project, prepares and revises a Change through the installed binary, and checks
that the latest revision reaches `score list`. The package remains private until
a registry name and publication owner are chosen; local tarball installation is
fully exercised and does not require a registry publish.

Run `score doctor` to inspect Node, packaged SCORE resources, in-memory SQLite
initialization, the pinned OpenCode runtime, credential configuration, model
discovery, and whether the current directory can hold SCORE state. Use
`score doctor --json` for one compact machine-readable report. Doctor never
runs a model or writes project files or persistent SCORE state. Model discovery
does start an isolated temporary OpenCode server and may contact configured
provider services; the temporary state is removed afterward.

### Runtime adapters

Runtime Adapters are a first-class product integration surface: they are how a
user-owned Runner faithfully delivers frozen SCORE work to the coding runtime
the user chooses. A concrete adapter remains replaceable and sits
outside Core.

The first post-export experiment is now implemented with the pinned OpenCode V2
server/API and one agent per File Brief. Each invocation runs in a disposable
workspace containing only its assigned target and receives only the approved
Agent Input.
Its durable rolling queue uses a separate `runner.db`; it never adds execution
state to `score.db`. Successful candidate files remain durable in `runner.db`;
after every per-file Job succeeds, the Runner rechecks candidate and package
integrity plus the declared targets, then applies the complete candidate set to
the bound project directory. It does not type-check, test, build, or lint the
result. Those project checks remain explicit follow-up work for the user or
another agent in the real project. Unrelated project changes do not block
application. Git is optional; when present, the result is ordinary uncommitted
changes. From an installed SCORE package, the normal entry point is guided
`score start` (this repository retains `npm run runner -- start` as a local
development alias): choose a Change or Slice by title,
let the Runner verify its saved repository binding, review that root and the
target files, choose from models offered by OpenCode's currently connected
providers, and confirm approval, execution, and application once. The selected
provider remains visible in confirmation and execution output. When the selected
model advertises variants, the Runner also offers the adapter's current choices
or the OpenCode default. Guided start always displays the selected repository
and planned files. Changed, missing, or already-occupied targets are warnings in
that same confirmation instead of reasons to block the Run. Confirmation binds
the exact current target state to that Run; SCORE still applies nothing if a
target changes while agents work or if complete-set application fails. The
approved Source Snapshot remains unchanged agent context and provenance. A
confirmed binding is remembered in the local Runner database, so normal starts
require no repository argument. Clean plans are approved by that confirmation,
concurrency defaults to five, and provider, model, and variant identifiers stay
inside the adapter.

The Runner also exposes one compact, filename-first live view of every File Job
and retains a sanitized diagnostic record in `runner.db`. Interactive terminals
repaint every observation immediately and use a Run-level liveness indicator
between observations; individual File stages remain exact evidence rather than
invented progress. Append-only output stays event-driven with a five-second
process heartbeat instead of emitting animation frames. The Runner owns the
authoritative lifecycle and application phases. Runtime Adapters may report only
optional intermediate facts that they uniquely observe, such as matching prompt
admission or the start of assigned-target inspection. Those reports and the
replaceable terminal renderer are best-effort: they cannot make a Job succeed or
fail, change candidate bytes, or influence application. Required claim,
terminal, recovery, integrity, and application writes remain fail-closed.
Rejected target state and a digest of readable bytes may be retained, but raw
rejected bytes are not copied automatically because SCORE cannot prove arbitrary
source text contains no credential. Failure messages are stable category-derived
summaries, and terminal failures retain the last nonterminal stage separately.
Raw diagnostic content never enters the Candidate set.

Cursor remains the planned second adapter and comparison benchmark using the
same Agent Package seam and its own native model catalog.

See [Runtime Adapters](./docs/runtime-adapters.md) for the shared seam, the
OpenCode experiment, and the portability rules for future integrations.

## What SCORE Core owns

SCORE defines and records:

- accepted product intent and stable requirements;
- the exact Source Snapshot used for compilation;
- exact documented declaration text with explicit owners and consumers;
- versioned shared Contracts;
- one immutable File Brief and closed Context Set per target file;
- explicit bindings explaining why every Context Item is present;
- complete inline Agent Input, including any selected skill content;
- deterministic structural validation and compiler findings;
- human Change/Slice Review and approval, identities, digests, and supersession;
- authoritative JSON Agent Packages, deterministic Agent Input Markdown, and a
  deterministic entity-specific HTML review.

## What SCORE Core does not own

SCORE Core does not:

- launch or schedule file agents;
- choose a model provider or agent SDK;
- give file agents repository or SQLite access;
- create, replace, patch, merge, or test source files;
- collect agent results in the first alpha;
- decide whether generated code is correct or ready to ship;
- require benchmarking or model comparison.

The Runner owns per-file execution and atomic application. The user's normal
engineering workflow owns project testing, review, and adoption of the
resulting code.

## The first SQLite alpha

The first alpha asks one narrow question:

> Can an LLM compile approved product intent and an exact Source Snapshot
> into complete per-file Agent Inputs stored in SQLite, such that a user-owned
> Runner can launch each file agent without discovering more project context or
> composing another project-specific prompt?

The fixture is deliberately small:

- one tiny Source Snapshot stored completely in SQLite;
- one shared versioned Contract;
- one Change;
- exactly two File Briefs;
- one existing file to modify;
- one new file to create;
- one small resolved skill supplied to only the brief that needs it.

The LLM Plan Compiler must generate the complete Compiled Plan. Humans do not
hand-author the File Brief or Context Set rows. Deterministic code validates the
plan, imports a valid definition atomically, materializes the two Agent
Packages, and presents them for explicit human approval.

The SCORE alpha ends at approved Agent Package export. The separate Runner
experiment can now exercise those packages through OpenCode, but it does not
extend SCORE's protocol boundary or prove code quality, provider portability,
or a reliability advantage.

## Important distinctions

### Compiler access is not agent access

The Plan Compiler may inspect the complete declared Source Snapshot.
Each file agent receives only its approved Agent Input. Provenance may record
where a fact came from, but a path, URL, symbol, or database identifier never
replaces the fact itself.

### Deterministic validation is not perfect-context detection

Validators can prove structural facts: required bindings exist, references are
valid, kinds and versions match, targets do not conflict, and Agent Packages
agree with stored rows. Declaration text and generated source remain opaque to
SCORE: validators do not parse their syntax, infer imports or types, or prove
that generated code implements the authored description. They also cannot prove
that an LLM discovered every fact the work will need.

A specific missing or ambiguous fact discovered before approval is a
Compilation Gap and blocks approval until resolved. An agent-reported
Context Gap belongs to a possible later execution-reporting extension and is
not part of the first alpha.

### Definition history is not execution history

Changing accepted intent or any compiled input creates a new immutable
definition with explicit supersession links. Reusing an unchanged approved
definition does not change it. The SCORE alpha stores no execution history.
The experimental Runner stores its operational Runs, Jobs, and Attempts in a
separate database without treating them as SCORE protocol records.

## Ideas deliberately moved out of the alpha

Earlier drafts explored a broader SCORE-owned orchestration runtime. SCORE Core
and the current SQLite alpha do not include:

- SCORE-owned dispatch, scheduling, retries, or agent lifecycle;
- normative Run, Attempt, Result, Artifact, Candidate, or Context Gap tables;
- repository assembly, testing, Acceptance Oracles, or verification;
- generated-source parsing, inferred module paths, or synthetic project environments;
- benchmark fixtures as a product abstraction;
- a required agent-result format such as patches or complete returned files;
- OpenCode, Cursor SDK, Herdr, or any other runtime as a Core protocol
  dependency.

These ideas are either rejected as SCORE responsibilities or explicitly
deferred until a later integration actually needs them.

## Inspiration

- [Mise en Place for Agentic Coding: Deliberate Preparation as Context Engineering Methodology](https://arxiv.org/abs/2605.05400)
- [Configuration Smells in AGENTS.md Files: Common Mistakes in Configuring Coding Agents](https://arxiv.org/html/2606.15828v2)
- [What 1,281 agent runs reveal about coding agent failure in large codebases](https://tessl.io/blog/coding-agent-failure-patterns-large-codebases/)
- [On the risk of coding before testing: An empirical study on LLM-based test generation workflow](https://arxiv.org/html/2607.05139v1)
- [How we built AI code review](https://blog.cloudflare.com/ai-code-review/) — side research and inspiration; not adopted as SCORE architecture or terminology.

## Documentation map

Read the project in this order:

1. [README.md](./README.md) — current thesis, boundaries, and alpha scope.
2. [ALPHA.md](./ALPHA.md) — retained definition-only Core proof, reproduction
   commands, and its deliberately narrower non-goals.
3. [examples/coding-profile-run.md](./examples/coding-profile-run.md) — one
   concrete two-file example.
4. [examples/score-five-file-demo/](./examples/score-five-file-demo/) — a
   runnable five-file nested project: prepare, review, then start SCORE with
   three short commands.
5. [examples/score-react-todo-experiment/](./examples/score-react-todo-experiment/)
   — a rerunnable two-file React slice with a committed generated result.
6. [docs/sqlite-alpha.md](./docs/sqlite-alpha.md) — proposed alpha storage and
   compilation flow.
7. [docs/runtime-adapters.md](./docs/runtime-adapters.md) — the external
   execution seam and first OpenCode V2 integration experiment.
8. [profiles/coding/README.md](./profiles/coding/README.md) — Coding Profile
   rules and conformance cases.
9. [CONTEXT.md](./CONTEXT.md) — canonical glossary.
10. [docs/terminology.md](./docs/terminology.md) — canonical product language
   mapped to retained alpha storage and wire identifiers.
11. [docs/decisions.md](./docs/decisions.md) — accepted decisions and their
   status.
12. [docs/open-questions.md](./docs/open-questions.md) — explicitly deferred
   design questions; the local alpha has no remaining decision blockers.
13. [spec/core.md](./spec/core.md) — exploratory protocol model, with future
   execution concepts clearly separated from the alpha.
14. [docs/research/](./docs/research/) — non-normative research notes.

When documents appear to conflict, the latest accepted decision controls. The
README and SQLite alpha describe the current implementation boundary; deferred
Core concepts do not expand that boundary.
