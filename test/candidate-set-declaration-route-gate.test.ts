import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { canonicalJson, sha256Bytes, sha256Json } from "../src/canonical.js";
import { verifyCandidateSetDeclarationRoutes } from "../src/runner/candidate-set-declaration-route-gate.js";
import type { CandidateFile } from "../src/runner/domain.js";

const ownerTarget = "src/account.ts";
const consumerTarget = "src/format-account.ts";
const approvedModuleSpecifier = "./account.js";

function candidate(input: {
  readonly targetPath: string;
  readonly content: string;
  readonly consumes?: ReadonlyArray<{
    readonly name: string;
    readonly owner_target: string;
    readonly module_specifier: string;
  }>;
}): CandidateFile {
  const agentInput = {
    target: {
      path: input.targetPath,
      operation: "replace",
      state_at_base_revision: "present"
    },
    declarations: {
      owned: [],
      consumed: (input.consumes ?? []).map((route) => ({
        ...route,
        declaration: "export interface Account { readonly id: string; }",
        description: "Approved Account declaration."
      }))
    }
  };
  const packageEnvelope = { agent_input: agentInput };
  return {
    targetPath: input.targetPath,
    operation: "replace",
    candidateDigest: sha256Bytes(input.content),
    content: input.content,
    agentInputJson: canonicalJson(agentInput),
    agentInputDigest: sha256Json(agentInput),
    packageJson: canonicalJson(packageEnvelope),
    packageDigest: sha256Json(packageEnvelope)
  };
}

function candidates(consumerSource: string): ReadonlyArray<CandidateFile> {
  return [
    candidate({
      targetPath: ownerTarget,
      content: "export interface Account { readonly id: string; }\n"
    }),
    candidate({
      targetPath: consumerTarget,
      content: consumerSource,
      consumes: [
        {
          name: "Account",
          owner_target: ownerTarget,
          module_specifier: approvedModuleSpecifier
        }
      ]
    })
  ];
}

describe("complete candidate-set declaration route gate", () => {
  it("accepts the exact reviewed named import and is byte deterministic", () => {
    const input = candidates(
      'import type { Account as ApprovedAccount } from "./account.js";\n' +
        "export function formatAccount(account: ApprovedAccount): string { return account.id; }\n"
    );

    const first = verifyCandidateSetDeclarationRoutes(input);
    const second = verifyCandidateSetDeclarationRoutes([...input].reverse());

    assert.equal(first.status, "valid");
    assert.deepEqual(first, second);
    assert.match(first.candidateSetDigest, /^sha256:[0-9a-f]{64}$/u);
    assert.match(first.verdictDigest, /^sha256:[0-9a-f]{64}$/u);
  });

  it("blames only the consumer and retains only bounded approved evidence", () => {
    const input = candidates(
      'import type { Account } from "./wrong.js";\n' +
        "export function formatAccount(account: Account): string { return account.id; }\n"
    );
    const verdict = verifyCandidateSetDeclarationRoutes(input);

    assert.equal(verdict.status, "invalid");
    if (verdict.status !== "invalid") return;
    assert.deepEqual(verdict.rejections.map(({ targetPath }) => targetPath), [
      consumerTarget
    ]);
    assert.deepEqual(verdict.rejections[0]?.evidence.findings, [
      {
        code: "CONSUMED_DECLARATION_ROUTE_MISMATCH",
        declaration: "Account",
        message: "Import must use approved module specifier ./account.js"
      }
    ]);
    assert.doesNotMatch(JSON.stringify(verdict), /wrong\.js/u);
    assert.equal(
      verdict.rejections[0]?.evidence.candidateDigest,
      input[1]?.candidateDigest
    );
  });

  it("fails closed for relevant syntax, unsupported import forms, and missing owners", () => {
    const syntax = verifyCandidateSetDeclarationRoutes(
      candidates('import type { Account from "./account.js";\nexport const ok = 1;\n')
    );
    assert.equal(syntax.status, "invalid");
    if (syntax.status === "invalid") {
      assert.equal(
        syntax.rejections[0]?.evidence.findings[0]?.code,
        "CANDIDATE_SYNTAX_INVALID"
      );
    }

    const unsupported = verifyCandidateSetDeclarationRoutes(
      candidates('import Account = require("./account.js");\nexport { Account };\n')
    );
    assert.equal(unsupported.status, "invalid");
    if (unsupported.status === "invalid") {
      assert.equal(
        unsupported.rejections[0]?.evidence.findings[0]?.code,
        "CONSUMED_DECLARATION_IMPORT_FORM_UNSUPPORTED"
      );
    }

    const missingOwner = verifyCandidateSetDeclarationRoutes(
      candidates('import type { Account } from "./account.js";\n').slice(1)
    );
    assert.equal(missingOwner.status, "invalid");
    if (missingOwner.status === "invalid") {
      assert.equal(
        missingOwner.rejections[0]?.evidence.findings[0]?.code,
        "CONSUMED_DECLARATION_OWNER_CANDIDATE_MISSING"
      );
    }
  });

  it("ignores unrelated syntax errors after proving the exact reviewed import", () => {
    const verdict = verifyCandidateSetDeclarationRoutes(
      candidates(
        'import type { Account } from "./account.js";\n' +
          "export const unrelated = ;\n"
      )
    );

    assert.equal(verdict.status, "valid");
  });

  it("classifies default, namespace, and import-type bindings as unsupported", () => {
    const sources = [
      'import Account from "./account.js";\n',
      'import * as Account from "./account.js";\n',
      'type Account = import("./account.js").Account;\n'
    ];

    for (const source of sources) {
      const verdict = verifyCandidateSetDeclarationRoutes(candidates(source));
      assert.equal(verdict.status, "invalid");
      if (verdict.status === "invalid") {
        assert.equal(
          verdict.rejections[0]?.evidence.findings[0]?.code,
          "CONSUMED_DECLARATION_IMPORT_FORM_UNSUPPORTED"
        );
      }
    }
  });

  it("distinguishes missing, ambiguous, and wrong declaration routes", () => {
    const missing = verifyCandidateSetDeclarationRoutes(
      candidates("export function formatAccount(): string { return 'none'; }\n")
    );
    assert.equal(missing.status, "invalid");
    if (missing.status === "invalid") {
      assert.equal(
        missing.rejections[0]?.evidence.findings[0]?.code,
        "CONSUMED_DECLARATION_IMPORT_MISSING"
      );
    }

    const ambiguous = verifyCandidateSetDeclarationRoutes(
      candidates(
        'import type { Account } from "./account.js";\n' +
          'import type { Account as OtherAccount } from "./other.js";\n' +
          "export type Both = Account | OtherAccount;\n"
      )
    );
    assert.equal(ambiguous.status, "invalid");
    if (ambiguous.status === "invalid") {
      assert.equal(
        ambiguous.rejections[0]?.evidence.findings[0]?.code,
        "CONSUMED_DECLARATION_IMPORT_AMBIGUOUS"
      );
      assert.doesNotMatch(JSON.stringify(ambiguous), /other\.js/u);
    }

    const wrong = verifyCandidateSetDeclarationRoutes(
      candidates('import type { Account } from "./wrong.js";\n')
    );
    assert.equal(wrong.status, "invalid");
    if (wrong.status === "invalid") {
      assert.equal(
        wrong.rejections[0]?.evidence.findings[0]?.code,
        "CONSUMED_DECLARATION_ROUTE_MISMATCH"
      );
    }
  });
});
