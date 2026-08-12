# Five-file SCORE demo

This nested fake project exercises one reviewed change across five TypeScript
files with a real dependency chain:

```text
task.ts
├── priority.ts
│   └── format-task.ts
│       └── task-list.ts
│           └── index.ts
└───────────────────────┘
```

From this directory, prepare the review without changing source files:

```sh
npm run score:prepare
```

Open the path printed by that command, or on macOS:

```sh
open .score/reviews/task-board-status-report-review.html
```

If the plan looks right, start the guided Runner:

```sh
npm run score:start
```

The Runner asks you to select the reviewed plan and an available OpenCode model,
then asks once before it approves, runs, and atomically applies the complete
five-file candidate set. The result is an ordinary uncommitted Git diff.

Useful checks:

```sh
npm run score:list
npm run typecheck
git diff -- src
```

The editable demo draft lives in
`score/slices/task-board-status-report.json`. Each independently reviewable
slice gets its own JSON file so it can be revised without mutating an already
prepared review.
