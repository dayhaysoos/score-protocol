# Assigned-File Agent Preflight Experiment

Status: successful end-to-end experiment; not a production Runner feature.

## Question

Can one isolated SCORE file Agent receive a deterministic, job-bound feedback
tool, inspect its current candidate against the frozen documented declaration,
repair an exact typed mismatch in the same paid invocation, and finish with a
separately reproducible valid verdict?

## Experimental seam

The experiment adds one pathless direct tool:

```text
score_preflight_score_check_assigned_file()
```

The Agent supplies no path, source, declaration, or command. OpenCode starts a
local MCP server with the disposable File Job workspace as its working
directory. SCORE supplies the assigned target and frozen documented declaration
through trusted process configuration. The tool reads only the assigned
candidate, delegates to the existing in-memory declaration-contract experiment,
and returns a bounded typed verdict.

The normal worker permission set remains deny-first. Prototype mode adds one
permission for this named tool; shell, general execution, project commands,
other repository files, project configuration, environment loading, and
dependency installation remain unavailable. The adapter explicitly connects
the MCP server and verifies its `connected` status before creating the Agent
session. `codemode: false` is required because the worker intentionally denies
OpenCode's general execute capability.

This seam is guarded by an explicit `prototypeAgentPreflight` option. Normal
Runner executions do not configure the MCP server or add the permission.

## Deterministic checks

The focused tests establish that:

- a private return-type alias replacing the reviewed inline contract returns
  `EXPORT_SHAPE_MISMATCH`;
- the exact inline contract returns `valid`;
- identical inputs return byte-identical verdict JSON and digests;
- the MCP tool accepts no path argument;
- one MCP process observes `invalid`, then the edited candidate, then `valid`;
- prototype adapter configuration exposes only the specifically named checker;
- the pinned OpenCode runtime discovers the configured MCP server.

## Live result

The successful live run used `opencode/gpt-5.6-terra` with medium reasoning and
the known revision 4 `src/declaration-shape.ts` contract defect as its frozen
starting candidate. Nothing was applied to the repository.

Observed in one Agent session:

```text
1. invalid
   EXPORT_SHAPE_MISMATCH
   expected TSUnionType; observed TSTypeReference
2. valid
```

The valid in-session verdict and the independent post-session check produced
the same digest:

```text
sha256:480daf5128cbc5a835fd9625e8af360e06c14434fc21ddc40a65973ba3ef169e
```

Candidate digest:

```text
sha256:ad62e9697a8787912159eef0eb2b24dfaed750672fc32d5d3aaa5955b92a2f5a
```

The first two diagnostic executions are retained as failed experiment evidence.
Both produced independently valid candidates but no checker calls. The first
left the MCP server pending. The second forced connection, but OpenCode's
default MCP code mode hid the tool because general execute permission is
denied. Direct-tool mode repaired that availability boundary; the third run
produced the required invalid-to-valid audit.

## Reproduction

```sh
npm run experiment:agent-preflight:mcp-smoke
npx tsx --test test/agent-preflight-feedback-model.test.ts \
  test/agent-preflight-mcp-server.test.ts
npx tsx --test --test-name-pattern='pathless assigned-file preflight' \
  test/open-code-adapter.test.ts
npm run experiment:agent-preflight
```

The final command creates one new paid Agent invocation. It uses a disposable
workspace and does not apply its candidate.

## What this proves

For this exact supported declaration case and runtime, a SCORE file Agent can
use deterministic typed feedback to detect and repair contract drift within one
invocation. The Agent does not need HTML, unrestricted repository access, or
project commands, and SCORE can independently reproduce its final verdict.

## What this does not prove

This is not a Candidate Declaration Gate, production Runner integration,
automatic retry, Repair Notice, general TypeScript verification, type
assignability, project compilation, test execution, or universal model
reliability. The audit observer is ephemeral and non-authoritative. Production
adoption still requires a forward-only policy decision, production schemas,
durable sanitized evidence, completion enforcement, and independent final gate
semantics.

## Follow-up experiment

The prototype-only [final-candidate declaration check](final-candidate-declaration-check.md)
at the Runtime Adapter seam is now successful. It evaluates the exact candidate
bytes returned after Agent completion and prevents an invalid candidate from
being returned as successful.

The Agent's in-session checker remains optional coaching. A valid candidate may
pass without a tool call, while an invalid candidate must fail even if the Agent
previously received a valid tool result and then edited the file. This keeps the
authoritative decision in deterministic SCORE code and follows the accepted
rule that correctness cannot depend on an Agent choosing to call a tool.

The current pickup sequence is recorded in the [experiment checkpoint](README.md).
