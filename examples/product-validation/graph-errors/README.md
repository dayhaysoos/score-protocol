# Dependency graph error fixtures

Each child directory is an isolated project whose draft set contains exactly
one requested graph defect. Run all cases from this directory with:

```sh
../../../node_modules/.bin/tsx run.mjs
```

The harness reports the typed findings and whether `.score/score.db` or any
review artifact appeared. Every case is expected to fail before either exists.
