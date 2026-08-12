# Runtime Adapters

**Status:** Accepted post-export integration design. The first local OpenCode
experiment is implemented. Concrete runtimes remain replaceable integrations
rather than SCORE Core dependencies.

## Plain-English purpose

SCORE prepares and approves the exact work definition. A Runtime Adapter is the
small piece of integration code that hands each approved Agent Package to a
particular coding-agent runtime.

The adapter does not decide what to build. It does not search the repository,
improve the prompt, or fill in missing project context. It faithfully delivers
SCORE's frozen Agent Input while the user-owned Runner enforces the Run Rules.

```text
Approved Change Plan
        |
        v
SCORE approved-package read
        |
        v
User-owned Runner
        |
        +-- OpenCode Adapter --> OpenCode agent
        +-- Cursor Adapter ---> Cursor agent
        `-- another adapter --> another Worker
```

The user deliberately starts the Runner and confirms the exact reviewed Plan.
SCORE does not silently select or launch an adapter.

## Shared adapter seam

Every Coding Profile Runtime Adapter should:

1. select one explicitly approved Change Plan;
2. obtain its frozen Agent Packages through SCORE's Runner-facing interface;
3. verify the Plan Approval bindings, package digests, protocol version,
   Profile version, required Capabilities, target, and Allowed Change;
4. create one independent Agent invocation per File Brief;
5. keep Run Rules in the Runner and send only `agent_input` to the Agent;
6. add no project-specific facts, repository discoveries, or rewritten
   implementation instructions;
7. prevent the Agent from reading SQLite, the repository, another File Brief's
   workspace, or another Agent's output;
8. allow only the operations that the concrete adapter declares it can enforce
   against the single target; and
9. make runtime-specific progress, failures, and produced files visible to the
   user without claiming that SCORE recorded or accepted them.

An adapter may add static provider mechanics required to start the runtime, but
those mechanics must not change the meaning of the approved Agent Input.
Documented declarations, import instructions, and other project context are
already frozen as authored text in the approved package; every Runtime Adapter
delivers them unchanged.

### Observations are optional and non-authoritative

The Runner owns lifecycle truth. It records the durable `waiting`, `starting`,
`candidate ready`, terminal Job, whole-Run integrity, and application facts at
the same transitions that already own execution. A Runtime Adapter may use one
small optional observer to report only facts it uniquely sees:

- a runtime session was created, without claiming Agent progress;
- the exact frozen Agent Input was admitted to that session; and
- inspection of the assigned output actually began.

The Runner normalizes those facts into its adapter-neutral display vocabulary.
Renderers and status readers never import OpenCode types or interpret provider
events. Unknown or missing observations remain unknown; elapsed-time heartbeats
prove only that the local Runner is alive.

Intermediate observations, their recorder, and the terminal renderer are all
best-effort. A failure in any of them cannot change prompts, runtime selection,
candidate bytes, Job outcomes, recovery, integrity checks, or application. The
existing claim, success, failure, recovery, and application transactions remain
authoritative and fail closed.

`runner.db` retains the current sanitized observation for each Run and latest
Attempt, including known identities, fixed stages, timestamps, a monotonic
revision, stable failure categories, category-derived safe messages, safe
allowlisted terminal provider/tool outcomes, the last nonterminal stage before a
failure, and an honest assigned-target state. SCORE retains the digest of
readable rejected target bytes but does not automatically copy their raw content:
a finite secret denylist cannot prove arbitrary source text is credential-free.
Raw diagnostic content never enters successful candidate columns, never
satisfies a Job, and can never be applied. Application evidence is tri-state:
the complete set is known applied only after success, known untouched before
application, and unknown while applying or after an application failure that
may require recovery. Credentials, authorization headers, raw response bodies,
private provider metadata, hidden reasoning, transcripts, and ambient OpenCode
data are neither retained nor rendered. The frozen Agent Input is referenced by
its existing digest instead of being archived again.

Runner schema upgrades are additive and serialize concurrent first-open work.
The privacy migration replaces legacy free-form failure messages with the stable
category summary, sanitizes stored terminal outcomes and runtime-session IDs,
and clears legacy raw-copy paths before marking that migration complete.
Historical Runs remain inspectable without presenting invented stages or target
comparisons.

### Candidate delivery is adapter-owned

The Runner-facing result of one successful invocation is the complete candidate
content for the File Brief's Runner-owned target, together with attributable
runtime metadata. A disposable filesystem workspace is one way to obtain that
content; it is not part of the shared Runtime Adapter contract and is not a
universal SCORE requirement.

The OpenCode Adapter uses a single-target disposable workspace because
OpenCode's native workflow reads and edits files. A future API adapter may
instead send the self-contained Agent Input to a model and receive the complete
candidate content directly. A remote-sandbox adapter may manage a filesystem in
its own environment. In every case, the Runner assigns the target path and the
adapter returns content for that target; the Agent does not select or redirect
the destination.

Direct-content adapters should use a structured response or a dedicated
candidate-submission tool rather than extracting source from Markdown fences.
They must reject an empty, malformed, or multiple-file response and return the
runtime, model, version, and session metadata needed to attribute the candidate.
The Runner records the exact candidate bytes and digest under the claimed Job.

Workspace mechanics therefore remain private adapter implementation details.
There should be no user-facing `--no-workspace` switch: selecting a compatible
Runtime Adapter selects its delivery mechanism. If routing eventually needs to
distinguish mechanisms, an internal adapter capability such as
`filesystem-edit` or `content-return` may describe them without changing the
Agent Package or normal CLI experience.

### Adapter-owned model catalog

Model availability belongs to the selected coding runtime, not to SCORE and not
to a global Runner registry. Every adapter exposes the same small catalog seam:

- discover the models available to the user's current runtime configuration;
- return an opaque selection key, readable model name, optional source, and any
  opaque model-specific variant identifiers advertised by the runtime;
- translate the selected model and optional variant into that adapter's internal
  run configuration;
- pin any CLI or SDK versions needed to make that translation reproducible.

The guided Runner uses only this normalized catalog. It never parses provider
IDs, assumes that two Runtime Adapters offer the same models, or maintains a
copied list that can drift. The OpenCode Adapter reads the pinned V2 provider
and model endpoints for the same disposable Location. It offers only enabled
models whose provider appears in that active provider response and preserves
the variant IDs advertised on each model. For supported legacy `type: "api"`
credentials, discovery explicitly connects the key inside the private V2
runtime and waits for the asynchronous provider/model catalog refresh before
using the result. A configured OpenCode Zen account can therefore show its
models and variants while another active provider contributes its own catalog.
If no active provider contributes a model, discovery fails before confirmation,
Plan Approval, or Run creation.
Readable provider identity remains visible beside model names in guided choices,
confirmation, and execution output so duplicate model names are unambiguous. A
Cursor Adapter should implement the same seam through Cursor's native listing
or SDK. Provider, model, and variant IDs remain available as low-level adapter
configuration for automation, not normal guided input. Discovery runs in
disposable isolated OpenCode config, data, cache, state, and database paths. It
may copy the credential index there and bridge supported API keys through V2's
private connection endpoint, but it never renders credentials and deletes the
directory immediately afterward. Job execution still copies and connects only
the selected provider's credential.

A model variant is optional execution configuration for one Run. SCORE treats
its ID as an opaque adapter-owned value: it does not maintain a reasoning enum,
interpret provider settings, or infer choices from model names. Guided mode asks
a second question only when the selected model advertises variants. Selecting
`OpenCode default`, or omitting `--variant` during noninteractive execution,
stores no explicit variant and omits it from OpenCode requests. One explicit
selection is frozen on the Run and reaches every Job. It never enters the Change
Plan, Agent Package, Plan Approval, or their digests.

The adapter may humanize an advertised ID for presentation, such as rendering
`xhigh` as `Extra high`. Those labels neither define membership nor translate
an ID into provider configuration; discovery output remains the only source of
which variants exist, and the exact selected ID is the only value persisted and
forwarded.

The first SQLite alpha still ends at approved Agent Package export. The Runner
implemented beside it is the immediately following integration experiment, not
a hidden responsibility of the SQLite materializer.

## Running the local experiment

Start the normal guided flow:

```sh
npm run runner -- start
```

The Runner then:

1. lists reviewed Change Plans by title, file count, and status;
2. shows the selected Plan's objective and exact files;
3. resolves the selected Plan's saved local project binding, or verifies and
   remembers the current project directory the first time;
4. compares every declared target with its frozen base state so guided mode can
   show current-state warnings before discovering models or recording Plan
   Approval;
5. asks the OpenCode Adapter for models from its currently connected providers;
6. lets the user search and select a readable model name with its provider;
7. if that model advertises variants, lets the user select one or keep the
   OpenCode default;
8. shows the resolved project root and exact target files, then asks once
   whether to approve, run, and apply a clean unapproved Plan, or simply run and
   apply an already approved Plan;
9. recaptures the confirmed target state immediately before recording Plan
   Approval;
10. shows every planned target before work starts and maintains a compact live
    view while running up to five independent file agents at once;
11. requires each adapter invocation to return its assigned target without any
    undeclared workspace change;
12. after every Job succeeds, rechecks every declared target;
13. rechecks the complete set of stored opaque candidate bytes, digests, frozen
    Agent Inputs, and Agent Package bindings; and
14. atomically applies every `create` and `replace` target together; unrelated
    project changes are ignored, and in a Git-backed project the result is
    ordinary uncommitted changes.

The Runner stops after application. It does not type-check, test, build, or lint
the resulting project and never reports those project checks as passed. The user
or another agent runs the real project's checks afterward.

The user is not asked for a pass ID, review ID, provider ID, approval authority,
or rationale. The selected Plan still binds the exact internal identifiers and
digests, and SCORE records local approval provenance under the hood. Plans with
blockers cannot be selected. Warnings require a separate explicit review and
waiver; the guided path never hides or auto-waives them. Use
`--concurrency <number>` only when the default of five is unsuitable. The
current safety maximum is 32.

To choose a variant without the second guided question, keep the normal flow
and add its exact advertised identifier:

```sh
npm run runner -- start --variant low
```

The model question still appears. An unknown variant fails before confirmation,
Plan Approval, Run creation, or agent execution.

The normal command has no repository argument. `runner.db` remembers one local
project root for the resolved `score.db` path and reuses it on later starts.
When no binding exists yet, the Runner uses the exact canonical current project
directory. It never widens a nested project to a containing Git root. It saves
that root after the user confirms and the declared target state is rechecked. Git
initialization is not a prerequisite.
`--repo <path>` is an optional one-time override or intentional rebind; it also
must resolve to a safe canonical project directory before replacing the saved
root. A failed override never destroys the last valid binding.

Guided preflight checks only declared targets. Each target may currently be a
regular file or absent. A changed `modify` target, a missing target, or an
already-occupied `create` target is shown as a warning in the existing final
confirmation; it does not block the Run. A symbolic link, non-regular target,
unsafe path, or unavailable root remains a hard failure. SCORE does not
enumerate or monitor unrelated project files.

Confirmation binds the canonical root and every target's exact current state:
absence or a content digest. This local execution state does not revise the
Change Plan, Agent Package, Plan Approval, Source Snapshot, or any package
digest. The state is checked again before approval and enqueue, then after all
agents finish and throughout atomic application. A target edit made while
agents are running blocks the complete set; an unrelated edit does not. A
confirmed present file is replaced even when the approved operation was
`create`, and a confirmed absence is recreated even when the approved operation
was `replace`.

Noninteractive and low-level starts retain the strict Source Snapshot preflight
until an explicit noninteractive overwrite interface is designed.

After confirmation, `start` asks SCORE for the complete approved export through
a read-only, file-must-exist database interface that never migrates or
initializes `score.db`. If the exact approval is absent or stale, enqueue fails
with `PlanNotApproved` and creates no Run or Job. Otherwise, the Runner freezes
one Job per Agent Package in its durable Runner database inside one transaction,
then starts a rolling worker pool. Concurrency is a ceiling, not a batch size or
file dependency.

The text-only documented-interface boundary is exported as
`score.approved-pass-export@0.1.0-alpha.5`. An older export is rejected before
Run creation rather than being silently reinterpreted; prepare and approve the
slice again to create a compatible export.

The normal flow reads its SCORE definition database from
`<current directory>/.score/score.db` unless `--score-db` is supplied. That path
is an already-created preparation/review artifact, not an Agent workspace. Runner
state defaults outside the project: macOS uses
`~/Library/Application Support/SCORE/runner.db`, Linux uses
`$XDG_DATA_HOME/score/runner.db` or `~/.local/share/score/runner.db`, and Windows
uses `%LOCALAPPDATA%\SCORE\runner.db`. `--runner-db` may name an explicit
alternative.

`score.db` and `runner.db` are an enforced storage boundary: their resolved
paths must differ, and the Runner refuses the operation before creating tables
when they identify the same database.

For scripts and debugging, the phases can still be operated separately. This
low-level interface deliberately exposes stable internal routing values:

```sh
npm run runner -- enqueue --pass "<pass ID>" --provider "<provider>" --model "<model>"
npm run runner -- work --run "<run ID>"
npm run runner -- status
npm run runner -- status --run "<run ID>"
npm run runner -- export-candidates --run "<run ID>" --destination "<new directory>"
npm run runner -- counts
```

Without `--run`, `status` prints the latest Run for the repository saved for the
current SCORE project. It never falls back to the latest Run from another
project in the global Runner database. Use `--run <run ID>` to inspect any
specific retained Run, including an older Run.

A noninteractive one-command run uses the same explicit values:

```sh
npm run runner -- start --pass "<pass ID>" --provider "<provider>" --model "<model>"
```

Append `--variant "<variant ID>"` to either command to select an advertised
variant. Without it, the Runner does not discover or invent a default variant
and OpenCode uses its own default behavior. An explicit unadvertised variant is
rejected before repository preparation or Run creation.

Both forms reuse the same saved binding. Add `--repo <path>` only to establish
or intentionally replace that binding.

`export-candidates` materializes only candidates from successful Jobs into the
explicitly named new, non-applying directory. It verifies each stored candidate
and package digest and exports successful sibling files from a partial Run for
diagnosis. Candidate source remains opaque; the exporter does not parse it,
perform project typechecking, or run project commands. It preserves each
declared relative target path, refuses to overwrite an existing destination,
and has no current-working-directory default. This does not modify the source
tree or mark a candidate accepted.

An Attempt that was running when the Runner stopped is ambiguous: the external
agent may have completed just before the local process exited. `work` will not
redeliver it. It stops with `RunRecoveryRequired` until the user explicitly
marks the abandoned Attempt for inspection, after which untouched pending Jobs
may continue:

```sh
npm run runner -- recover --run "<run ID>"
npm run runner -- work --run "<run ID>"
```

Recovery records `needs_attention`; it is not an automatic retry. Successful
candidate content and its digest are retained in the Runner database, never in
`score.db`. Once all Jobs finish, `work` performs the same guarded complete-set
repository application as `start`.

Interactive execution repaints every observation immediately, keeps one stable
filename-first line per target, and animates a separate Run-level liveness marker
at 100 ms between observations. File markers and persisted stage text stay
static: the animation means only that the local Runner is alive, not that the
model advanced. Non-interactive execution emits the same sanitized facts as
append-only text without cursor controls or animation frames; its five-second
heartbeat remains a quiet factual liveness record. `TERM=dumb`, CI, and
`SCORE_REDUCED_MOTION=1` select the static fallback. `status` keeps
its JSON contract and adds the same sanitized observation read model used by the
live view, so terminal facts remain inspectable after OpenCode sessions and
workspaces are deleted. The terminal boundary projects labels and target paths
into bounded single-line text, removes terminal control sequences, and uses the
Job identity when a target has no printable representation. Durable status JSON
keeps the original validated values.

The CLI itself does not navigate into the source repository for Agent work. For
each Job, the OpenCode Adapter creates an OS-temporary directory, places the
single assigned target under its `workspace/` directory. One disposable
OpenCode server belongs to the Run; each V2 session binds its own Job workspace
as its Location. After the adapter establishes a successful terminal OpenCode
result, the Runner validates the assigned artifact boundary, stores its bytes in
`runner.db`, and deletes the Job workspace. Only after all isolated Jobs succeed and the Run
server shuts down does deterministic Runner code recheck the bound repository
and install the complete set at the approved relative target paths.

## First experimental adapter: OpenCode V2

The first Runtime Adapter uses one disposable pinned OpenCode V2 server per Run
and one V2 session per File Brief. The Runner pins the selected provider, model,
and optional variant in adapter configuration rather than SCORE protocol data.
It calls the V2 HTTP API directly because the pinned beta client package is not
currently loadable by Node's ESM resolver; this does not add another execution
harness or change the Runtime Adapter boundary.

This first adapter supports `create` and `replace`. A package requiring
`delete`, another protocol or Profile version, a different Allowed Change, or
an unsupported required Capability is rejected before the Runner transaction
creates a Run or Job.

For each Run, the OpenCode Adapter opens one scoped runtime around the worker
pool. The first claimed Job starts `opencode2 serve` on loopback with an
ephemeral port and generated password in its own disposable control directory.
Its process configuration denies every capability by default and contains only
the selected provider credential and provider overlay.

For each approved Agent Package, the OpenCode Adapter should:

1. create a fresh disposable workspace whose root is not the real repository;
2. for `replace`, seed only the assigned path with the exact base content bound
   to the approved definition;
3. for `create`, begin without the target file;
4. inherit no repository rules, skills, MCP configuration, indexes, or ambient
   project files;
5. create a distinct session whose V2 `location.directory` is that exact Job
   workspace;
6. use the SCORE-only V2 agent policy, which continues the default denial and
   permits only read and edit inside that Location; external-directory access,
   shell, subagents, skills, web access, questions, plugins, MCP, formatting,
   and LSP remain disabled;
7. give that agent one static SCORE system instruction that treats the unchanged
   Agent Input as implementation work, makes the assigned target file the
   deliverable instead of prose or a code block, and forbids project checks;
8. send the approved `agent_input` as the unchanged user message without
   another LLM rewrite or project-specific augmentation;
9. when the Run selected a variant, pass its opaque ID to V2 session creation;
   otherwise omit the field;
10. submit the prompt with a fresh message ID, require the returned
   admission receipt to match it, and call V2 `session.wait`;
11. after wait settles, read every page of projected messages; provider errors,
    explicit error finishes, tool errors, unsettled tools, or the absence of a
    completed assistant turn fail;
12. reject the invocation if it creates, changes, or deletes any other path;
13. delete the session after it reaches a terminal result; and
14. return the produced target to the Runner as opaque candidate content for
    byte-integrity validation and storage in the separate Runner database.

After every worker settles, the adapter closes the shared server, awaits its
process exit, and removes its isolated config, data, cache, state, database,
and home before the Runner finalizes the Run or applies candidates. A provider
or pinned-CLI mismatch between Jobs fails closed instead of opening another
server.

V2 `session.wait` establishes that the agent loop is idle. At this preview pin,
`opencode2 serve` starts its event bus without durable-event persistence, so the
experimental session-log endpoint returns a synchronization watermark without
the execution events it advertises. SCORE therefore does not pretend that log
is an authoritative success record. It requires the matching prompt admission,
native wait completion, every page of projected messages, no projected message
or tool error, every tool settled, at least one completed assistant turn, and
the ordinary candidate-integrity checks. An explicit `finish: "error"` fails.
Other assistant `finish` values are not independently authoritative; in
particular, `finish: "unknown"` is allowed behind those stronger observable
facts.

Server startup, post-start catalog readiness, and per-session health/creation
are all abortable and bounded; their configured default is 10 seconds per
phase. Once the disposable session exists, the adapter owns a 30-minute model
execution deadline covering prompt admission and terminal monitoring. Session
interrupt and deletion requests have their own five-second cleanup bounds, and
owned process shutdown retains its forced-stop bound. These limits are Runtime
Adapter configuration, not Change Plan or Agent Package data, and deterministic
tests supply shorter values. Deadline expiry produces a specific adapter
failure. Effect interruption represents Runner cancellation. Both cases
interrupt active sessions before normal session deletion and shared server
shutdown; their finalizers are awaited. While worker execution is active, the
CLI translates `SIGINT` and `SIGTERM` into that Effect interruption and waits
for cleanup before exiting with an interruption result. It does not
automatically redeliver the now-ambiguous Attempt.

Assistant error reporting keeps the safe provider error category, message, and
status code needed to distinguish authentication and API/rate-limit failures.
It deliberately omits response headers, response bodies, metadata, credentials,
and request secrets. HTTP transport failures retain nested error messages, and
loss of the local server connection is reported separately from provider
failure. Completion comes from the typed V2 prompt, wait, and message endpoints,
never from scraped process output or elapsed time.

The local implementation pins `@opencode-ai/cli` to
`0.0.0-next-17111`, records that exact CLI and V2 API contract version on the
Run, and refuses a mismatched CLI before server startup. Its default executable
is the project-local `opencode2` binary;
`--opencode-command` exists for controlled testing but must report that same
version. Each workspace is created under the operating system's temporary
directory, outside the real repository. OpenCode config, data, state, and cache
locations plus the V2 database are isolated inside the disposable Run
directory. V2's global-discovery home is redirected to a private directory, preventing V2 from
reading global `.claude/skills` or `.agents/skills`, and inherited V2 server-
password controls are removed so private server authentication is always owned
by this adapter. Project config discovery is explicitly disabled. Each session's
Location contains only its assigned target state; read/edit permission covers
that Location because V2 has no per-session permission override. The Runner's
authoritative post-run path and symbolic-link check rejects every undeclared
entry, so the effective file boundary remains the one assigned target.

To keep normal `/connect` API-key authentication working without inheriting
global OpenCode project behavior, the CLI reads the standard OpenCode
`auth.json` when present. Catalog discovery connects its `type: "api"` entries
through V2's private `connect/key` endpoint, and execution copies and connects
only the selected provider entry. Both paths wait for V2's asynchronous
integration and model-catalog refresh before use. The pinned preview records its
legacy credential migration as completed without importing these keys, so SCORE
does not rely on that migration. Other legacy credential types are not claimed
supported by this bridge. Environment-based provider credentials continue to
work. A custom provider definition can be supplied with
`--opencode-provider-config "<opencode.json>"`; the Runner copies only the
selected entry from its `provider` or `providers` section and ignores
instructions, plugins, MCP servers, and every other ambient setting.
`--opencode-auth "<auth.json>"`
overrides the standard credential path.

`score doctor` checks the pinned OpenCode binary and performs bounded model
catalog discovery through the same adapter seam. It creates an isolated
temporary OpenCode runtime and may contact configured provider services, but it
never creates a model session or submits a prompt. It also checks Node, packaged
SCORE resources, SQLite initialization in memory, credential structure, and the
current project directory without writing project files or persistent SCORE
state. `score doctor --json` returns the same checks as one compact JSON report.

OpenCode permissions are defense in depth, not a process sandbox. Shell access
has the host user's filesystem, process, and network authority. If a later File
Brief genuinely requires shell access, the Runner must use a narrow allowlist
inside stronger process isolation and must still enforce the post-run file diff.

The Runner deletes every V2 session through the authenticated loopback API,
then waits for the Run's server process to exit (escalating to forced
shutdown if needed) and removes the shared runtime directory. Timeout and
cancellation first request typed session interruption. Cleanup runs after success,
provider failure, malformed completion, timeout, and interruption. Candidate
content and runtime session identifiers remain only in `runner.db`; no OpenCode
session data is intentionally retained in the user's global OpenCode data
directories.

Official OpenCode references:

- [OpenCode V2 client/API](https://opencode.ai/v2/docs/build/client)
- [OpenCode V2 permissions](https://opencode.ai/v2/docs/permissions)
- [OpenCode V2 providers](https://opencode.ai/v2/docs/providers)
- [OpenCode V1 to V2 migration](https://opencode.ai/v2/docs/migrate-v1)

## Planned second adapter and comparison benchmark: Cursor SDK

Cursor is the planned second Runtime Adapter. It would receive the same approved
Agent Packages, run in independently disposable workspaces, and satisfy the same
Runner-enforced file boundary. Cursor-specific prompts, model identifiers,
session data, and auto-review behavior remain outside SCORE.

Running both adapters makes the seam real and gives the project a controlled
comparison. Useful observations include contract satisfaction, forbidden file
changes, required human correction, latency, and cost. Benchmark results do not
change a Plan Manifest or prove one runtime universally superior.

Official Cursor references:

- [Cursor SDK release](https://cursor.com/changelog/sdk-release)
- [Cursor SDK execution controls](https://cursor.com/changelog/sdk-updates-jun-2026)

## Additional adapters

Other agent SDKs, command-line agents, remote services, deterministic tools, or
human workflows may also be adapted. Each adapter may use its runtime's native
invocation, streaming, editing, and result mechanisms. Compatibility comes from
preserving the same approved Agent Package seam, not from forcing every runtime
to expose OpenCode's or Cursor's interfaces.

The same approved Change Plan should therefore be reusable with multiple
compatible adapters without recompilation. Changing the adapter or model starts
a different external execution; it does not mutate the approved definition.

Whether concrete adapter packages live in this repository or in separate
packages is an implementation and distribution choice that does not change this
seam.

The implemented alpha retains legacy storage and wire names. See
[Terminology](./terminology.md) for their exact mapping to the language used
here.
