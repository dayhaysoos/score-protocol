import { existsSync } from "node:fs";

import Database from "better-sqlite3";

export interface AppliedRun {
  readonly runId: string;
  readonly passId: string;
  readonly appliedAt: string | null;
  readonly createdAt: string;
}

export function readLatestAppliedRuns(
  runnerDatabasePath: string
): ReadonlyMap<string, AppliedRun> {
  if (!existsSync(runnerDatabasePath)) return new Map();
  const database = new Database(runnerDatabasePath, {
    readonly: true,
    fileMustExist: true
  });
  try {
    const table = database
      .prepare(
        `SELECT 1 AS present
         FROM sqlite_master
         WHERE type = 'table' AND name = 'runner_runs'`
      )
      .get() as { present: number } | undefined;
    if (!table) return new Map();
    const columns = database.prepare("PRAGMA table_info(runner_runs)").all() as Array<{
      name: string;
    }>;
    if (!columns.some((column) => column.name === "application_state")) {
      return new Map();
    }
    const hasAppliedAt = columns.some((column) => column.name === "applied_at");
    const rows = database
      .prepare(
        `SELECT run_id AS runId, approved_pass_id AS passId,
                ${hasAppliedAt ? "applied_at" : "NULL"} AS appliedAt,
                created_at AS createdAt
         FROM runner_runs
         WHERE state = 'completed' AND application_state = 'applied'
         ORDER BY COALESCE(${hasAppliedAt ? "applied_at" : "created_at"}, created_at) DESC,
                  created_at DESC, rowid DESC`
      )
      .all() as AppliedRun[];
    const latest = new Map<string, AppliedRun>();
    for (const run of rows) {
      if (!latest.has(run.passId)) latest.set(run.passId, run);
    }
    return latest;
  } finally {
    database.close();
  }
}
