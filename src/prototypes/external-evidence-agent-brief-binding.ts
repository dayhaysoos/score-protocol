/**
 * PROTOTYPE — bind one frozen external-declaration evidence fixture into one
 * synthetic Agent Brief without package, repository, or runtime access.
 *
 * Run with:
 *   npm exec -- tsx src/prototypes/external-evidence-agent-brief-binding.ts
 */

import assert from "node:assert/strict";

import { canonicalJson, sha256Bytes, sha256Json } from "../canonical.js";

const INPUT_SCHEMA_VERSION = "score.prototype.external-declaration-evidence@0.1.0" as const;
const CONTEXT_SCHEMA_VERSION = "score.prototype.external-declaration-context@0.1.0" as const;
const BINDING_SCHEMA_VERSION = "score.prototype.external-evidence-binding@0.1.0" as const;

interface ExternalReference {
  readonly name: string;
  readonly route:
    | { readonly kind: "imported_member"; readonly source: string }
    | { readonly kind: "same_module" }
    | { readonly kind: "typescript_global" }
    | { readonly kind: "type_parameter" };
}

interface ExternalDeclarationEvidence {
  readonly package: {
    readonly name: string;
    readonly version: string;
    readonly integrity: string;
    readonly moduleSpecifier: string;
    readonly declarationPath: string;
  };
  readonly parser: { readonly name: string; readonly version: string };
  readonly sourceDigest: string;
  readonly declarations: ReadonlyArray<{
    readonly name: string;
    readonly declarationKind: string;
    readonly namespace: "value" | "type" | "type_and_value";
    readonly declaration: string;
    readonly declarationDigest: string;
    readonly references: ReadonlyArray<ExternalReference>;
  }>;
  readonly limits: {
    readonly maxSourceBytes: number;
    readonly maxMembers: number;
    readonly maxDeclarationBytes: number;
  };
  readonly contentDigest: string;
}

type EvidenceInput =
  | {
      readonly schemaVersion: typeof INPUT_SCHEMA_VERSION;
      readonly status: "ok";
      readonly evidence: ExternalDeclarationEvidence;
    }
  | {
      readonly schemaVersion: typeof INPUT_SCHEMA_VERSION;
      readonly status: "invalid";
      readonly findings: ReadonlyArray<{
        readonly code: string;
        readonly location: string;
        readonly message: string;
      }>;
    };

type BindingFindingCode =
  | "EXTERNAL_EVIDENCE_DIGEST_MISMATCH"
  | "EXTERNAL_EVIDENCE_UNAVAILABLE"
  | "EXTERNAL_EVIDENCE_UNSUPPORTED";

