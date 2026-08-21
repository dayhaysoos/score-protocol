# Worked Alpha Example: Extend an Account Record

**Status:** Frozen design for the first SQLite-alpha conformance fixture. The
scenario, source bytes, requirements, Contract, operations, and skill are
accepted. The illustrative identifiers and JSON excerpt will be replaced by
conforming `score.compilation-bundle@0.1.0-alpha.6` fixture data when the schema
is implemented.

This example is intentionally tiny. Its purpose is to make the table and Agent
Package model easy to inspect, not to demonstrate production-scale coding.

## Accepted product intent

The human and LLM agree on this Accepted Specification:

> Add an account status with the values `active` and `suspended`. Update the
> shared account declaration and create a pure formatter that returns
> `"<name> [<status>]"`. No other file may change.

The specification contains three Accepted Requirements:

| Requirement | Meaning |
| --- | --- |
| `AR-1` | `Account` has `id`, `name`, and the required `status` field. |
| `AR-2` | `formatAccountLabel(account)` returns exactly `name [status]`. |
| `AR-3` | The Change Plan replaces one declared file and creates one declared file only. |

## Exact base Source Snapshot

SQLite stores the complete tiny revision rather than pointing at a mutable
working directory.

| Path | State at `R1` |
| --- | --- |
| `src/schema.ts` | Present with the exact content shown below. |
| `src/account-label.ts` | Absent. |

```ts
export interface Account {
  id: string;
  name: string;
}
```

Every stored file has its own digest. The Source Snapshot digest binds the
ordered file manifest. SCORE does not inspect `tsconfig.json`, `package.json`,
dependencies, or source syntax to reproduce a TypeScript environment.

## Shared Contracts

The Plan Compiler creates `account-contracts@1` before either file agent can
run. Its relevant declaration is:

```ts
export interface Account {
  id: string;
  name: string;
  status: "active" | "suspended";
}

export function formatAccountLabel(account: Account): string;
```

This is the system-level agreement. The Plan Compiler records `Account`, owned
by `src/schema.ts`, and `formatAccountLabel`, owned by
`src/account-label.ts`, as exact documented declaration text with concise usage
descriptions. The formatter File Brief is an explicit read-only consumer of
`Account`. Neither agent receives the other file's implementation bytes or
reads the other target to discover the interface. The exact
`import type { Account } from "./schema.js";` statement is an authored file
instruction; SCORE does not infer it.

## Compiled Change Plan

```text
Source Snapshot R1 + account-contracts@1
                       |
                       v
                 Change Plan P1
                       |
              +--------+--------+
              |                 |
              v                 v
      File Brief F1       File Brief F2
      replace             create
      src/schema.ts       src/account-label.ts
              |                 |
              v                 v
       Agent Package 1    Agent Package 2
```

The two File Briefs have different Agent Inputs even though they share the same
Contracts.

## File Brief F1: replace the declaration

**Run Rules** tell the Runner:

- target: `src/schema.ts`;
- operation: `replace`;
- allowed file effect: only that target;
- base revision: `R1`;
- approved Change Plan and package identities and digests.

**Agent Input** contains:

- the objective for `src/schema.ts`;
- the exact current target content from `R1`;
- the exact documented `Account` declaration it alone owns;
- the binding from `AR-1` to that Contract and File Brief;
- the instruction to preserve the existing exports and add the required field;
- the prohibition against reading or changing another file.

F1 receives no special skill.

<a id="file-brief-f2-create-the-formatter"></a>

## File Brief F2: create the formatter

**Run Rules** tell the Runner:

- target: `src/account-label.ts`;
- operation: `create`;
- allowed file effect: only that target;
- base revision: `R1`;
- approved Change Plan and package identities and digests.

**Agent Input** contains:

- the objective for `src/account-label.ts`;
- an explicit statement that the target is absent in `R1`;
- the exact documented `formatAccountLabel` declaration it alone owns;
- the exact read-only documented `Account` declaration;
- the authored `import type { Account } from "./schema.js";` instruction;
- the exact formatter behavior required by `AR-2`;
- one small resolved skill;
- the prohibition against reading or changing another file.

The complete skill content is:

```md
# TypeScript Module Boundaries

When this module consumes a type owned by another module:

- Import type-only dependencies with `import type`.
- Use the owning module's exported type; never recreate or widen it locally.
- Keep module initialization free of side effects.
- Do not introduce barrel exports or new runtime dependencies.
- The module is complete only when its public exports exactly match the supplied Contract.
```

The skill is stored as an immutable Context Item with its source, version,
purpose, and digest. A Contract Input Binding explains why F2 receives it. F1
has no membership or binding for this skill.

## Illustrative F2 Agent Package

The authoritative package is JSON with separate Runner-only and agent-visible
sections. Digest values are stored beside this JSON, and the example uses no
lookup instructions.

