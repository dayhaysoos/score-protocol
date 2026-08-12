# Manual Runner live-feed test

From this directory, run:

```sh
npm run start
```

Choose the only Change Plan, select any advertised model and one of its reasoning
variants, and confirm the Run. The terminal should show all three files
initially, independent per-file stages, immediate stage changes, a continuously
moving Run-level liveness indicator, and the separate application phases. File
markers stay static because only stored stage evidence may describe Agent
progress.

After the Run exits:

```sh
npm run status
npm run check
```

`status` reopens the newest Run from `runner.db`. `check` runs the fixture's
TypeScript, build, and QA checks outside SCORE.

To return this fixture to its initial empty state and test again:

```sh
npm run reset
npm run start
```
