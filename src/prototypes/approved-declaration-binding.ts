/**
 * PROTOTYPE — derive one declaration verifier/repair configuration from an
 * exact approved Agent Package. This is not production Runner policy.
 */

import {
  canonicalJson,
  parseJsonNoDuplicateKeys,
  sha256Bytes,
  sha256Json
} from "../canonical.js";
import { repositoryRevisionContentDigest } from "../repository-source-state.js";
import type { ApprovedPassExport } from "../score-alpha.js";

export type ApprovedDeclarationBindingFindingCode =
  | "APPROVED_EXPORT_UNSUPPORTED"
  | "APPROVED_SOURCE_DIGEST_MISMATCH"
  | "APPROVED_PAYLOAD_NOT_FOUND"
  | "APPROVED_PAYLOAD_AMBIGUOUS"
  | "APPROVED_PAYLOAD_DIGEST_MISMATCH"
  | "APPROVED_JOB_INPUT_MISMATCH"
  | "APPROVED_TARGET_MISMATCH"
  | "APPROVED_TARGET_STATE_UNSUPPORTED"
  | "APPROVED_DECLARATION_MISSING"
  | "APPROVED_DECLARATION_AMBIGUOUS"
  | "APPROVED_DECLARATION_UNSUPPORTED";

export interface ApprovedDeclarationBindingFinding {
  readonly code: ApprovedDeclarationBindingFindingCode;
  readonly location: string;
  readonly message: string;
}

export interface ApprovedDeclarationRepairConfiguration {
  readonly targetPath: string;
  readonly baselineSource: string;
  readonly declarations: ReadonlyArray<{
    readonly name: string;
    readonly documentedDeclaration: string;
  }>;
  readonly maxRepairs: 1;
}

export type ApprovedDeclarationBindingResult =
  | {
      readonly status: "invalid";
      readonly findings: readonly [ApprovedDeclarationBindingFinding];
    }
  | {
      readonly status: "bound";
      readonly configuration: ApprovedDeclarationRepairConfiguration;
      readonly evidence: {
        readonly passId: string;
        readonly reviewId: string;
        readonly decisionId: string;
        readonly payloadId: string;
        readonly sourceSnapshotDigest: string;
        readonly agentInputDigest: string;
        readonly packageDigest: string;
      };
      readonly bindingDigest: string;
    };

interface ApprovedJobBindingInput {
  readonly targetPath: string;
  readonly agentInputJson: string;
  readonly packageDigest: string;
}