type BindingResult =
  | {
      readonly status: "bound";
      readonly agentBrief: Readonly<Record<string, unknown>>;
      readonly agentBriefDigest: string;
      readonly bindingDigest: string;
    }
  | {
      readonly status: "invalid";
      readonly findings: readonly [{
        readonly code: BindingFindingCode;
        readonly location: string;
        readonly message: string;
      }];
    };

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (typeof value !== "object" || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function evidenceWithoutDigest(
  evidence: ExternalDeclarationEvidence
): Omit<ExternalDeclarationEvidence, "contentDigest"> {
  const { contentDigest: _contentDigest, ...withoutDigest } = evidence;
  return withoutDigest;
}

function invalid(
  code: BindingFindingCode,
  location: string,
  message: string
): BindingResult {
  return { status: "invalid", findings: [{ code, location, message }] };
}

function routeForAgent(reference: ExternalReference): Readonly<Record<string, string>> {
  switch (reference.route.kind) {
    case "imported_member":
      return { kind: "external_package_reference" };
    case "same_module":
      return { kind: "same_external_module" };
    case "typescript_global":
      return { kind: "typescript_global" };
    case "type_parameter":
      return { kind: "type_parameter" };
  }
}

function bindExternalEvidenceToAgentBrief(input: {
  readonly evidenceInput: EvidenceInput;
  readonly targetPath: string;
  readonly objective: string;
}): BindingResult {
  if (input.evidenceInput.status === "invalid") {
    return invalid(
      "EXTERNAL_EVIDENCE_UNAVAILABLE",
      "/evidenceInput",
      `External declaration evidence is unavailable: ${input.evidenceInput.findings.map(({ code }) => code).join(", ")}`
    );
  }
  const evidence = input.evidenceInput.evidence;
  if (
    evidence.declarations.length === 0 ||
    evidence.declarations.length > evidence.limits.maxMembers ||
    evidence.declarations.some((declaration) => declaration.declaration.length === 0)
  ) {
    return invalid(
      "EXTERNAL_EVIDENCE_UNSUPPORTED",
      "/evidenceInput/evidence/declarations",
      "External declaration evidence does not contain one bounded non-empty declaration set"
    );
  }
  if (
    sha256Json(evidenceWithoutDigest(evidence)) !== evidence.contentDigest ||
    evidence.declarations.some(
      (declaration) => sha256Bytes(declaration.declaration) !== declaration.declarationDigest
    )
  ) {
    return invalid(
      "EXTERNAL_EVIDENCE_DIGEST_MISMATCH",
      "/evidenceInput/evidence/contentDigest",
      "External declaration evidence does not reproduce its frozen digests"
    );
  }

  const contextContent = deepFreeze({
    schemaVersion: CONTEXT_SCHEMA_VERSION,
    package: {
      name: evidence.package.name,
      version: evidence.package.version,
      integrity: evidence.package.integrity,
      moduleSpecifier: evidence.package.moduleSpecifier
    },
    parser: evidence.parser,
    declarations: evidence.declarations.map((declaration) => ({
      name: declaration.name,
      namespace: declaration.namespace,
      declaration: declaration.declaration,
      declarationDigest: declaration.declarationDigest,
      references: declaration.references.map((reference) => ({
        name: reference.name,
        route: routeForAgent(reference)
      }))
    })),
    evidenceDigest: evidence.contentDigest
  });
  const binding = deepFreeze({
    contract_input: "external-declaration-evidence",
    purpose: "Supply exact selected external package contracts without dependency access.",
    kind: "external_declaration_evidence",
    version: "1.0.0",
    content: contextContent
  });
  const agentBrief = deepFreeze({
    objective: input.objective,
    target: {
      path: input.targetPath,
      operation: "replace"
    },
    intended_outcome: input.objective,
    declarations: { owned: [], consumed: [] },
    input_bindings: [binding],
    required_capabilities: [
      {
        capability: "score.coding.filesystem.single-target",
        version_rule: "=1.0.0",
        required: true,
        configuration: {
          target_path: input.targetPath,
          allowed_operations: ["read_assigned_target", "replace_assigned_target"],
          shell: false,
          network: false,
          repository_discovery: false,
          dependency_access: false
        }
      }
    ],
    constraints: [
      "Use only the selected external declarations supplied in the external-declaration-evidence binding.",
      "Do not infer unavailable external package members."
    ],
    prohibited_effects: [
      "Do not access node_modules, package files, the network, or unapproved repository files."
    ]
  });
  const agentBriefDigest = sha256Json(agentBrief);
  return deepFreeze({
    status: "bound",
    agentBrief,
    agentBriefDigest,
    bindingDigest: sha256Json({
      schemaVersion: BINDING_SCHEMA_VERSION,
      targetPath: input.targetPath,
      evidenceDigest: evidence.contentDigest,
      agentBriefDigest
    })
  });
}

const exactEvidenceWithoutDigest = {
  package: {
    name: "effect",
    version: "4.0.0-beta.104",
    integrity: "sha512-YSSaaMc8gBoHnabYXlgHpKVctsj4ezTSoojdd8SA3NWHoZ7LMPiUDhCnP1ZSOfQ7ly6P6XLhAw216NfLEHfg2A==",
    moduleSpecifier: "effect/Schema",
    declarationPath: "./dist/Schema.d.ts"
  },
  parser: { name: "oxc-parser", version: "0.144.0" },
  sourceDigest: "sha256:2dd3d0a458a70aee7c1e68e30d21a2ea7f42be5bb99d0e6ad5df4c033f55a4f9",
  declarations: [
    {
      name: "check",
      declarationKind: "TSDeclareFunction",
      namespace: "value" as const,
      declaration:
        "export declare function check<S extends Top>(...checks: readonly [SchemaAST.Check<S[\"Type\"]>, ...Array<SchemaAST.Check<S[\"Type\"]>>]): (self: S) => S[\"Rebuild\"];",
      declarationDigest: "sha256:60c3d12d78e2e0e00535a93c34d220f4cecdde21a6a131e5449844779f908668",
      references: [
        { name: "Array", route: { kind: "typescript_global" as const } },
        { name: "S", route: { kind: "type_parameter" as const } },
        {
          name: "SchemaAST.Check",
          route: { kind: "imported_member" as const, source: "./SchemaAST.ts" }
        },
        { name: "Top", route: { kind: "same_module" as const } }
      ]
    },
    {
      name: "isPattern",
      declarationKind: "TSDeclareFunction",
      namespace: "value" as const,
      declaration:
        "export declare function isPattern(regExp: globalThis.RegExp, annotations?: Annotations.Filter): SchemaAST.Filter<string>;",
      declarationDigest: "sha256:a4f632a0bc6bade931cf9a066177775a7965857e8d4aef1f86cfe14e26376425",
      references: [
        { name: "Annotations.Filter", route: { kind: "same_module" as const } },
        {
          name: "SchemaAST.Filter",
          route: { kind: "imported_member" as const, source: "./SchemaAST.ts" }
        },
        { name: "globalThis.RegExp", route: { kind: "typescript_global" as const } }
      ]
    }
  ],
  limits: {
    maxSourceBytes: 1024 * 1024,
    maxMembers: 8,
    maxDeclarationBytes: 32 * 1024
  }
} satisfies Omit<ExternalDeclarationEvidence, "contentDigest">;

function validEvidence(
  withoutDigest: Omit<ExternalDeclarationEvidence, "contentDigest">
): EvidenceInput {
  return {
    schemaVersion: INPUT_SCHEMA_VERSION,
    status: "ok",
    evidence: {
      ...withoutDigest,
      contentDigest: sha256Json(withoutDigest)
    }
  };
}

const bindingInput = {
  evidenceInput: validEvidence(exactEvidenceWithoutDigest),
  targetPath: "src/validation.ts",
  objective: "Use the exact approved Effect Schema contracts in the assigned file."
} as const;
const first = bindExternalEvidenceToAgentBrief(bindingInput);
const second = bindExternalEvidenceToAgentBrief(bindingInput);
assert.equal(first.status, "bound");
assert.equal(second.status, "bound");
assert.equal(canonicalJson(first), canonicalJson(second));
assert.ok(Object.isFrozen(first));
assert.ok(Object.isFrozen(first.agentBrief));

const renderedAgentBrief = canonicalJson(first.agentBrief);
for (const forbidden of ["/node_modules/", "declarationPath", "sourceDigest", "./SchemaAST.ts"]) {
  assert.equal(renderedAgentBrief.includes(forbidden), false, `Agent Brief leaked ${forbidden}`);
}
assert.match(renderedAgentBrief, /effect\/Schema/u);
assert.match(renderedAgentBrief, /function check/u);
assert.match(renderedAgentBrief, /function isPattern/u);

assert.equal(bindingInput.evidenceInput.status, "ok");
const tamperedEvidence: EvidenceInput = {
  ...bindingInput.evidenceInput,
  evidence: {
    ...bindingInput.evidenceInput.evidence,
    declarations: bindingInput.evidenceInput.evidence.declarations.map((declaration, index) =>
      index === 0
        ? { ...declaration, declaration: "export declare function check(): never;" }
        : declaration
    )
  }
};
const tampered = bindExternalEvidenceToAgentBrief({
  ...bindingInput,
  evidenceInput: tamperedEvidence
});
assert.equal(tampered.status, "invalid");
assert.equal(tampered.findings[0].code, "EXTERNAL_EVIDENCE_DIGEST_MISMATCH");

const nextVersionWithoutDigest = structuredClone(exactEvidenceWithoutDigest);
nextVersionWithoutDigest.package.version = "4.0.0-beta.105";
const nextVersion = bindExternalEvidenceToAgentBrief({
  ...bindingInput,
  evidenceInput: validEvidence(nextVersionWithoutDigest)
});
assert.equal(nextVersion.status, "bound");
assert.notEqual(first.bindingDigest, nextVersion.bindingDigest);

const missing = bindExternalEvidenceToAgentBrief({
  ...bindingInput,
  evidenceInput: {
    schemaVersion: INPUT_SCHEMA_VERSION,
    status: "invalid",
    findings: [
      {
        code: "EXTERNAL_DECLARATION_MISSING",
        location: "/members/pattern",
        message: "External module does not export pattern"
      }
    ]
  }
});
assert.equal(missing.status, "invalid");
assert.equal(missing.findings[0].code, "EXTERNAL_EVIDENCE_UNAVAILABLE");
assert.equal("agentBrief" in missing, false);

const reportWithoutDigest = {
  experiment: "external evidence Agent Brief binding",
  question:
    "Can one frozen external contract bundle become immutable Agent context without dependency access?",
  verdict: "successful",
  assertions: {
    identicalInputsProduceByteIdenticalBriefs: true,
    evidenceAndBriefAreDigestBound: true,
    tamperedDeclarationRejected: tampered.status === "invalid" ? tampered.findings[0].code : null,
    packageVersionChangesBindingDigest: true,
    missingDeclarationProducesNoBrief: true,
    dependencyPathsExcludedFromAgentContext: true,
    agentDependencyAccess: false,
    paidAgentInvocations: 0
  },
  binding: first,
  versionChangedBindingDigest: nextVersion.bindingDigest,
  missingEvidenceResult: missing
};
const report = {
  ...reportWithoutDigest,
  reportDigest: sha256Json(reportWithoutDigest)
};

process.stdout.write(`${canonicalJson(report)}\n`);
