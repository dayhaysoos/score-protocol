# Documented declaration routing validation

Validated on 2026-08-11 before the working tree was curated for merge.
The disposable Core and Runner databases remain ignored local artifacts.

## Rejection control

The focused regression sends ownerless, divergent, and duplicate documented
declaration consumer routes through `ScoreAlpha.materializePreparedSliceRevision`.
All three return `invalid` with their named finding, no manifest, and zero rows
across the Plan, File Brief, Context Item, review, and prepared-slice tables.

```sh
./node_modules/.bin/tsx --test \
  --test-name-pattern='mismatched documented declaration consumers' \
  test/compiler-submission.test.ts
```

Result: 1 test passed.

## Valid live run

Preparation created revision 1 and changed no application source files.

- Change Plan: `redacted`
- Review: `redacted`
- Run: `redacted`
- Runtime: OpenCode Zen / `gpt-5.4-pro` / `medium`
- Concurrency: 3
- Run creation to application: 73.991 seconds
- Attempts: 3 succeeded, 0 failed, every file on attempt 1
- Application: complete three-file candidate set applied atomically

Frozen declaration routing:

- `src/product.ts` owns `Product` and consumes nothing.
- `src/format-product.ts` owns `formatProduct` and consumes the exact `Product`
  declaration and description.
- `src/catalog-summary.ts` owns `summarizeCatalog` and consumes the exact
  `Product` and `formatProduct` declarations and descriptions.

Candidate digests:

- `src/catalog-summary.ts`: `sha256:112448980510fd0285596e8fdcd3efd4e1186d908c6ccc3a4e870d0500451a5f`
- `src/format-product.ts`: `sha256:5fbbe246760faab6f2abcc7a819eb4c10db2ae35fd6de5adb6fef9fa892bfe5a`
- `src/product.ts`: `sha256:ea819812fe745a1716f6f79d77face1c3d93f5b3891e0f39f7aec720974f59f5`

## Real project checks

```sh
npm run typecheck
npm run build
npm run qa
```

All three passed. The QA result was `Fresh TypeScript acceptance passed.`

The SCORE repository also passed `npm test` (145/145), `npm run typecheck`,
`npm run build`, and `git diff --check` after this validation.

One full-suite pass exposed a fake-server race in the deterministic OpenCode
test fixture: a scheduled completion could recreate a workspace after SCORE had
deleted its session. The fake now ignores deleted sessions. The focused cleanup
case passed 10 consecutive runs, followed by the clean 145/145 suite above.