function invalid(
  code: ApprovedDeclarationBindingFindingCode,
  location: string,
  message: string
): ApprovedDeclarationBindingResult {
  return { status: "invalid", findings: [{ code, location, message }] };
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function approvedDeclaration(
  value: unknown
): { readonly name: string; readonly declaration: string } | undefined {
  const declaration = record(value);
  return typeof declaration?.name === "string" &&
    typeof declaration.declaration === "string"
    ? { name: declaration.name, declaration: declaration.declaration }
    : undefined;
}

export function bindApprovedDeclarationRepair(input: {
  readonly approvedPlan: ApprovedPassExport;
  readonly job: ApprovedJobBindingInput;
  readonly maxRepairs: 1;
}): ApprovedDeclarationBindingResult {
  const { approvedPlan, job } = input;
  if (
    approvedPlan.schema !== "score.approved-pass-export" ||
    approvedPlan.version !== "0.1.0-alpha.7"
  ) {
    return invalid(
      "APPROVED_EXPORT_UNSUPPORTED",
      "/approvedPlan",
      "Approved Plan export schema or version is unsupported"
    );
  }
  if (
    repositoryRevisionContentDigest({
      orderedManifest: approvedPlan.source_snapshot.files
    }) !== approvedPlan.source_snapshot.content_digest
  ) {
    return invalid(
      "APPROVED_SOURCE_DIGEST_MISMATCH",
      "/approvedPlan/source_snapshot/content_digest",
      "Approved Source Snapshot digest does not reproduce"
    );
  }

  const matches = approvedPlan.payloads.filter(
    (payload) => payload.payload_digest === job.packageDigest
  );
  if (matches.length === 0) {
    return invalid(
      "APPROVED_PAYLOAD_NOT_FOUND",
      "/job/packageDigest",
      "Job package digest is not present in the approved revision"
    );
  }
  if (matches.length !== 1) {
    return invalid(
      "APPROVED_PAYLOAD_AMBIGUOUS",
      "/job/packageDigest",
      "Job package digest does not identify exactly one approved Agent Package"
    );
  }
  const payload = matches[0]!;
  if (
    sha256Json(payload.control) !== payload.control_digest ||
    sha256Json(payload.agent_input) !== payload.agent_input_digest ||
    sha256Json(payload.payload) !== payload.payload_digest ||
    sha256Json({ control: payload.control, agent_input: payload.agent_input }) !==
      payload.payload_digest
  ) {
    return invalid(
      "APPROVED_PAYLOAD_DIGEST_MISMATCH",
      "/approvedPlan/payloads",
      "Approved Agent Package content does not reproduce its bound digests"
    );
  }

  let suppliedAgentInput: unknown;
  try {
    suppliedAgentInput = parseJsonNoDuplicateKeys(job.agentInputJson);
  } catch {
    return invalid(
      "APPROVED_JOB_INPUT_MISMATCH",
      "/job/agentInputJson",
      "Job Agent Input is not canonicalizable JSON from the approved revision"
    );
  }
  if (
    canonicalJson(suppliedAgentInput) !== canonicalJson(payload.agent_input) ||
    sha256Json(suppliedAgentInput) !== payload.agent_input_digest
  ) {
    return invalid(
      "APPROVED_JOB_INPUT_MISMATCH",
      "/job/agentInputJson",
      "Job Agent Input does not match the approved Agent Input digest"
    );
  }

  const agentInput = record(payload.agent_input);
  const target = record(agentInput?.target);
  if (
    payload.target_path !== job.targetPath ||
    target?.path !== job.targetPath
  ) {
    return invalid(
      "APPROVED_TARGET_MISMATCH",
      "/job/targetPath",
      "Job target does not match the approved Agent Package target"
    );
  }

  let baselineSource: string;
  if (target.state_at_base_revision === "absent") {
    if (target.content !== undefined) {
      return invalid(
        "APPROVED_TARGET_STATE_UNSUPPORTED",
        "/approvedPlan/payloads/agent_input/target",
        "Approved absent target unexpectedly contains source bytes"
      );
    }
    baselineSource = "";
  } else if (
    target.state_at_base_revision === "present" &&
    typeof target.content === "string"
  ) {
    baselineSource = target.content;
  } else {
    return invalid(
      "APPROVED_TARGET_STATE_UNSUPPORTED",
      "/approvedPlan/payloads/agent_input/target",
      "Approved target state does not provide exact present bytes or an exact absence"
    );
  }

  const declarations = record(agentInput?.declarations);
  if (!Array.isArray(declarations?.owned) || declarations.owned.length === 0) {
    return invalid(
      "APPROVED_DECLARATION_MISSING",
      "/approvedPlan/payloads/agent_input/declarations/owned",
      "Approved Agent Input has no owned declaration to verify"
    );
  }
  const approvedDeclarations: Array<{
    readonly name: string;
    readonly documentedDeclaration: string;
  }> = [];
  const names = new Set<string>();
  for (const [index, value] of declarations.owned.entries()) {
    const declaration = approvedDeclaration(value);
    if (declaration === undefined) {
      return invalid(
        "APPROVED_DECLARATION_UNSUPPORTED",
        `/approvedPlan/payloads/agent_input/declarations/owned/${index}`,
        "Approved owned declaration does not contain a string name and declaration"
      );
    }
    if (names.has(declaration.name)) {
      return invalid(
        "APPROVED_DECLARATION_AMBIGUOUS",
        `/approvedPlan/payloads/agent_input/declarations/owned/${index}/name`,
        `Approved Agent Input owns declaration ${declaration.name} more than once`
      );
    }
    names.add(declaration.name);
    approvedDeclarations.push(
      Object.freeze({
        name: declaration.name,
        documentedDeclaration: declaration.declaration
      })
    );
  }

  const configuration = Object.freeze({
    targetPath: job.targetPath,
    baselineSource,
    declarations: Object.freeze(approvedDeclarations),
    maxRepairs: input.maxRepairs
  } as const);
  const evidence = Object.freeze({
    passId: approvedPlan.pass_id,
    reviewId: approvedPlan.publication.review_id,
    decisionId: approvedPlan.publication.decision_id,
    payloadId: payload.payload_id,
    sourceSnapshotDigest: approvedPlan.source_snapshot.content_digest,
    agentInputDigest: payload.agent_input_digest,
    packageDigest: payload.payload_digest
  } as const);
  return Object.freeze({
    status: "bound",
    configuration,
    evidence,
    bindingDigest: sha256Json({
      schema: "score.prototype.approved-declaration-binding",
      version: "1.0.0",
      evidence,
      verifierInput: {
        targetPath: configuration.targetPath,
        baselineDigest: sha256Bytes(configuration.baselineSource),
        declarations: configuration.declarations,
        maxRepairs: configuration.maxRepairs
      }
    })
  });
}
