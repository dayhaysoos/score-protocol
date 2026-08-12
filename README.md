# SCORE Protocol

**Structured Context Orchestration for Reliable Execution**

SCORE prepares coding work for isolated file agents. It turns an agreed change
and the relevant project state into reviewable instructions for each target
file, requires explicit human approval, then runs those instructions through a
user-controlled Runner.

The goal is simple: settle scope and cross-file decisions before coding agents
start, give each agent only the context it needs, and apply the complete result
atomically.

> [!WARNING]
> SCORE is an experimental alpha. Its commands, data model, and local database
> format may change. Use it on work that is committed or otherwise backed up.

## Install

SCORE requires Node.js 22.16.0 or newer.

```sh
npm install --global score-protocol
score doctor
```

`score doctor` checks the installation, packaged resources, SQLite support,
OpenCode runtime, provider credentials, and the current project directory. It
does not run a model or create persistent SCORE state.

You can prepare and review Changes without provider credentials. Running an
approved Change currently requires OpenCode with at least one configured model
provider. `score doctor` will identify anything that still needs attention.

## Use SCORE

Start in the coding agent you already use. Bring any plan, specification,
issue, acceptance criteria, or product documentation you already have. Once the
intended change is clear, tell the agent:

> Use SCORE to prepare this work from the plan, specification, and documentation
> we already discussed. Stop when the Change Review is ready.

Your agent will inspect the project and prepare the work. SCORE validates what
it submits, freezes the declared source and context, and creates an HTML Change
Review under `.score/reviews/`. It does not edit source files at this stage.
The command returns the exact review path when preparation succeeds.

If something in the review is wrong, tell your agent what to change and ask it
to revise the SCORE Change. SCORE creates a new review while preserving the
previous version. Do not edit the `.score` database directly.

Read the review, then start the guided Runner:

```sh
score start
```

The Runner asks you to select the reviewed work and model, confirms the exact
repository and target files, records your approval, runs one isolated agent per
File Brief, and applies all generated files together.

After SCORE finishes, inspect the ordinary uncommitted changes and run the
project's normal formatting, linting, typechecking, and tests before keeping
them.

Useful commands:

```sh
score --help
score skill how-to-score
score list
score status
score doctor --json
```

## What To Expect

- SCORE stores private project state and reviews in `.score/`.
- Every Change is immutable; revisions create new reviewable versions.
- Agents receive closed, explicit context rather than repository-wide access.
- Source changes require a human-reviewed approval.
- A changed target or incomplete candidate set prevents application.
- Successful candidates are applied as one complete set.
- Resulting files are ordinary uncommitted project changes.
- SCORE does not build, lint, test, or prove the generated code is correct.
  Run your normal project checks after application.

The current Runner uses the bundled OpenCode adapter. Runtime adapters are an
external integration seam and are not part of SCORE Core.

## Troubleshooting

```sh
score doctor       # Check installation, runtime, credentials, and project setup
score status       # Inspect the latest Run for this project
score --help       # List available commands
```

If `score doctor` reports an issue, follow its suggested repair and run it
again. SCORE keeps preparation, approval, execution, and application separate,
so a failed check or Run does not authorize unreviewed source changes.

## Learn More

- [Alpha scope and reproduction](./ALPHA.md)
- [Coding Profile](./profiles/coding/README.md)
- [Runtime adapters](./docs/runtime-adapters.md)
- [Canonical glossary](./CONTEXT.md)
- [Core protocol](./spec/core.md)

## For Coding Agents

Before preparing work, read the version-matched authoring instructions bundled
with the installed CLI:

```sh
score skill
```

If an integration needs the installed file path, use `score skill --path`. If
you cannot run commands, ask the user to provide the output of `score skill` in
your context.

Inspect the current project and the plans, specs, issues, or documentation the
user identified. Choose the complete target and context scope, then submit one
structured Change on standard input:

```sh
score change --input -
```

Use `score change --schema` for the authoritative input schema. Do not edit
source files, approve the review, or start the Runner while preparing work.
Stop when SCORE returns `review_ready`, and give the user the Change Review path
and a concise summary of the target files.

For non-interactive execution, the user must approve the exact reviewed pass
before starting it:

```sh
score approve --pass <id>
score start --pass <id> --provider <id> --model <id>
```

Never run `score approve` on the user's behalf unless they explicitly authorize
approval of that exact review.

If SCORE returns validation findings, repair only the named problems and
resubmit the complete Change. If the user asks to revise a review, preserve the
returned `changeId`, update the complete structured document, and resubmit it as
the same Change so SCORE creates a new immutable revision instead of unrelated
work.

## License

MIT
