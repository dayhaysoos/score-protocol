# External evidence Agent Brief binding

**Status:** Successful disposable feasibility experiment. Not production behavior.

## Question

Can one previously validated, frozen external-declaration evidence bundle become
immutable Agent Brief context without giving the Agent dependency, repository,
network, shell, or resolver access?

## Boundary

The experiment uses the exact Effect evidence from the successful bounded
external-declaration experiment as an in-memory fixture. It does not read
package files, project files, `node_modules`, or `tsconfig`; invoke OXC,
TypeScript, a Runtime Adapter, or an Agent; persist anything; or modify
production preparation.

The binding shape follows the current Agent Input convention:

- one `input_bindings` entry;
- `contract_input` = `external-declaration-evidence`;
- `kind` = `external_declaration_evidence`;
- `version` = `1.0.0`; and
- inline `content` containing only Agent-relevant package identity, selected
  declarations, safe reference classifications, parser identity, and the
  source evidence digest.

Package-internal declaration paths, source-file digests, and relative internal
import paths are deliberately omitted from Agent context. Imported declaration
references become the non-routable classification `external_package_reference`;
they do not give the Agent an import path or discovery capability.

## Result

The experiment succeeded.

1. Identical evidence produced byte-identical Agent Briefs and bindings.
2. The binding reproduced every evidence and declaration digest before creating
   the brief.
3. Changing the `check` declaration without updating its digests returned
   `EXTERNAL_EVIDENCE_DIGEST_MISMATCH`.
4. Changing the package version in a newly self-consistent evidence fixture
   changed the binding digest.
5. An `EXTERNAL_DECLARATION_MISSING` result for `pattern` returned
   `EXTERNAL_EVIDENCE_UNAVAILABLE` and produced no Agent Brief.
6. Agent context contained neither package filesystem paths nor the internal
   `./SchemaAST.ts` reference route.
7. The synthetic single-target capability explicitly denied dependency,
   network, repository-discovery, and shell access.
8. No paid Agent was invoked.

Evidence input digest:

```text
sha256:8725d0d4308635ed13d2b5468e16abe675125ea58b0e6f33edafb890756bc17b
```

Agent Brief digest:

```text
sha256:e2bc348c0a5aa89eabf6c33e828553e6b0be4e390f5e189cfe35512160685955
```

Binding digest:

```text
sha256:b2390b6f4d2595158a6f2a0163774f0d394f19add5102b7e6e8302229e0bb1d5
```

Two separate processes produced byte-identical complete reports:

```text
sha256:edd90cc9ea2bfda2d6f2b329ffef7af0111d5aa8326315e34833e0eca86c06a7
```

## Reproduction

```sh
npm exec -- tsx src/prototypes/external-evidence-agent-brief-binding.ts
npm run typecheck
git diff --check
```

The executable prototype is
[`src/prototypes/external-evidence-agent-brief-binding.ts`](../../src/prototypes/external-evidence-agent-brief-binding.ts).

## Conclusion

Selected external declarations can be delivered through the existing Agent
Input binding shape without exposing the package artifact or weakening Agent
isolation. Missing or tampered evidence can block the handoff deterministically,
and package identity changes necessarily change the binding identity.

Together with the Effect extraction and in-memory resolution-matrix experiments,
this closes the experimental chain from bounded selection to safe Agent context.
The evidence is now sufficient to propose an amendment to ADR 0005 before any
production implementation begins.

## What this does not prove

- Production preparation or durable Context Item persistence.
- Automatic selection of which external declarations are relevant.
- Candidate enforcement against the external evidence.
- TypeScript assignability, project compilation, builds, tests, or runtime
  behavior.
- Agent understanding, instruction-following, or successful code generation.
- General package resolution beyond the deliberately proven resolver subset.

No accepted ADR or production boundary is changed by this experiment.
