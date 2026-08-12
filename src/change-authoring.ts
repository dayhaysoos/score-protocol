import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { canonicalJson } from "./canonical.js";
import {
  prepareValidatedSliceDraft,
  type PrepareSliceResult
} from "./plan-intake.js";
import { ScoreAlpha } from "./score-alpha.js";
import {
  CHANGE_DRAFT_SCHEMA,
  CHANGE_ID_PATTERN,
  validateChangeDraftShape,
  type ChangeDraft
} from "./change-draft.js";
import type { SliceDraft, SliceFinding } from "./slice-draft.js";

export type { ChangeDraft } from "./change-draft.js";
export { CHANGE_DRAFT_SCHEMA } from "./change-draft.js";

export interface ChangeTarget {
  readonly path: string;
  readonly operation: "create" | "modify";
}

export type PrepareChangeResult =
  | {
      readonly status: "invalid";
      readonly changeId?: string;
      readonly findings: ReadonlyArray<SliceFinding>;
    }
  | {
      readonly status: "review_ready";
      readonly changeId: string;
      readonly title: string;
      readonly revision: number;
      readonly passId: string;
      readonly targets: ReadonlyArray<ChangeTarget>;
      readonly reviewPath: string;
      readonly snapshotPath: string;
      readonly humanApprovalRequired: true;
      readonly nextAction: Extract<PrepareSliceResult, { readonly status: "review_ready" }>["nextAction"];
    };

function internalSliceId(changeId: string): string {
  return changeId;
}

function changeFinding(finding: SliceFinding): SliceFinding {
  return {
    ...finding,
    code: finding.code.startsWith("SLICE_")
      ? `CHANGE_${finding.code.slice("SLICE_".length)}`
      : finding.code,
    message: finding.message
      .replace(/\bSlice Draft\b/gu, "Change")
      .replace(/\bslice\b/giu, "Change")
  };
}

function knownChangeId(projectRoot: string, changeId: string): boolean {
  const databasePath = join(projectRoot, ".score", "score.db");
  if (!existsSync(databasePath)) return false;
  return ScoreAlpha.listPreparedSliceHeads(databasePath).some(
    (head) => head.sliceId === internalSliceId(changeId)
  );
}

function comparableSemanticBody(value: unknown): unknown | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Readonly<Record<string, unknown>>;
  if (!Array.isArray(record.requirements) || !Array.isArray(record.files)) return undefined;
  const requirements = record.requirements.map((requirement) => {
    if (typeof requirement !== "object" || requirement === null || Array.isArray(requirement)) {
      return undefined;
    }
    const statement = (requirement as Readonly<Record<string, unknown>>).statement;
    return typeof statement === "string" ? statement : undefined;
  });
  if (
    typeof record.title !== "string" ||
    typeof record.objective !== "string" ||
    requirements.some((requirement) => requirement === undefined)
  ) {
    return undefined;
  }
  return {
    title: record.title,
    objective: record.objective,
    requirements,
    files: record.files
  };
}

function unpublishedChangeId(projectRoot: string, draft: ChangeDraft): string | undefined {
  const databasePath = join(projectRoot, ".score", "score.db");
  if (!existsSync(databasePath)) return undefined;
  const requestedBody = canonicalJson({
    title: draft.title,
    objective: draft.objective,
    requirements: draft.requirements,
    files: draft.files
  });
  const changeIdPattern = new RegExp(CHANGE_ID_PATTERN, "u");
  const matches = ScoreAlpha.listPreparedSliceHeads(databasePath).filter((head) => {
    if (head.published || !changeIdPattern.test(head.sliceId)) return false;
    const storedBody = comparableSemanticBody(head.acceptedSpecification);
    return storedBody !== undefined && canonicalJson(storedBody) === requestedBody;
  });
  return matches.length === 1 ? matches[0]?.sliceId : undefined;
}

function unknownChangeId(changeId: string): PrepareChangeResult {
  return {
    status: "invalid",
    findings: [
      {
        code: "CHANGE_ID_UNKNOWN",
        location: "/change_id",
        message:
          "change_id must be omitted for a new Change or match an id previously returned by SCORE",
        detail: { change_id: changeId },
        machineRepairable: false
      }
    ]
  };
}

function incompletePublication(changeId: string): PrepareChangeResult {
  return {
    status: "invalid",
    changeId,
    findings: [
      {
        code: "CHANGE_REVIEW_PUBLICATION_INCOMPLETE",
        location: "/",
        message:
          "SCORE retained the Change identity but could not publish its complete HTML review pair; resubmit the complete document with the returned changeId as change_id",
        detail: { change_id: changeId },
        machineRepairable: true
      }
    ]
  };
}

function mappedSliceDraft(changeId: string, draft: ChangeDraft): SliceDraft {
  return {
    slice_id: internalSliceId(changeId),
    title: draft.title,
    objective: draft.objective,
    requirements: draft.requirements,
    files: draft.files
  };
}

function preparedResult(
  changeId: string,
  draft: ChangeDraft,
  result: PrepareSliceResult
): PrepareChangeResult {
  if (result.status === "invalid") {
    return { status: "invalid", findings: result.findings.map(changeFinding) };
  }
  return {
    status: "review_ready",
    changeId,
    title: result.title,
    revision: result.revision,
    passId: result.passId,
    targets: draft.files.map(({ path, operation }) => ({ path, operation })),
    reviewPath: result.reviewPath,
    snapshotPath: result.snapshotPath,
    humanApprovalRequired: true,
    nextAction: result.nextAction
  };
}

/**
 * Prepare one agent-authored Change against the exact project root.
 *
 * This creates immutable review artifacts only. It never approves, executes,
 * generates candidates, or applies source changes.
 */
export function prepareChange(input: {
  readonly projectRoot: string;
  readonly changeDraft: unknown;
}): PrepareChangeResult {
  const findings = validateChangeDraftShape(input.changeDraft);
  if (findings.length > 0) return { status: "invalid", findings };

  const draft = input.changeDraft as ChangeDraft;
  const suppliedChangeId = draft.change_id;
  if (
    suppliedChangeId !== undefined &&
    !knownChangeId(input.projectRoot, suppliedChangeId)
  ) {
    return unknownChangeId(suppliedChangeId);
  }

  const changeId =
    suppliedChangeId ??
    unpublishedChangeId(input.projectRoot, draft) ??
    `chg_${randomUUID()}`;
  try {
    return preparedResult(
      changeId,
      draft,
      prepareValidatedSliceDraft({
        projectRoot: input.projectRoot,
        sliceDraft: mappedSliceDraft(changeId, draft),
        reviewKind: "change"
      })
    );
  } catch (cause) {
    if (knownChangeId(input.projectRoot, changeId)) {
      return incompletePublication(changeId);
    }
    throw cause;
  }
}
