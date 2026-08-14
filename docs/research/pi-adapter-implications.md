# Pi adapter implications for SCORE

**Status:** research recommendation, not an implementation plan

**Date:** 2026-08-13

**SCORE baseline:** [`a4871bc`](https://github.com/dayhaysoos/score-protocol/tree/a4871bc460673f099db4219bf5f71c7f4f0c1b6e)

**Pi baseline:** [`@earendil-works/pi-coding-agent` v0.84.1](https://github.com/earendil-works/pi/tree/v0.84.1), tag commit `53fa77ccd8a279eb87e92294ef3687b03ff80112`

## Current planning decision

The researched security fact remains unchanged: Pi's built-in filesystem tools
are not confined to `cwd`, so SCORE cannot expose them while claiming that the
real project is untouched before atomic application.

The product plan no longer limits an Agent to an exact-target-only view inside
its disposable workspace. Each Agent workspace will instead contain the frozen
target plus explicitly selected frozen context files. SCORE-owned Pi tools may
list, read, write, create, or delete canonical relative paths inside that
workspace, while rejecting absolute paths, traversal, symlink escape, and any
host path outside it. Context does not need read-only enforcement: all internal
non-target changes are disposable, only the assigned target is extracted as the
candidate, and the real project remains untouched until SCORE applies the
complete verified candidate set atomically.

References below to pathless exact-target tools describe the conservative
research recommendation that preceded this product decision. The authored
Slices under `score/slices/` are authoritative for implementation scope.

## Bottom line

Pi is a viable SCORE runtime adapter, and it can preserve the same externally visible behavior as the OpenCode adapter: one independent agent invocation per approved file, exact frozen Agent Input, target-only mutation, fail-closed completion, bounded cleanup, durable candidate evidence, and atomic all-or-nothing application.

It is not a drop-in gateway. The integration is a **moderate adapter-neutral refactor plus a security-sensitive Pi runtime implementation**.

The main difference is that OpenCode gives SCORE a server/session API plus a permission configuration, while Pi is an embeddable agent toolkit whose normal tools and resource discovery assume the local user is the security boundary. Pi explicitly says it has no sandbox, and its built-in path handling accepts absolute paths and `~`. SCORE therefore cannot expose Pi's default `read`, `edit`, `write`, or `bash` tools and rely on a disposable `cwd`. SCORE must provide exact-target custom tools (and preferably a per-Job worker-process boundary), disable all ambient Pi resources, and retain its existing post-run workspace inspection.

The recommended first implementation uses Pi's SDK, not human-readable CLI output:

1. Discover and freeze the selected Pi provider, model, thinking level, and pinned Pi version before Run creation.
2. For each claimed SCORE Job, create a separate disposable workspace and a separate in-memory Pi session.
3. Give that session a custom empty `ResourceLoader`, in-memory settings/session state, the SCORE worker system prompt, and only SCORE-owned exact-target tools.
4. Treat prompt admission, agent settlement, tool terminal states, final assistant stop reason, and candidate inspection as separate proofs.
5. Preserve the existing Runner-owned candidate persistence, drift checks, recovery, and atomic application unchanged.

For the first production version, a SCORE-owned child process per Job is the conservative execution topology. It preserves hard-kill cleanup and avoids assuming undocumented multi-session concurrency safety inside one Pi process. If an in-process multi-session spike proves isolation and cancellation under load, that topology can later be optimized without changing the adapter contract.

## What “exactly like OpenCode” should mean

Parity should be defined by SCORE-observable guarantees, not by copying OpenCode's internal server topology.

| Contract | Current OpenCode behavior | Required Pi behavior |
| --- | --- | --- |
| Work unit | One approved Agent Package becomes one Job | Same |
| Isolation | One disposable Location and one OpenCode session per file | One disposable workspace and one Pi session/process per file |
| Input | Frozen `agentInputJson` is sent unchanged | Same bytes/string, with prompt-template expansion disabled |
| Context | Repository, ambient instructions, skills, plugins, MCP, and unrelated files are unavailable | Empty custom resource loader; no global/project context, skills, prompts, extensions, themes, or session history |
| Tools | Deny-all, then target-safe read/edit | SCORE-owned exact-target read/write/edit tools only; no built-in filesystem tools or bash |
| Provider access | Only the selected provider configuration/credential enters the isolated Run | Only selected Pi provider/model and minimum credential material enter the Job runtime |
| Completion | Native wait plus message/tool inspection | Full Pi settlement plus message/tool inspection; never prompt resolution or process exit alone |
| Output | Exact target must be a regular UTF-8 file; no other paths or symlinks | Reuse the same inspection and candidate rules |
| Failure | One Job failure does not cancel ordinary siblings; failed output never becomes eligible | Same |
| Application | Complete successful candidate set is revalidated and applied atomically | Unchanged Runner path |

OpenCode currently shares one server across a Run and creates a distinct session and Location for each Job. Pi does not need a shared server to be behaviorally equivalent. A process/session per Job is acceptable so long as SCORE preserves its rolling concurrency ceiling, independent Job outcomes, cancellation, and cleanup semantics.

## Pi facts that materially affect the adapter

### 1. The SDK is the right primary interface

Pi's official SDK exposes `createAgentSession()`, session IDs, event subscriptions, explicit model/thinking selection, `SessionManager.inMemory()`, custom tools, `abort()`, and `dispose()`. The SDK is intended for embedding Pi in automated workflows and avoids scraping terminal text. See the [SDK overview and `AgentSession` contract](https://github.com/earendil-works/pi/blob/v0.84.1/packages/coding-agent/docs/sdk.md#L3-L114).

RPC is a viable fallback when process separation is more important than direct TypeScript integration. It is structured JSONL, but it adds a second protocol and has subtly different prompt semantics: the RPC `prompt` response only acknowledges submission, and callers must wait for the terminal lifecycle event. A SCORE-owned child that embeds the SDK provides both structured control and process-level termination, so it is a stronger v1 shape than either scraping `pi -p` or exposing the generic RPC CLI directly.

### 2. Pi's normal security boundary is incompatible with SCORE's closed context

Pi's security policy says it runs with the local user's authority, expects trusted repositories/resources, and intentionally does not provide a sandbox. It specifically calls out `AGENTS.md`, skills, extensions, and user-controlled configuration as part of that trust model. See Pi's [security boundary](https://github.com/earendil-works/pi/blob/v0.84.1/SECURITY.md#L1-L22) and [no-sandbox statement](https://github.com/earendil-works/pi/blob/v0.84.1/SECURITY.md#L48-L68).

The SDK defaults are also too broad for SCORE:

- Without a supplied loader, `createAgentSession()` uses `DefaultResourceLoader` and standard discovery for extensions, skills, prompt templates, themes, and context files ([SDK](https://github.com/earendil-works/pi/blob/v0.84.1/packages/coding-agent/docs/sdk.md#L46-L64)).
- Default built-in tools are `read`, `bash`, `edit`, and `write`; other built-ins include `grep`, `find`, and `ls` ([SDK](https://github.com/earendil-works/pi/blob/v0.84.1/packages/coding-agent/docs/sdk.md#L509-L538)).
- Pi's path utility explicitly handles `~` expansion and absolute paths; it does not enforce containment beneath `cwd` ([source](https://github.com/earendil-works/pi/blob/v0.84.1/packages/coding-agent/src/core/tools/path-utils.ts#L40-L50)). `../` traversal likewise resolves normally.

Consequences:

- A temp working directory alone prevents neither confidential reads nor writes outside the directory.
- Post-run directory scanning prevents an invalid candidate from being applied, but cannot undo disclosure of an external file to a provider.
- SCORE must not enable Pi's built-in filesystem or shell tools for a file Job.
- OS/container sandboxing remains useful defense in depth, especially if future Pi features run code outside SCORE-owned tools, but exact-target custom tools are the minimum protocol requirement.

### 3. Pi can be configured with no ambient resources

Pi provides the pieces SCORE needs to replace the defaults:

- Custom tools can be passed directly to a session ([SDK](https://github.com/earendil-works/pi/blob/v0.84.1/packages/coding-agent/docs/sdk.md#L565-L597)).
- `SettingsManager.inMemory()` and `SessionManager.inMemory()` avoid global/project settings and session files ([SDK](https://github.com/earendil-works/pi/blob/v0.84.1/packages/coding-agent/docs/sdk.md#L843-L890)).
- A custom `ResourceLoader` can return empty extensions, skills, prompts, themes, and context files while supplying an exact system prompt. Pi ships an official [full-control example](https://github.com/earendil-works/pi/blob/v0.84.1/packages/coding-agent/examples/sdk/12-full-control.ts#L28-L61).
- Custom credential stores and auth/model paths are supported, including an in-memory credential store ([SDK](https://github.com/earendil-works/pi/blob/v0.84.1/packages/coding-agent/docs/sdk.md#L433-L470)).

The Pi adapter should use those explicit controls rather than configuring `DefaultResourceLoader` with a growing denylist. The intended invariant is “nothing is discoverable unless SCORE supplies it.”

One small prompt-framing difference should be tested explicitly: even with a custom prompt, Pi [appends the current working directory](https://github.com/earendil-works/pi/blob/v0.84.1/packages/coding-agent/src/core/system-prompt.ts#L27-L71). The disposable path is not part of the frozen Agent Input and should not affect eligibility, but the Pi worker system framing will be semantically equivalent to OpenCode's rather than byte-identical.

### 4. Admission and success are distinct

For SDK execution, `preflightResult(true)` means the prompt was accepted, queued, or handled; it does not mean the provider succeeded. `await session.prompt()` resolves only after the full accepted run finishes, including automatic retries, while failures after acceptance are represented in events/messages rather than `preflightResult(false)` ([SDK prompt semantics](https://github.com/earendil-works/pi/blob/v0.84.1/packages/coding-agent/docs/sdk.md#L180-L222)).

Pi also distinguishes low-level `agent_end` from `agent_settled`. `agent_end` may be followed by retry, compaction retry, or a queued continuation. `agent_settled` means no automatic continuation remains ([RPC event contract](https://github.com/earendil-works/pi/blob/v0.84.1/packages/coding-agent/docs/rpc.md#L832-L888)).

Therefore a Pi Job is successful only if all of the following hold:

1. A Pi session was created and its sanitized identity observed.
2. `preflightResult(true)` proved the exact Agent Input was admitted.
3. The run reached full settlement (`session.prompt()` completed and/or `agent_settled` was observed, depending on the host boundary).
4. Every observed tool call reached `tool_execution_end` and none ended with `isError: true`; Pi exposes explicit tool terminal events ([agent event types](https://github.com/earendil-works/pi/blob/v0.84.1/packages/agent/src/types.ts#L420-L443)).
5. The authoritative final assistant message has an accepted terminal stop reason; `error`, `aborted`, and `length` fail closed, and an unexpected state fails closed.
6. The existing SCORE workspace inspector accepts the target candidate.

Neither a zero process exit, a resolved prompt Promise, `agent_end`, assistant prose, nor the mere appearance of a target file is sufficient by itself.

### 5. Timeout and cancellation remain SCORE-owned

Pi exposes `session.abort(): Promise<void>` and `session.dispose()` ([SDK](https://github.com/earendil-works/pi/blob/v0.84.1/packages/coding-agent/docs/sdk.md#L66-L111)), but SCORE must retain independent startup, execution, abort, cleanup, and process-shutdown deadlines.

On timeout or Runner interruption, the adapter should:

1. mark the attempt as interrupted/timed out using the existing durable category;
2. request `await session.abort()` within a bounded cleanup window;
3. inspect the assigned target for bounded post-admission evidence without making it eligible;
4. dispose the session and resource loader in `finally`;
5. if using a child worker, terminate it and escalate to a hard kill after the configured grace period;
6. remove the disposable workspace and isolated credential/config state.

An SDK or RPC wait timeout is not itself cancellation. SCORE must actively abort and then enforce process cleanup.

### 6. Model discovery and “variants” map cleanly, with a trap

`ModelRuntime.getAvailable()` returns models for which valid authentication is configured, and Pi exposes the thinking levels `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max` ([SDK model selection](https://github.com/earendil-works/pi/blob/v0.84.1/packages/coding-agent/docs/sdk.md#L367-L398)). This fits SCORE's existing adapter-owned catalog, whose model keys and variant IDs are opaque to the Runner.

The Pi catalog should:

- advertise only authenticated/usable provider-model pairs;
- use Pi thinking-level IDs as opaque SCORE variant IDs;
- advertise only levels supported by each model;
- apply a bounded deadline to model/auth refresh, because Pi leaves that policy to SDK consumers ([SDK refresh contract](https://github.com/earendil-works/pi/blob/v0.84.1/packages/coding-agent/docs/sdk.md#L472-L488));
- validate an explicit selection before confirmation and Run creation;
- freeze the effective model and thinking level in the Run and assert the created session did not clamp or substitute it.

That last assertion matters because Pi explicitly [computes model-specific supported levels and clamps unsupported selections](https://github.com/earendil-works/pi/blob/v0.84.1/packages/ai/src/models.ts#L900-L931). SCORE must not silently run a different reasoning level than the one the user confirmed.

### 7. Versioning changes SCORE's Node floor

The current stable package is `@earendil-works/pi-coding-agent` v0.84.1. The older `@mariozechner/pi-coding-agent` namespace is not the package SCORE should newly integrate. Pi v0.84.1 requires Node `>=22.19.0` ([package manifest](https://github.com/earendil-works/pi/blob/v0.84.1/packages/coding-agent/package.json#L98-L107)); SCORE currently declares Node `>=22.16.0`.

Supporting the stable Pi SDK therefore implies one of:

- raise SCORE's declared Node minimum to `>=22.19.0` (recommended), or
- deliberately pin an older Pi release and accept an older API/security baseline.

Pi is moving quickly. SCORE should pin the exact Pi package version and record it on every Run rather than consume an open semver range without adapter contract tests.

## What can be reused unchanged

Most of SCORE's safety model is already outside the native OpenCode protocol and should remain Runner-owned:

- approved Plan and immutable per-file Agent Packages;
- one Job per package and rolling bounded concurrency;
- exact Agent Input and target bindings;
- create/replace workspace seeding;
- safe relative target validation;
- recursive rejection of symlinks and undeclared paths;
- regular-file, readable UTF-8 candidate requirements;
- acceptance of empty creates and unchanged replacements;
- successful and rejected candidate digests;
- failure sanitization and bounded attempt observations;
- target drift detection;
- no automatic redelivery of ambiguous in-flight work;
- complete-set eligibility and atomic application;
- explicit diagnostic export of partial successes.

In particular, the outer workspace/candidate machinery in [`open-code-adapter.ts`](https://github.com/dayhaysoos/score-protocol/blob/a4871bc460673f099db4219bf5f71c7f4f0c1b6e/src/runner/open-code-adapter.ts#L322-L638) is conceptually adapter-neutral even though it is currently OpenCode-named. It should be extracted once and exercised by both adapters rather than duplicated.

The SCORE Core schema and approved Agent Package schema do not need to change for the filesystem-backed Pi adapter. A future direct-content `submit_candidate` Pi tool could be safer and simpler, but it would be a different adapter capability and should not masquerade as the current `score.coding.filesystem.single-target` contract.

## Required SCORE refactor before Pi can run

Only the model-catalog seam is currently adapter-neutral. Execution, persistence decoding, package validation, CLI dispatch, and doctor are still OpenCode-specific.

The evidence is direct in the current source: the [catalog interface is generic](https://github.com/dayhaysoos/score-protocol/blob/a4871bc460673f099db4219bf5f71c7f4f0c1b6e/src/runner/runtime-adapter-catalog.ts#L3-L32), but [`AdapterConfiguration` only decodes `opencode`](https://github.com/dayhaysoos/score-protocol/blob/a4871bc460673f099db4219bf5f71c7f4f0c1b6e/src/runner/domain.ts#L19-L27), [Runner requires `OpenCodeAdapter`](https://github.com/dayhaysoos/score-protocol/blob/a4871bc460673f099db4219bf5f71c7f4f0c1b6e/src/runner/runner.ts#L636-L640), enqueue [always invokes `validateOpenCodePackage`](https://github.com/dayhaysoos/score-protocol/blob/a4871bc460673f099db4219bf5f71c7f4f0c1b6e/src/runner/runner-store.ts#L946-L960), the [CLI always constructs the OpenCode catalog/runtime](https://github.com/dayhaysoos/score-protocol/blob/a4871bc460673f099db4219bf5f71c7f4f0c1b6e/src/runner/cli.ts#L238-L333), and [doctor's dependency surface is OpenCode-specific](https://github.com/dayhaysoos/score-protocol/blob/a4871bc460673f099db4219bf5f71c7f4f0c1b6e/src/doctor.ts#L1-L82).

| Area | Current coupling | Required change |
| --- | --- | --- |
| Configuration | `AdapterConfiguration.kind` is the literal `opencode` | Make it a discriminated `opencode | pi` union with adapter-owned version/config fields |
| Runtime service | Runner requires `OpenCodeAdapter` | Introduce adapter-neutral `RuntimeAdapter`/gateway contracts with `invoke` and Run scope |
| Claimed Job | Omits adapter kind and SDK version | Carry enough frozen adapter identity for execution to fail closed on mismatch |
| Enqueue compatibility | Always calls `validateOpenCodePackage` | Generalize common single-target capability validation and dispatch adapter-specific checks |
| Workspace boundary | Reusable logic lives in `open-code-adapter.ts` | Extract a Runner-owned single-target workspace/candidate harness |
| CLI/guided start | Always constructs OpenCode catalog/runtime | Select adapter before model discovery; add noninteractive `--adapter pi`; resume stored adapter on `work` |
| Selection | OpenCode-specific noninteractive resolver | Give each adapter its own catalog/configuration resolver behind one interface |
| Doctor | Dependencies, checks, repairs, and copy are OpenCode-specific | Define whether doctor checks a selected adapter or all supported adapters, then dispatch accordingly |
| Diagnostics | Tool-name allowlist reflects OpenCode tools | Add only deliberate SCORE-owned Pi tool names; unknown names remain sanitized |
| Dependency/bootstrap | Pi package and lockfile do not exist | Pin v0.84.1, raise Node floor, and update the lockfile outside a shell-disabled file agent |

The database already stores `adapter_kind` as text, so a table-shape migration may not be necessary. The TypeScript schemas and decoders still need to accept Pi, and any compatibility assumption must be verified with migration/recovery tests.

## Recommended Pi adapter shape

### Parent/Run scope

- A Pi catalog discovers authenticated models with a bounded `ModelRuntime` operation.
- SCORE freezes `kind: "pi"`, provider ID, model ID, thinking level or `null`, Pi SDK/package version, and any adapter protocol version.
- A Run-scoped adapter owns sanitized credential material and the worker concurrency pool.
- `work --run` dispatches from the frozen `adapterKind`; it must never substitute the current default adapter.

### Per-Job scope

- Create the same disposable single-target workspace used by OpenCode.
- Start one SCORE-owned Pi worker process for the Job (recommended v1 topology).
- Inside the worker, create one `AgentSession` with:
  - the exact selected model and thinking level;
  - `SessionManager.inMemory(cwd)`;
  - `SettingsManager.inMemory(...)` with deliberate retry/compaction policy;
  - an empty custom `ResourceLoader` and the SCORE worker system prompt;
  - no built-in tools;
  - exact-target SCORE custom tools only;
  - no ambient extensions, skills, prompts, themes, context files, settings, or prior sessions.
- Send the frozen Agent Input unchanged as the user message with `expandPromptTemplates: false`.
- Collect only the bounded lifecycle/tool facts SCORE needs; do not persist transcripts, hidden reasoning, raw provider bodies, credentials, or unrestricted event payloads.
- On accepted terminal completion, inspect the workspace through the shared harness and return the opaque UTF-8 candidate/digest.
- On any failure, preserve the existing post-admission bounded evidence behavior and clean up.

### Exact-target tool design

The safest filesystem-backed tool surface is small:

- `read_assigned_target`: reads only the exact assigned relative target; for a create package, reports that it is absent.
- `write_assigned_target`: creates/replaces only that exact regular file, using safe parent creation inside the disposable workspace.
- `replace_assigned_target` or `edit_assigned_target`: applies an exact replacement/edit only to that target.

Every call should reject absolute paths, `..`, `~`, alternate separators where relevant, symlinks at every traversed component, and any path not byte-for-byte/canonically equal to the frozen target. No shell, generic list/find/grep, web, subagent, question, package-manager, or repository-discovery tool should be available.

The final recursive workspace scan remains mandatory defense in depth even when every custom tool is confined.

## Concurrency implications

SCORE's current worker pool can continue to claim Jobs independently up to `maxConcurrency`; Pi does not change the queue model. What needs proof is the native host topology.

Pi documents single-session construction and independent in-memory session state, but the v0.84.1 public documentation does not promise that several `AgentSession` instances sharing process-global state are concurrency-isolated under simultaneous provider retries, auth refresh, abort, and disposal. Pi's own [subagent example uses separate child Pi processes for isolated context](https://github.com/earendil-works/pi/blob/v0.84.1/packages/coding-agent/examples/extensions/subagent/index.ts#L1-L34). Accordingly:

- **v1 recommendation:** one child worker and one Pi session per claimed file;
- allow the parent Runner to execute those child workers concurrently under the existing ceiling;
- treat shared auth/catalog inputs as frozen read-only material;
- verify that aborting one Job never changes a sibling's session, files, tool events, or provider selection;
- consider a shared in-process `ModelRuntime`/multi-session optimization only after a deterministic concurrency spike and live bounded matrix pass.

This is heavier than OpenCode's shared server but simpler to reason about. Process startup overhead is an acceptable initial tradeoff for correct per-file isolation and reliable cleanup.

## SCORE-building-SCORE bootstrap

The first Pi adapter cannot be built by Pi through SCORE because SCORE cannot dispatch Pi until the adapter exists. The clean bootstrap is:

1. Use the existing OpenCode adapter to execute approved per-file SCORE packages that perform the adapter-neutral refactor and Pi implementation.
2. Keep dependency/lockfile changes in an explicitly authored package or human-owned setup step; current workers intentionally have no shell/package-manager authority.
3. Run the shared adapter contract suite against OpenCode first to prove the refactor caused no behavior change.
4. Run deterministic fake-Pi gateway tests, then a bounded live Pi matrix.
5. Once Pi passes the parity gates, use the Pi adapter for a subsequent SCORE change. That is the first genuine “Pi/SCORE builds SCORE” acceptance test.

This is still SCORE building itself: SCORE controls the approved packages, per-file execution, evidence, eligibility, and atomic application. OpenCode is merely the bootstrap runtime for the adapter that does not yet exist.

## Acceptance gates

A Pi adapter should not be called behaviorally equivalent until all of these are demonstrated:

- [ ] Pinned Pi runtime/API version is frozen on every Run.
- [ ] Adapter selection occurs before adapter-owned model discovery and confirmation.
- [ ] Only authenticated/usable Pi provider-model pairs are offered under a bounded deadline.
- [ ] Supported thinking levels are advertised, validated, frozen, forwarded, and checked for silent clamping.
- [ ] `work` resumes the stored Pi adapter and exact frozen configuration.
- [ ] Every package receives one independent workspace, process/session identity, and unchanged Agent Input.
- [ ] Create starts absent; replace starts with only the exact frozen target bytes; delete remains rejected.
- [ ] Ambient repository files, SCORE state, `AGENTS.md`, Pi settings, skills, extensions, prompts, themes, and prior sessions are unavailable.
- [ ] Built-in Pi filesystem and shell tools are absent.
- [ ] Exact-target tools reject absolute paths, traversal, symlinks, and every non-target path.
- [ ] Prompt admission is observed separately from provider success.
- [ ] Full settlement, final assistant terminal state, and every tool terminal result are checked fail-closed.
- [ ] Startup, execution, abort, cleanup, and worker termination have independent deadlines.
- [ ] Timeout/interruption aborts the correct Job and cannot cancel or contaminate a sibling.
- [ ] One ordinary Job failure does not cancel siblings or introduce automatic SCORE redelivery.
- [ ] Failure after admission retains only bounded target state/digest evidence and never makes the candidate eligible.
- [ ] Missing, non-regular, symlinked, non-UTF-8, and multi-path output fails.
- [ ] Empty creates and unchanged replacements remain valid opaque candidates.
- [ ] Candidate persistence, target-drift recheck, complete-set eligibility, and atomic application remain unchanged.
- [ ] No transcript, hidden reasoning, credential, raw provider body, or unrestricted Pi event enters `runner.db`.
- [ ] Shared parity tests pass for OpenCode and Pi, with Pi-specific auth/resource/lifecycle/cancellation tests.
- [ ] A bounded live matrix covers sequential and concurrent multi-file Runs, provider error, tool error, timeout, interruption, missing output, path escape, and undeclared output.

## Risks and open decisions

1. **Worker topology:** start with a child SDK worker per Job; promote in-process multi-session execution only with evidence.
2. **Credential isolation:** API-key providers fit in-memory overrides cleanly; OAuth/custom-provider flows need a design that copies only the selected minimum state and handles refresh without exposing the user's full Pi directory.
3. **Retry/compaction policy:** Pi can retry and compact automatically. SCORE may allow those inside one delivery attempt, but must wait for settlement, keep its outer no-redelivery rule, and test timeout/cost behavior.
4. **Direct-content future:** a terminating `submit_candidate` custom tool could remove filesystem mutation from the model entirely. It should be introduced as a distinct capability after filesystem parity, not folded invisibly into the existing capability.
5. **Fast API evolution:** namespace and SDK surface have changed recently. Pin the stable tag, add contract shields, and review upgrades deliberately.
6. **Node floor:** adopting v0.84.1 raises SCORE's minimum supported Node from 22.16 to 22.19.

## Recommended decision

Proceed with the Pi adapter, but make the first SCORE-authored slice the adapter-neutral runtime refactor—not Pi-specific code. Then extract the shared single-target harness and add Pi behind it.

The implementation is safe and tractable if SCORE owns all four boundaries Pi does not natively provide:

1. **resource boundary** — empty explicit loader and in-memory state;
2. **tool boundary** — exact-target custom tools, no built-ins or shell;
3. **lifecycle boundary** — admission, settlement, terminal message/tool proof, deadlines, abort, and cleanup;
4. **candidate boundary** — existing workspace inspection, durable evidence, drift checks, and atomic application.

If any one of those is weakened, Pi support would look operationally similar to OpenCode while violating SCORE's actual closed-context protocol. With all four enforced and tested, the differences are implementation details rather than protocol compromises.

## Primary sources

- [Pi v0.84.1 source tag](https://github.com/earendil-works/pi/tree/v0.84.1)
- [Pi SDK documentation](https://github.com/earendil-works/pi/blob/v0.84.1/packages/coding-agent/docs/sdk.md)
- [Pi RPC documentation](https://github.com/earendil-works/pi/blob/v0.84.1/packages/coding-agent/docs/rpc.md)
- [Pi security policy](https://github.com/earendil-works/pi/blob/v0.84.1/SECURITY.md)
- [Pi full-control SDK example](https://github.com/earendil-works/pi/blob/v0.84.1/packages/coding-agent/examples/sdk/12-full-control.ts)
- [Pi path resolution source](https://github.com/earendil-works/pi/blob/v0.84.1/packages/coding-agent/src/core/tools/path-utils.ts)
- [`@earendil-works/pi-coding-agent` package](https://www.npmjs.com/package/@earendil-works/pi-coding-agent)
- [SCORE runtime adapter documentation](../runtime-adapters.md)
