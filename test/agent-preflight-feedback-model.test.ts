import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  checkAssignedFileDeclaration,
  checkAssignedFileDeclarations
} from "../src/prototypes/agent-preflight-feedback-model.js";

const targetPath = "src/example.ts";
const documentedDeclaration =
  'export function inspect(value: string): { readonly status: "ok"; readonly value: string } | { readonly status: "invalid"; readonly message: string };';

const baselineSource = `
type Result =
  | { readonly status: "ok"; readonly value: string }
  | { readonly status: "invalid"; readonly message: string };

export function inspect(value: string): Result {
  return value.length > 0
    ? { status: "ok", value }
    : { status: "invalid", message: "empty" };
}
`;

const correctedCandidateSource = `
type Result =
  | { readonly status: "ok"; readonly value: string }
  | { readonly status: "invalid"; readonly message: string };

export function inspect(value: string): { readonly status: "ok"; readonly value: string } | { readonly status: "invalid"; readonly message: string } {
  return value.length > 0
    ? { status: "ok", value }
    : { status: "invalid", message: "empty" };
}
`;

describe("assigned-file declaration preflight", () => {
  it("explains a private alias substitution and accepts the exact inline contract", () => {
    const invalid = checkAssignedFileDeclaration({
      targetPath,
      baselineSource,
      candidateSource: baselineSource,
      documentedDeclaration,
      declarationName: "inspect"
    });

    assert.equal(invalid.status, "invalid");
    assert.deepEqual(
      invalid.findings.map(({ code, declaration }) => ({ code, declaration })),
      [{ code: "EXPORT_SHAPE_MISMATCH", declaration: "inspect" }]
    );

    const valid = checkAssignedFileDeclaration({
      targetPath,
      baselineSource,
      candidateSource: correctedCandidateSource,
      documentedDeclaration,
      declarationName: "inspect"
    });

    assert.equal(valid.status, "valid");
    assert.deepEqual(valid.findings, []);
    assert.equal(
      valid.candidateDigest,
      "sha256:9dcd9261b80b7838631a30cfb5e109148027bca330676b78bc56eea105404ec4"
    );
  });

  it("returns a byte-identical verdict for identical inputs", () => {
    const input = {
      targetPath,
      baselineSource,
      candidateSource: correctedCandidateSource,
      documentedDeclaration,
      declarationName: "inspect"
    } as const;

    const first = checkAssignedFileDeclaration(input);
    const repeated = checkAssignedFileDeclaration(input);

    assert.equal(JSON.stringify(first), JSON.stringify(repeated));
    assert.equal(first.candidateDigest, repeated.candidateDigest);
    assert.equal(first.verdictDigest, repeated.verdictDigest);
  });

  it("aggregates two approved declarations against the same exact candidate bytes", () => {
    const invalidCandidate = `
export function prefix(): string { return "Account"; }
export function label(): number { return 42; }
`;
    const correctedCandidate = `
export function prefix(): string { return "Account"; }
export function label(): string { return "Account"; }
`;
    const input = {
      targetPath: "src/account-label.ts",
      baselineSource: "",
      declarations: [
        {
          name: "prefix",
          documentedDeclaration: "export function prefix(): string;"
        },
        {
          name: "label",
          documentedDeclaration: "export function label(): string;"
        }
      ]
    } as const;

    const invalid = checkAssignedFileDeclarations({
      ...input,
      candidateSource: invalidCandidate
    });
    assert.equal(invalid.status, "invalid");
    assert.deepEqual(
      invalid.findings.map(({ code, declaration }) => ({ code, declaration })),
      [{ code: "EXPORT_SHAPE_MISMATCH", declaration: "label" }]
    );

    const valid = checkAssignedFileDeclarations({
      ...input,
      candidateSource: correctedCandidate
    });
    assert.equal(valid.status, "valid");
    assert.deepEqual(valid.findings, []);
    assert.equal(
      JSON.stringify(valid),
      JSON.stringify(
        checkAssignedFileDeclarations({
          ...input,
          candidateSource: correctedCandidate
        })
      )
    );
  });
});
