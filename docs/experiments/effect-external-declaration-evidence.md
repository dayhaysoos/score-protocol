# Bounded Effect external-declaration evidence

**Status:** Successful disposable feasibility experiment. Not production behavior.

## Question

Can SCORE select exact contracts from one lock-bound external package module,
without recursively copying the package's declaration graph or exposing the
installed package to an Agent?

The concrete probe uses `effect/Schema` from Effect `4.0.0-beta.104` and asks
for `check`, `isPattern`, and the unavailable name `pattern`.

## Approved boundary

The experiment may read only the root dependency lock, Effect's installed
package manifest, and the one declaration entry selected from Effect's export
map. It does not read `tsconfig`, execute the TypeScript compiler, run project
commands from inside candidate acceptance, recurse through dependency
declarations, or connect anything to preparation, Agent Briefs, the Runner, or
the Candidate Declaration Gate.

## Result

The experiment succeeded.

- `package-lock.json` pinned Effect `4.0.0-beta.104` and its exact integrity.
- Effect's `./*` export mapping selected `./dist/Schema.js`; bounded TypeScript
  extension substitution selected `./dist/Schema.d.ts`.
- OXC `0.144.0` extracted only the requested `check` and `isPattern`
  declarations.
- `pattern` returned the typed finding `EXTERNAL_DECLARATION_MISSING`.
- Reference routing identified TypeScript globals, type parameters, same-module
  names, and imported namespace members without expanding any of them.
- Two separate processes produced byte-identical canonical reports.
- The extractor's complete audited external-evidence input set was:
  - `package-lock.json`
  - `node_modules/effect/package.json`
  - `node_modules/effect/dist/Schema.d.ts`

  Normal runtime module loading for the prototype itself, SCORE's canonical
  JSON helper, and OXC is outside this evidence-input audit.

Selected declarations:

```ts
export declare function check<S extends Top>(...checks: readonly [SchemaAST.Check<S["Type"]>, ...Array<SchemaAST.Check<S["Type"]>>]): (self: S) => S["Rebuild"];

export declare function isPattern(regExp: globalThis.RegExp, annotations?: Annotations.Filter): SchemaAST.Filter<string>;
```

Evidence digest:

```text
sha256:8725d0d4308635ed13d2b5468e16abe675125ea58b0e6f33edafb890756bc17b
```

The complete report was byte-identical across both processes:

```text
sha256:aca63673a1fd92d6150e59552f2bed8385616440bd63b389a3d9d5328f216350
```

## Reproduction

```sh
npm exec -- tsx src/prototypes/effect-external-declaration-evidence.ts
npm run typecheck
git diff --check -- src/prototypes/effect-external-declaration-evidence.ts
```

The executable prototype is
[`src/prototypes/effect-external-declaration-evidence.ts`](../../src/prototypes/effect-external-declaration-evidence.ts).

## What this proves

For this installed, lock-matched Effect version and its simple string wildcard
export map, SCORE can deterministically resolve one external declaration entry,
select an explicitly requested contract subset, preserve exact signatures,
route their type references without recursion, and report an unavailable member
precisely.

This is sufficient evidence that ADR 0005 can be amended without allowing a
recursive dependency dump: external packages can remain closure boundaries
while separately selected external declarations become bounded evidence.

## What this does not prove

- General package resolution across conditional exports, `typesVersions`,
  custom conditions, or every TypeScript module-resolution mode.
- Cryptographic reconstruction of the installed package from the lockfile's
  tarball integrity; the prototype checks the installed manifest version and
  records exact source bytes by digest.
- TypeScript assignability, project compilation, runtime behavior, or package
  documentation correctness.
- That every useful supporting external declaration can be anticipated without
  another explicitly bounded request.
- Production preparation, Agent Brief delivery, or candidate enforcement.

No accepted ADR or production boundary is changed by this experiment.
