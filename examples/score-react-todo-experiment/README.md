# React to-do SCORE experiment

This nested project is the smallest end-to-end SCORE example with a rendered
React result. It keeps one generated implementation committed so the same
editable slice can be revised, prepared as a new immutable revision, and run
again against the current files.

From this directory, prepare the latest review:

```sh
npm run score:prepare
```

Open the review path printed by that command. After reviewing it, start the
guided Runner:

```sh
npm run score:start
```

SCORE will show the current target files before confirmation and apply the
complete two-file candidate set as ordinary uncommitted changes. To inspect the
app afterward:

```sh
npm run dev
```

The editable draft is
`score/slices/dependable-in-memory-to-do-app.json`. It targets only `src/todo.ts`
and `src/App.tsx`; automated test files are deliberately outside this slice.
