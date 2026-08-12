# Change authoring dogfood

This standalone fixture exercises the packaged SCORE CLI as an agent would use
it: install the package, submit one three-file Change, inspect the HTML review,
then approve and run the exact reviewed work.

The initial project contains only `src/reading.ts`. The reviewed Change modifies
that file and creates `src/reading-progress.ts` and `src/reading-summary.ts` as
one atomic unit.

From the SCORE repository root, build and pack the CLI. Install that tarball in
this directory, then prepare the Change:

```sh
npm run build:package
PACK_DIR="$(mktemp -d /tmp/score-change-pack.XXXXXX)"
npm pack --silent --pack-destination "$PACK_DIR"
cd examples/product-validation/change-authoring-dogfood
npm install --no-save "$PACK_DIR/score-protocol-0.0.1-alpha.tgz"
npm run doctor
npm run prepare
```

`doctor` inspects the installed runtime and current directory without running a
model or writing project files or persistent SCORE state. Use
`npm run doctor -- --json` for its compact machine-readable report.

Open the `reviewPath` returned by `prepare`. If it matches the intended work,
run the guided approval and execution flow:

```sh
npm run start
```

After a Run, inspect the latest Run for this project:

```sh
npm run status
npm run check
```

To inspect an older retained Run explicitly:

```sh
npm run status -- --run <run-id>
```

Return the fixture to its reviewed starting state before another test:

```sh
npm run reset
```

See [VALIDATION.md](./VALIDATION.md) for the August 11, 2026 dogfood results.
