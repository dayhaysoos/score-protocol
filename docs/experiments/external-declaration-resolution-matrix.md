# External declaration resolution matrix

**Status:** Successful disposable feasibility experiment. Not production behavior.

## Question

Can frozen package metadata select conditional and TypeScript-versioned
declaration entries deterministically, while a tiny controlled set of strange
package layouts fails closed instead of encouraging SCORE to guess?

## Boundary

All package manifests and files are small in-memory fixtures owned by the
experiment. The experiment does not read a real package declaration,
`node_modules`, project source, or `tsconfig`; it does not invoke the TypeScript
compiler or project service. OXC parses only the selected declaration string.

The matrix is intentionally small:

- four positive scenarios;
- two strange-package scenarios;
- at most eight files in one fixture;
- at most 4 KiB in one selected declaration source.

## Result

All six scenarios produced the expected deterministic result.

| Scenario | Expected result | Observed result |
| --- | --- | --- |
| Conditional `import` types | Select the import declaration | `./types/import-feature.d.mts` |
| Conditional `require` types | Select the require declaration | `./types/require-feature.d.cts` |
| Conditional wildcard subpath | Substitute the requested subpath | `./types/wild/name.d.ts` |
| `typesVersions` for TypeScript 7.0.2 | Select the `>=7` declaration generation | `./ts7/index.d.ts` |
| Unknown custom condition | Refuse to guess | `EXTERNAL_EXPORT_CONDITION_UNRESOLVED` |
| Declared generated types are absent | Report the missing selected source | `EXTERNAL_DECLARATION_SOURCE_MISSING` |

OXC parsed each selected positive declaration and preserved its exact exported
`contract` signature. The two negative fixtures returned no declaration
evidence.

Canonical report digest:

```text
sha256:515054e7c8027f48ce96b901d7613c8a7bd2f7e31f4ba50a950d8f144910719d
```

Two separate processes produced byte-identical complete reports:

```text
sha256:a100c92fb56dd793f92de4924fec216307fa6646219b6b06a2dac511ce698ec4
```

## Reproduction

```sh
npm exec -- tsx src/prototypes/external-declaration-resolution-matrix.ts
npm run typecheck
git diff --check
```

The executable prototype is
[`src/prototypes/external-declaration-resolution-matrix.ts`](../../src/prototypes/external-declaration-resolution-matrix.ts).

## Conclusion

The resolution boundary can remain small. SCORE does not need a recursive
package model or a universal understanding of package layouts. It needs:

1. one frozen package artifact;
2. one explicit resolution profile;
3. a bounded resolver for supported package metadata;
4. OXC selection of explicitly requested declarations; and
5. typed refusal whenever selection is missing, ambiguous, unsupported, or
   beyond limits.

The installed TypeScript 7 package does not expose the former in-process
`resolveModuleName` API through its public root export. This experiment therefore
uses a pure in-memory resolver instead of silently starting TypeScript's project
service. A production resolver choice still needs a specific architectural
decision and conformance tests against the supported TypeScript resolution
rules.

## What this does not prove

- Full TypeScript package-resolution compatibility.
- Arbitrary semver range syntax; the experiment supports only the two frozen
  range forms it exercises: `>=x[.y[.z]]` and `*`.
- Export arrays, multiple wildcard patterns, custom conditions, package-manager
  plugins, project aliases, module augmentation, or generated declarations.
- TypeScript assignability, project compilation, runtime behavior, production
  preparation, Agent Brief delivery, or candidate acceptance.

Those unproven forms must remain typed unsupported results until deliberately
added and proven. No accepted ADR or production boundary is changed by this
experiment.
