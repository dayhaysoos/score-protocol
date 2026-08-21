/**
 * PROTOTYPE — deterministic feedback for one assigned file.
 *
 * This is deliberately not a Runner gate. It projects the existing declaration
 * contract experiment into the smallest result an isolated file Agent needs in
 * order to repair its current candidate before finishing.
 */

import { runDeclarationContractExperiment } from "./declaration-contract-experiment-model.js";
import { sha256Bytes } from "../canonical.js";

export interface AssignedFileDeclarationCheckInput {
  readonly targetPath: string;
  readonly baselineSource: string;
  readonly candidateSource: string;
  readonly declarationName: string;
  readonly documentedDeclaration: string;
}

export interface AssignedFileDeclarationsCheckInput {
  readonly targetPath: string;
  readonly baselineSource: string;
  readonly candidateSource: string;
  readonly declarations: ReadonlyArray<{
    readonly name: string;
    readonly documentedDeclaration: string;
  }>;
}

export interface AssignedFileDeclarationFinding {
  readonly code: string;
  readonly declaration: string | null;
  readonly message: string;
}

export type AssignedFileDeclarationCheckResult =
  | {
      readonly status: "valid";
      readonly findings: readonly [];
      readonly candidateDigest: string;
      readonly verdictDigest: string;
    }
  | {
      readonly status: "invalid";
      readonly findings: ReadonlyArray<AssignedFileDeclarationFinding>;
      readonly candidateDigest: string;
      readonly verdictDigest: string;
    };

export function checkAssignedFileDeclaration(
  input: AssignedFileDeclarationCheckInput
): AssignedFileDeclarationCheckResult {
  return checkAssignedFileDeclarations({
    targetPath: input.targetPath,
    baselineSource: input.baselineSource,
    candidateSource: input.candidateSource,
    declarations: [
      {
        name: input.declarationName,
        documentedDeclaration: input.documentedDeclaration
      }
    ]
  });
}

export function checkAssignedFileDeclarations(
  input: AssignedFileDeclarationsCheckInput
): AssignedFileDeclarationCheckResult {
  const candidateDigest = sha256Bytes(Buffer.from(input.candidateSource, "utf8"));
  const result = runDeclarationContractExperiment({
    sourceFiles: { [input.targetPath]: input.baselineSource },
    candidateFiles: { [input.targetPath]: input.candidateSource },
    agentBriefs: [
      {
        targetPath: input.targetPath,
        operation: "replace",
        owned: input.declarations.map(({ name, documentedDeclaration }) => ({
          name,
          declaration: documentedDeclaration
        })),
        consumed: []
      }
    ]
  });

  if (result.status === "ok") {
    return {
      status: "valid",
      findings: [],
      candidateDigest,
      verdictDigest: result.verdictDigest
    };
  }

  const exportMismatchDeclarations = new Set(
    result.findings
      .filter(({ code }) => code === "EXPORT_SHAPE_MISMATCH")
      .map(({ declaration }) => declaration)
  );
  const findings = result.findings.filter(
    ({ code, declaration }) =>
      !(
        code === "SUPPORTING_DECLARATION_SHAPE_MISMATCH" &&
        exportMismatchDeclarations.has(declaration)
      )
  );

  return {
    status: "invalid",
    findings: findings.map(({ code, declaration, message }) => ({
      code,
      declaration,
      message
    })),
    candidateDigest,
    verdictDigest: result.verdictDigest
  };
}
