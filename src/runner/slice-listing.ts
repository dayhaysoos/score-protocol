import { existsSync } from "node:fs";

import Database from "better-sqlite3";

import { ScoreAlpha, type ReviewedChangePlan } from "../score-alpha.js";
import { terminalSafeLine } from "./terminal-safe-line.js";

export type SliceRunStatus =
  | { readonly marker: "○"; readonly state: "ready"; readonly detail: string }
  | { readonly marker: "…"; readonly state: "active"; readonly detail: string }
  | { readonly marker: "!"; readonly state: "failed"; readonly detail: string }
  | { readonly marker: "✓"; readonly state: "implemented"; readonly detail: string };

export interface ListedReviewedSlice extends ReviewedChangePlan {
  readonly runStatus: SliceRunStatus;
}

interface SliceRevisionIdentity {
  readonly sliceId: string;
  readonly revision: number;
  readonly passId: string;
}

interface RunHistoryRow {
  readonly passId: string;
  readonly state: "pending" | "running" | "completed" | "completed_with_failures";
  readonly applicationState: "not_applied" | "applying" | "applied" | "apply_failed";
  readonly createdAt: string;
  readonly rowOrder: number;
}

function readRevisionIdentities(
  scoreDatabasePath: string,
  plans: ReadonlyArray<ReviewedChangePlan>
): ReadonlyArray<SliceRevisionIdentity> {
  const database = new Database(scoreDatabasePath, { readonly: true, fileMustExist: true });
  try {
    const sliceColumns = database.prepare("PRAGMA table_info(prepared_slices)").all() as Array<{
      name: string;
    }>;
    const sliceIdExpression = sliceColumns.some((column) => column.name === "slice_id")
      ? "slice.slice_id"
      : "slice.slug";
    const prepared = database
      .prepare(
        `SELECT ${sliceIdExpression} AS sliceId, revision.revision,
                pass.pass_id AS passId
         FROM prepared_slice_revisions revision
         JOIN prepared_slices slice ON slice.title = revision.title
         JOIN prepared_slice_publications publication
           ON publication.title = revision.title
          AND publication.revision = revision.revision
          AND publication.review_id = revision.review_id
         JOIN coding_passes pass ON pass.manifest_id = revision.manifest_id
         ORDER BY sliceId, revision.revision`
      )
      .all() as Array<{ sliceId: string; revision: number; passId: string }>;
    const preparedPassIds = new Set(prepared.map((revision) => revision.passId));
    return [
      ...prepared,
      ...plans
        .filter((plan) => !preparedPassIds.has(plan.passId))
        .map((plan) => ({
          sliceId: plan.sliceId,
          revision: plan.revision,
          passId: plan.passId
        }))
    ];
  } finally {
    database.close();
  }
}

function readRunHistory(runnerDatabasePath: string): ReadonlyArray<RunHistoryRow> {
  if (!existsSync(runnerDatabasePath)) return [];
  const database = new Database(runnerDatabasePath, { readonly: true, fileMustExist: true });
  try {
    const table = database
      .prepare(
        `SELECT 1 AS present
         FROM sqlite_master
         WHERE type = 'table' AND name = 'runner_runs'`
      )
      .get() as { present: number } | undefined;
    if (!table) return [];
    const columns = database.prepare("PRAGMA table_info(runner_runs)").all() as Array<{
      name: string;
    }>;
    const applicationState = columns.some((column) => column.name === "application_state")
      ? "application_state"
      : "'not_applied'";
    return database
      .prepare(
        `SELECT approved_pass_id AS passId, state,
                ${applicationState} AS applicationState,
                created_at AS createdAt, rowid AS rowOrder
         FROM runner_runs
         ORDER BY created_at DESC, rowid DESC`
      )
      .all() as RunHistoryRow[];
  } finally {
    database.close();
  }
}

function olderImplementedSuffix(revision: number | undefined): string {
  return revision === undefined ? "" : ` · v${revision} implemented`;
}

function deriveStatus(input: {
  readonly plan: ReviewedChangePlan;
  readonly currentRuns: ReadonlyArray<RunHistoryRow>;
  readonly olderImplementedRevision?: number;
}): SliceRunStatus {
  const latest = input.currentRuns[0];
  const olderSuffix = olderImplementedSuffix(input.olderImplementedRevision);
  if (
    latest &&
    (latest.state === "pending" ||
      latest.state === "running" ||
      latest.applicationState === "applying")
  ) {
    return { marker: "…", state: "active", detail: `Running${olderSuffix}` };
  }
  if (
    latest?.state === "completed" && latest.applicationState === "applied"
  ) {
    return {
      marker: "✓",
      state: "implemented",
      detail:
        input.plan.revisionCount > 1
          ? `Implemented · ${input.plan.revisionCount} revisions`
          : "Implemented"
    };
  }
  if (latest) {
    const currentRevisionWasImplemented = input.currentRuns
      .slice(1)
      .some((run) => run.state === "completed" && run.applicationState === "applied");
    return {
      marker: "!",
      state: "failed",
      detail: currentRevisionWasImplemented
        ? `Needs attention · v${input.plan.revision} previously implemented`
        : `Needs attention${olderSuffix}`
    };
  }
  return { marker: "○", state: "ready", detail: `Ready${olderSuffix}` };
}

export function listReviewedSlices(input: {
  readonly scoreDatabasePath: string;
  readonly runnerDatabasePath: string;
}): ReadonlyArray<ListedReviewedSlice> {
  const plans = ScoreAlpha.listReviewedChangePlans(input.scoreDatabasePath);
  const revisions = readRevisionIdentities(input.scoreDatabasePath, plans);
  const runs = readRunHistory(input.runnerDatabasePath);
  const runsByPassId = Map.groupBy(runs, (run) => run.passId);
  return plans.map((plan) => {
    const sliceRevisions = revisions.filter((revision) => revision.sliceId === plan.sliceId);
    const olderImplementedRevision = sliceRevisions
      .filter((revision) => revision.revision < plan.revision)
      .filter((revision) =>
        (runsByPassId.get(revision.passId) ?? []).some(
          (run) => run.state === "completed" && run.applicationState === "applied"
        )
      )
      .map((revision) => revision.revision)
      .sort((left, right) => right - left)[0];
    return {
      ...plan,
      runStatus: deriveStatus({
        plan,
        currentRuns: runsByPassId.get(plan.passId) ?? [],
        ...(olderImplementedRevision === undefined ? {} : { olderImplementedRevision })
      })
    };
  });
}

export function formatReviewedSlice(slice: ListedReviewedSlice): string {
  const label = terminalSafeLine(slice.label);
  const detail = terminalSafeLine(slice.runStatus.detail);
  return terminalSafeLine(
    `${slice.runStatus.marker} ${label || "[unprintable Change or Slice]"}    ${detail}`
  );
}
