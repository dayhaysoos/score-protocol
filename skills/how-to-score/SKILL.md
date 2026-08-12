---
name: how-to-score
version: 0.1.0
description: Bring an existing plan, specification, issue, or documentation to a coding agent and prepare the work with SCORE.
---

# How To Use SCORE

SCORE works through the coding agent you already use. You bring the product
intent; the agent inspects the project and prepares a reviewable Change with
SCORE.

## Before You Start

Have a concrete piece of coding work in mind. Existing material is useful but
does not need a special SCORE format. You can point your agent to any combination
of:

- a plan or specification;
- an issue or acceptance criteria;
- product or architecture documentation;
- relevant discussion from the current conversation;
- an existing implementation that needs a focused change.

Commit or back up the project first. SCORE is currently an experimental alpha.

## Direct Your Agent

Work with the agent until the intended outcome is clear, then say:

> Use SCORE to prepare this work. Use the plan, specification, and documentation
> we already discussed. Read the SCORE authoring skill by running `score skill`,
> inspect the current project, and stop when the Change Review is ready.

If the agent cannot run commands, give it the output of `score skill` directly.
The authoring skill is the authoritative guidance matching your installed SCORE
version.

The agent should inspect the project, choose the complete file scope and context,
and submit one structured Change through `score change --input -`. It should not
edit source files, approve the review, or start the Runner during preparation.

## Review And Run

Successful preparation returns `review_ready` and a path under `.score/reviews/`.
Read that HTML Change Review. Confirm that the objective, requirements, target
files, context, and cross-file interfaces match what you intended.

When you are satisfied, run:

```sh
score start
```

SCORE will ask you to select the reviewed Change and model, confirm the exact
repository and target files, and explicitly approve execution. It then runs one
isolated agent per File Brief and applies the complete candidate set atomically.

After application, inspect the ordinary uncommitted changes and run the
project's normal formatting, linting, typechecking, tests, and review. SCORE does
not perform those checks or claim that generated code is correct.

## If The Review Is Wrong

Do not approve it. Tell your coding agent what needs to change and ask it to
revise the same SCORE Change. Revisions preserve earlier reviews rather than
overwriting them.