The JSON retains alpha wire fields such as `pass_id`, `capsule_id`, and
`payload_digest`. Those compatibility identifiers do not change the canonical
Change Plan, File Brief, and Agent Package language used in the explanation.

```json
{
  "control": {
    "protocol": {
      "bundle_schema": "score.compilation-bundle@0.1.0-alpha.6",
      "profile": "score.coding@0.1.0-alpha.6",
      "canonicalization": "RFC 8785",
      "digest_algorithm": "SHA-256"
    },
    "manifest_id": "M1",
    "pass_id": "P1",
    "capsule_id": "F2",
    "base_revision_id": "R1",
    "target_path": "src/account-label.ts",
    "operation": "create",
    "allowed_effects": [
      {
        "kind": "create_file",
        "path": "src/account-label.ts"
      }
    ]
  },
  "agent_input": {
    "objective": "Create the account label formatter required by AR-2.",
    "target": {
      "path": "src/account-label.ts",
      "operation": "create",
      "state_at_base_revision": "absent"
    },
    "intended_outcome": "The new module exports the accepted pure account-label formatter.",
    "declarations": {
      "owned": [
        {
          "name": "formatAccountLabel",
          "declaration": "export function formatAccountLabel(account: Account): string;",
          "description": "Format an Account as its name followed by its status in brackets."
        }
      ],
      "consumed": [
        {
          "name": "Account",
          "declaration": "export interface Account {\n  id: string;\n  name: string;\n  status: \"active\" | \"suspended\";\n}",
          "description": "The shared account record accepted by the formatter."
        }
      ]
    },
    "input_bindings": [
      {
        "contract_input": "typescript-module-boundaries",
        "purpose": "Preserve type ownership and prevent a type-only dependency from becoming a runtime module dependency.",
        "kind": "skill",
        "version": "1.0.0",
        "content": "# TypeScript Module Boundaries\n\nWhen this module consumes a type owned by another module:\n\n- Import type-only dependencies with `import type`.\n- Use the owning module's exported type; never recreate or widen it locally.\n- Keep module initialization free of side effects.\n- Do not introduce barrel exports or new runtime dependencies.\n- The module is complete only when its public exports exactly match the supplied Contract."
      }
    ],
    "required_capabilities": [],
    "constraints": [
      "Export formatAccountLabel as a named function.",
      "Use exactly `import type { Account } from \"./schema.js\";`.",
      "Return exactly `${account.name} [${account.status}]`.",
      "Do not read or modify any other file."
    ],
    "prohibited_effects": ["Do not modify any path except src/account-label.ts."]
  }
}
```

The authored `./schema.js` path is not a request to inspect that file: the exact
declaration the agent needs is already included as read-only context. SCORE
preserves this text but does not prove that the import, declaration, or behavior
is valid TypeScript.

After approval, a separate Approval Package Binding records that `PD1`
authorizes these exact Run Rules, Agent Input, and complete package digest set.
The approval is not inserted into `control`, which would change the bytes after they
had been reviewed.

The `control_digest`, `agent_input_digest`, and `payload_digest` are stored next
to the JSON values they cover. They are not fields inside those values, which
would make a digest depend on itself.

## Validation and approval

Before approval, deterministic checks can prove that:

- both File Briefs use `R1` and `account-contracts@1`;
- `src/schema.ts` exists and is a valid `replace` target;
- `src/account-label.ts` is absent and is a valid `create` target;
- no target has two writers;
- each documented declaration name has exactly one owner in the Slice Draft;
- F2 receives `Account` as an explicit read-only consumer while F1 receives no
  formatter declaration;
- every required Contract Input has a compatible binding;
- every supplied Context Item is bound;
- F2 contains the complete skill while F1 does not;
- neither Agent Input contains a required lookup instruction;
- the materialized Agent Packages match their stored rows and digests.

These checks do not parse the documented declarations or candidate source. They
do not prove that the LLM found every necessary fact, that an import or export is
valid, or that future generated code will work. The Plan Review shows the
complete definition, findings, source citations, and exact package digests. An
authorized human approves those frozen values.

## What happens after the alpha boundary

A user may invoke a Runner through the first implemented local OpenCode Runtime
Adapter:

1. The Runner selects approved Change Plan `P1`.
2. It obtains the frozen Agent Packages for F1 and F2.
3. The adapter creates one disposable workspace and OpenCode session per File Brief.
4. Each workspace contains only its assigned target state.
5. Each agent receives only its own `agent_input`.
6. The Runner owns the two declared file operations.

SCORE Core does not launch those agents or write the files. The user-owned
Runner launches them, requires one opaque UTF-8 target artifact per Job, applies
the complete candidate set atomically, and reports only generation and
application. Real project typechecking, builds, tests, and adoption remain
post-application engineering work. The shared adapter seam and Cursor comparison
are described in [Runtime Adapters](../docs/runtime-adapters.md).
