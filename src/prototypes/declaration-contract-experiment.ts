/** PROTOTYPE — run with `npm run experiment:declaration-contracts`. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  compileDeclarationEvidenceExperiment,
  runDeclarationContractExperiment,
  type DeclarationContractExperimentInput
} from "./declaration-contract-experiment-model.js";
import { sha256Bytes } from "../canonical.js";

const correctCandidates = {
  "src/account.ts":
    "interface AccountId { readonly value: string; }\n" +
    "export interface Account { readonly id: AccountId; readonly name: string; }\n",
  "src/account-label.ts":
    'import type { Account } from "./account.js";\n' +
    "export function accountLabel(account: Account): string { return account.name; }\n"
};

const agentBriefs: DeclarationContractExperimentInput["agentBriefs"] = [
  {
    targetPath: "src/account.ts",
    operation: "create",
    owned: [
      {
        name: "Account",
        declaration:
          "interface AccountId { readonly value: string; }\n" +
          "export interface Account { readonly id: AccountId; readonly name: string; }"
      }
    ],
    consumed: []
  },
  {
    targetPath: "src/account-label.ts",
    operation: "create",
    owned: [
      {
        name: "accountLabel",
        declaration: "export function accountLabel(account: Account): string;"
      }
    ],
    consumed: [
      {
        name: "Account",
        ownerPath: "src/account.ts",
        source: "./account.js",
        importKind: "type"
      }
    ]
  }
];

function experimentInput(
  candidateFiles: Readonly<Record<string, string>>,
  sourceFiles: Readonly<Record<string, string>> = {}
): DeclarationContractExperimentInput {
  return { sourceFiles, candidateFiles, agentBriefs };
}

interface Scenario {
  readonly name: string;
  readonly input: DeclarationContractExperimentInput;
  readonly expectedStatus: "ok" | "invalid";
  readonly expectedFinding?: string;
  readonly expectedMessageIncludes?: string;
}

const scenarios: ReadonlyArray<Scenario> = [
  {
    name: "correct candidate set",
    input: experimentInput(correctCandidates),
    expectedStatus: "ok"
  },
  {
    name: "formatting-only differences",
    input: experimentInput({
      "src/account.ts":
        "interface AccountId{readonly value:string}\n" +
        "export interface Account{readonly id:AccountId;readonly name:string}",
      "src/account-label.ts":
        "import type {Account} from './account.js'\n" +
        "export function accountLabel( account: Account ) : string {return account.name}"
    }),
    expectedStatus: "ok"
  },
  {
    name: "missing required export",
    input: experimentInput({
      ...correctCandidates,
      "src/account-label.ts":
        'import type { Account } from "./account.js";\n' +
        "function accountLabel(account: Account): string { return account.name; }"
    }),
    expectedStatus: "invalid",
    expectedFinding: "EXPECTED_EXPORT_MISSING"
  },
  {
    name: "wrong parameter type",
    input: experimentInput({
      ...correctCandidates,
      "src/account-label.ts":
        'import type { Account } from "./account.js";\n' +
        "export function accountLabel(account: unknown): string { return String(account); }"
    }),
    expectedStatus: "invalid",
    expectedFinding: "EXPORT_SHAPE_MISMATCH",
    expectedMessageIncludes: "/params/0/typeAnnotation/typeAnnotation/type"
  },
  {
    name: "unapproved alias substitution",
    input: experimentInput({
      ...correctCandidates,
      "src/account-label.ts":
        'import type { Account } from "./account.js";\n' +
        "type Input = Account;\n" +
        "export function accountLabel(account: Input): string { return account.name; }"
    }),
    expectedStatus: "invalid",
    expectedFinding: "EXPORT_SHAPE_MISMATCH",
    expectedMessageIncludes: "/params/0/typeAnnotation/typeAnnotation/typeName/name"
  },
  {
    name: "missing local supporting declaration",
    input: experimentInput({
      ...correctCandidates,
      "src/account.ts":
        "export interface Account { readonly id: AccountId; readonly name: string; }"
    }),
    expectedStatus: "invalid",
    expectedFinding: "CANDIDATE_REFERENCE_ROUTING_UNAVAILABLE"
  },
  {
    name: "changed local supporting declaration",
    input: experimentInput({
      ...correctCandidates,
      "src/account.ts":
        "interface AccountId { readonly value: number; }\n" +
        "export interface Account { readonly id: AccountId; readonly name: string; }"
    }),
    expectedStatus: "invalid",
    expectedFinding: "SUPPORTING_DECLARATION_SHAPE_MISMATCH",
    expectedMessageIncludes: "/body/body/0/typeAnnotation/typeAnnotation/type"
  },
  {
    name: "unexpected export",
    input: experimentInput({
      ...correctCandidates,
      "src/account-label.ts":
        `${correctCandidates["src/account-label.ts"]}\n` +
        "export const DEBUG_LABEL = true;"
    }),
    expectedStatus: "invalid",
    expectedFinding: "UNEXPECTED_EXPORT"
  },
  {
    name: "unapproved project-local import",
    input: experimentInput(
      {
        ...correctCandidates,
        "src/account-label.ts":
          'import type { Account } from "./account.js";\n' +
          'import { decorate } from "./internal-formatting.js";\n' +
          "export function accountLabel(account: Account): string { return decorate(account.name); }"
      },
      {
        "src/internal-formatting.ts":
          "export function decorate(value: string): string { return value; }"
      }
    ),
    expectedStatus: "invalid",
    expectedFinding: "PROJECT_IMPORT_NOT_APPROVED"
  },
  {
    name: "cyclic local supporting declarations terminate",
    input: {
      sourceFiles: {},
      candidateFiles: {
        "src/cycle.ts":
          "interface Left { readonly right: Right; }\n" +
          "interface Right { readonly left: Left; }\n" +
          "export interface Pair { readonly left: Left; readonly right: Right; }"
      },
      agentBriefs: [
        {
          targetPath: "src/cycle.ts",
          operation: "create",
          owned: [
            {
              name: "Pair",
              declaration:
                "interface Left { readonly right: Right; }\n" +
                "interface Right { readonly left: Left; }\n" +
                "export interface Pair { readonly left: Left; readonly right: Right; }"
            }
          ],
          consumed: []
        }
      ]
    },
    expectedStatus: "ok"
  },
  {
    name: "unsupported export form fails closed",
    input: experimentInput({
      ...correctCandidates,
      "src/account-label.ts":
        `${correctCandidates["src/account-label.ts"]}\n` +
        "export default accountLabel;"
    }),
    expectedStatus: "invalid",
    expectedFinding: "CANDIDATE_EXPORT_FORM_UNSUPPORTED"
  },
  {
    name: "same declaration shape cannot reroute an external reference",
    input: {
      sourceFiles: {
        "src/external-route.ts":
          'import type { Foo } from "pkg/a";\n' +
          "export interface UsesFoo { readonly value: Foo; }"
      },
      candidateFiles: {
        "src/external-route.ts":
          'import type { Foo } from "pkg/b";\n' +
          "export interface UsesFoo { readonly value: Foo; }"
      },
      agentBriefs: [
        {
          targetPath: "src/external-route.ts",
          operation: "replace",
          owned: [],
          consumed: []
        }
      ],
      externalDependencies: {
        pkg: { version: "1.0.0", lockDigest: "sha256:frozen-package-lock" }
      }
    },
    expectedStatus: "invalid",
    expectedFinding: "SUPPORTING_DECLARATION_ROUTING_MISMATCH",
    expectedMessageIncludes: "/0/resolution/source"
  },
  {
    name: "replacement preserves the frozen export surface and baseline imports",
    input: {
      sourceFiles: {
        "src/status-helper.ts":
          "export function statusText(value: string): string { return value; }",
        "src/status.ts":
          'import { statusText } from "./status-helper.js";\n' +
          "export interface Status { readonly value: string; }\n" +
          "export function label(status: Status): string { return statusText(status.value); }"
      },
      candidateFiles: {
        "src/status.ts":
          'import { statusText } from "./status-helper.js";\n' +
          "export interface Status { readonly value: string; }\n" +
          'export function label(status: Status): string { return statusText(`status:${status.value}`); }'
      },
      agentBriefs: [
        {
          targetPath: "src/status.ts",
          operation: "replace",
          owned: [],
          consumed: []
        }
      ]
    },
    expectedStatus: "ok"
  },
  {
    name: "replacement cannot remove a frozen baseline export",
    input: {
      sourceFiles: {
        "src/status.ts":
          "export interface Status { readonly value: string; }\n" +
          "export function label(status: Status): string { return status.value; }"
      },
      candidateFiles: {
        "src/status.ts":
          "interface Status { readonly value: string; }\n" +
          "export function label(status: Status): string { return status.value; }"
      },
      agentBriefs: [
        {
          targetPath: "src/status.ts",
          operation: "replace",
          owned: [],
          consumed: []
        }
      ]
    },
    expectedStatus: "invalid",
    expectedFinding: "EXPECTED_EXPORT_MISSING"
  },
  {
    name: "replacement applies an approved signature change and preserves sibling exports",
    input: {
      sourceFiles: {
        "src/account-summary.ts":
          "export interface Account { readonly name: string; }\n" +
          "export const SUMMARY_VERSION = 1 as const;\n" +
          "export function summarize(account: Account): string { return account.name; }"
      },
      candidateFiles: {
        "src/account-summary.ts":
          "export interface Account { readonly name: string; }\n" +
          "export const SUMMARY_VERSION = 1 as const;\n" +
          "export function summarize(account: Account): ReadonlyArray<string> { return [account.name]; }"
      },
      agentBriefs: [
        {
          targetPath: "src/account-summary.ts",
          operation: "replace",
          owned: [
            {
              name: "summarize",
              declaration:
                "export function summarize(account: Account): ReadonlyArray<string>;"
            }
          ],
          consumed: []
        }
      ]
    },
    expectedStatus: "ok"
  },
  {
    name: "replacement rejects failure to implement an approved signature change",
    input: {
      sourceFiles: {
        "src/account-summary.ts":
          "export interface Account { readonly name: string; }\n" +
          "export function summarize(account: Account): string { return account.name; }"
      },
      candidateFiles: {
        "src/account-summary.ts":
          "export interface Account { readonly name: string; }\n" +
          "export function summarize(account: Account): string { return account.name; }"
      },
      agentBriefs: [
        {
          targetPath: "src/account-summary.ts",
          operation: "replace",
          owned: [
            {
              name: "summarize",
              declaration:
                "export function summarize(account: Account): ReadonlyArray<string>;"
            }
          ],
          consumed: []
        }
      ]
    },
    expectedStatus: "invalid",
    expectedFinding: "EXPORT_SHAPE_MISMATCH",
    expectedMessageIncludes: "/returnType/typeAnnotation/type"
  }
];

const scenarioResults = scenarios.map((scenario) => {
  const result = runDeclarationContractExperiment(scenario.input);
  const findingCodes = result.findings.map((finding) => finding.code);
  assert.equal(result.status, scenario.expectedStatus, scenario.name);
  if (scenario.expectedFinding !== undefined) {
    assert.ok(
      findingCodes.includes(scenario.expectedFinding),
      `${scenario.name}: expected ${scenario.expectedFinding}, observed ${findingCodes.join(", ")}`
    );
  }
  if (scenario.expectedMessageIncludes !== undefined) {
    assert.ok(
      result.findings.some((finding) =>
        finding.message.includes(scenario.expectedMessageIncludes!)
      ),
      `${scenario.name}: expected a finding containing ${scenario.expectedMessageIncludes}; observed ${result.findings.map((finding) => finding.message).join(" | ")}`
    );
  }
  return {
    name: scenario.name,
    passed: true,
    expectedStatus: scenario.expectedStatus,
    actualStatus: result.status,
    findingCodes,
    findingMessages: result.findings.map((finding) => finding.message),
    evidenceDigest: result.evidenceDigest,
    candidateSetDigest: result.candidateSetDigest,
    verdictDigest: result.verdictDigest,
    contracts:
      result.status === "ok"
        ? result.contracts.map((contract) => ({
            path: contract.path,
            name: contract.name,
            namespace: contract.namespace,
            visibility: contract.visibility,
            shapeDigest: contract.shapeDigest
          }))
        : []
  };
});

const wrongParameter = scenarioResults.find(
  (scenario) => scenario.name === "wrong parameter type"
)!;
const aliasSubstitution = scenarioResults.find(
  (scenario) => scenario.name === "unapproved alias substitution"
)!;
assert.notEqual(
  wrongParameter.verdictDigest,
  aliasSubstitution.verdictDigest,
  "Different rejected candidate sets must not share one verdict digest"
);

const first = runDeclarationContractExperiment(experimentInput(correctCandidates));
const repeated = runDeclarationContractExperiment(experimentInput(correctCandidates));
assert.equal(JSON.stringify(first), JSON.stringify(repeated));
assert.equal(first.evidenceDigest, repeated.evidenceDigest);
assert.equal(first.verdictDigest, repeated.verdictDigest);

const missingExternalEvidence = compileDeclarationEvidenceExperiment({
  sourceFiles: {
    "src/external.ts":
      'import type { Effect } from "effect";\nexport interface UsesEffect { readonly value: Effect<void>; }'
  },
  roots: [{ path: "src/external.ts", name: "UsesEffect", namespace: "type" }]
});
assert.equal(missingExternalEvidence.status, "invalid");
assert.ok(
  missingExternalEvidence.findings.some(
    (finding) => finding.code === "EXTERNAL_DEPENDENCY_EVIDENCE_MISSING"
  )
);

const overFileLimit = compileDeclarationEvidenceExperiment({
  sourceFiles: Object.fromEntries(
    Array.from({ length: 257 }, (_, index) => [`src/limit-${index}.ts`, ""])
  ),
  roots: []
});
assert.equal(overFileLimit.status, "invalid");
assert.ok(overFileLimit.findings.some((finding) => finding.code === "SOURCE_FILE_LIMIT_EXCEEDED"));

function source(path: string): string {
  return readFileSync(path, "utf8");
}

function dependencyEvidence(lockPath: string, packageName: string) {
  const lockText = source(lockPath);
  const lock = JSON.parse(lockText) as {
    readonly packages: Readonly<Record<string, { readonly version?: string }>>;
  };
  const version = lock.packages[`node_modules/${packageName}`]?.version;
  assert.ok(version, `${packageName} is missing from ${lockPath}`);
  return { version, lockDigest: sha256Bytes(lockText) };
}

const realTrials = [
  {
    name: "SCORE validation function",
    result: compileDeclarationEvidenceExperiment({
      sourceFiles: {
        "src/validation.ts": source("src/validation.ts"),
        "src/compiler-input.ts": source("src/compiler-input.ts"),
        "src/bundle-schema.ts": source("src/bundle-schema.ts")
      },
      roots: [{ path: "src/validation.ts", name: "validateCompilationBundle", namespace: "value" }]
    })
  },
  {
    name: "Effect schema closure with value and derived type declarations",
    result: compileDeclarationEvidenceExperiment({
      sourceFiles: { "src/runner/domain.ts": source("src/runner/domain.ts") },
      externalDependencies: {
        effect: dependencyEvidence("package-lock.json", "effect")
      },
      roots: [
        { path: "src/runner/domain.ts", name: "ClaimedJob", namespace: "value" },
        { path: "src/runner/domain.ts", name: "ClaimedJob", namespace: "type" }
      ]
    })
  },
  {
    name: "TSX props with project and external references",
    result: compileDeclarationEvidenceExperiment({
      sourceFiles: {
        "examples/product-validation/realistic-react-app/src/components/TaskList.tsx": source(
          "examples/product-validation/realistic-react-app/src/components/TaskList.tsx"
        ),
        "examples/product-validation/realistic-react-app/src/domain/task.ts": source(
          "examples/product-validation/realistic-react-app/src/domain/task.ts"
        )
      },
      externalDependencies: {
        react: dependencyEvidence(
          "examples/product-validation/realistic-react-app/package-lock.json",
          "react"
        )
      },
      roots: [
        {
          path: "examples/product-validation/realistic-react-app/src/components/TaskList.tsx",
          name: "TaskListProps",
          namespace: "type"
        },
        {
          path: "examples/product-validation/realistic-react-app/src/components/TaskList.tsx",
          name: "TaskList",
          namespace: "value"
        }
      ]
    })
  },
  {
    name: "Node platform reference",
    result: compileDeclarationEvidenceExperiment({
      sourceFiles: {
        "src/runner/open-code-process.ts": source("src/runner/open-code-process.ts")
      },
      roots: [
        {
          path: "src/runner/open-code-process.ts",
          name: "StartedOpenCodeProcess",
          namespace: "type"
        }
      ]
    })
  }
];

for (const trial of realTrials) {
  assert.equal(trial.result.status, "ok", `${trial.name}: ${JSON.stringify(trial.result.findings)}`);
}

console.log(
  JSON.stringify(
    {
      prototype: "declaration contract experiment",
      question:
        "Can in-memory AST evidence reject contract drift deterministically without recreating a TypeScript project?",
      scenarioResults,
      deterministicReplay: {
        byteIdentical: JSON.stringify(first) === JSON.stringify(repeated),
        evidenceDigest: first.evidenceDigest,
        verdictDigest: first.verdictDigest
      },
      boundaryChecks: [
        {
          name: "external dependency without frozen lock evidence fails closed",
          status: missingExternalEvidence.status,
          findingCodes: missingExternalEvidence.findings.map((finding) => finding.code)
        },
        {
          name: "source file limit fails before parsing",
          status: overFileLimit.status,
          findingCodes: overFileLimit.findings.map((finding) => finding.code)
        }
      ],
      realTrials: realTrials.map((trial) => ({
        name: trial.name,
        status: trial.result.status,
        evidenceDigest: trial.result.evidenceDigest,
        contracts: trial.result.contracts.map((contract) => ({
          path: contract.path,
          name: contract.name,
          namespace: contract.namespace,
          visibility: contract.visibility,
          shapeDigest: contract.shapeDigest
        })),
        externalReferences: trial.result.externalReferences,
        platformReferences: trial.result.platformReferences,
        findingCodes: trial.result.findings.map((finding) => finding.code)
      }))
    },
    null,
    2
  )
);
