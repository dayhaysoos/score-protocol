import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import Database from "better-sqlite3";

import { prepareSlice, type SliceDraft } from "../src/plan-intake.js";
import { formatReviewedSlice, listReviewedSlices } from "../src/runner/slice-listing.js";

function write(root: string, path: string, content: string): void {
  const target = join(root, path);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, content, "utf8");
}

function createProject(): string {
  const root = mkdtempSync(join(tmpdir(), "score-slice-listing-"));
  write(root, "package.json", '{"type":"module"}\n');
  write(
    root,
    "tsconfig.json",
    '{"compilerOptions":{"module":"NodeNext","moduleResolution":"NodeNext","target":"ES2024","strict":true,"skipLibCheck":true,"types":[]},"include":["src/**/*.ts"]}\n'
  );
  write(root, "src/schema.ts", "export interface Account { id: string; }\n");
  return root;
}

function draft(objective: string): SliceDraft {
  return {
    slice_id: "account-service",
    title: "Account Service",
    objective,
    requirements: ["Account has a status."],
    files: [
      {
        path: "src/schema.ts",
        operation: "modify",
        task: "Add status to Account.",
        requirements: ["Account has a status."],
        owns: [
          {
            name: "Account",
            declaration:
              'export interface Account { id: string; status: "active" | "suspended"; }',
            description: "Represents an account with its current status."
          }
        ],
        consumes: [],
        context: [],
        skills: [],
        constraints: []
      }
    ]
  };
}

function createRunnerDatabase(path: string): Database.Database {
  const db = new Database(path);
  db.exec(`CREATE TABLE runner_runs (
    run_id TEXT PRIMARY KEY,
    approved_pass_id TEXT NOT NULL,
    state TEXT NOT NULL,
    application_state TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT`);
  return db;
}

function insertRun(
  db: Database.Database,
  input: {
    runId: string;
    passId: string;
    state: "pending" | "running" | "completed" | "completed_with_failures";
    applicationState: "not_applied" | "applying" | "applied" | "apply_failed";
    createdAt: string;
  }
): void {
  db.prepare(
    `INSERT INTO runner_runs
     (run_id, approved_pass_id, state, application_state, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(input.runId, input.passId, input.state, input.applicationState, input.createdAt);
}

describe("reviewed slice listing", () => {
  it("renders reviewed labels as one bounded terminal-safe row", () => {
    const rendered = formatReviewedSlice({
      label:
        "Trusted\nFORGED C0\u0000\u001b]2;FORGED OSC\u0007\u009b2JFORGED C1\u202eFORGED BIDI",
      runStatus: { marker: "○", state: "ready", detail: "Ready" }
    } as Parameters<typeof formatReviewedSlice>[0]);

    assert.equal(rendered, "○ Trusted FORGED C0 FORGED C1 FORGED BIDI Ready");
    assert.equal(rendered.split("\n").length, 1);
    assert.doesNotMatch(rendered, /[\u0000-\u001f\u007f-\u009f]|\p{Cf}/u);
    assert.doesNotMatch(rendered, /FORGED OSC/u);
  });

  it("reads pre-application Runner history before its schema is migrated", () => {
    const projectRoot = createProject();
    const scoreDatabasePath = join(projectRoot, ".score", "score.db");
    const runnerDatabasePath = join(projectRoot, ".score", "legacy-runner.db");
    try {
      prepareSlice({ projectRoot, sliceDraft: draft("Add account status.") });
      const plan = listReviewedSlices({ scoreDatabasePath, runnerDatabasePath })[0];
      assert.ok(plan);
      const runner = new Database(runnerDatabasePath);
      try {
        runner.exec(`CREATE TABLE runner_runs (
          run_id TEXT PRIMARY KEY,
          approved_pass_id TEXT NOT NULL,
          state TEXT NOT NULL,
          created_at TEXT NOT NULL
        ) STRICT`);
        runner
          .prepare(
            `INSERT INTO runner_runs (run_id, approved_pass_id, state, created_at)
             VALUES (?, ?, ?, ?)`
          )
          .run("legacy-completed", plan.passId, "completed", "2026-08-07T09:00:00.000Z");
      } finally {
        runner.close();
      }

      assert.deepEqual(
        listReviewedSlices({ scoreDatabasePath, runnerDatabasePath })[0]?.runStatus,
        { marker: "!", state: "failed", detail: "Needs attention" }
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("derives latest-revision status and preserves older implemented revision context", () => {
    const projectRoot = createProject();
    const scoreDatabasePath = join(projectRoot, ".score", "score.db");
    const runnerDatabasePath = join(projectRoot, ".score", "runner.db");
    try {
      prepareSlice({ projectRoot, sliceDraft: draft("Add account status.") });
      const v1 = listReviewedSlices({ scoreDatabasePath, runnerDatabasePath })[0];
      assert.ok(v1);
      const runner = createRunnerDatabase(runnerDatabasePath);
      try {
        insertRun(runner, {
          runId: "v1-applied",
          passId: v1.passId,
          state: "completed",
          applicationState: "applied",
          createdAt: "2026-08-07T10:00:00.000Z"
        });
        prepareSlice({
          projectRoot,
          sliceDraft: draft("Add account status with a reviewed wording revision.")
        });

        const ready = listReviewedSlices({ scoreDatabasePath, runnerDatabasePath })[0];
        assert.ok(ready);
        assert.equal(ready.label, "Account Service v2");
        assert.deepEqual(ready.runStatus, {
          marker: "○",
          state: "ready",
          detail: "Ready · v1 implemented"
        });

        insertRun(runner, {
          runId: "v2-active",
          passId: ready.passId,
          state: "running",
          applicationState: "not_applied",
          createdAt: "2026-08-07T11:00:00.000Z"
        });
        assert.deepEqual(
          listReviewedSlices({ scoreDatabasePath, runnerDatabasePath })[0]?.runStatus,
          { marker: "…", state: "active", detail: "Running · v1 implemented" }
        );

        runner
          .prepare(
            `UPDATE runner_runs
             SET state = 'completed_with_failures'
             WHERE run_id = 'v2-active'`
          )
          .run();
        assert.deepEqual(
          listReviewedSlices({ scoreDatabasePath, runnerDatabasePath })[0]?.runStatus,
          { marker: "!", state: "failed", detail: "Needs attention · v1 implemented" }
        );

        runner
          .prepare(
            `UPDATE runner_runs
             SET state = 'completed', application_state = 'applied'
             WHERE run_id = 'v2-active'`
          )
          .run();
        assert.deepEqual(
          listReviewedSlices({ scoreDatabasePath, runnerDatabasePath })[0]?.runStatus,
          { marker: "✓", state: "implemented", detail: "Implemented · 2 revisions" }
        );

        insertRun(runner, {
          runId: "v2-later-failure",
          passId: ready.passId,
          state: "completed_with_failures",
          applicationState: "not_applied",
          createdAt: "2026-08-07T12:00:00.000Z"
        });
        assert.deepEqual(
          listReviewedSlices({ scoreDatabasePath, runnerDatabasePath })[0]?.runStatus,
          {
            marker: "!",
            state: "failed",
            detail: "Needs attention · v2 previously implemented"
          }
        );
      } finally {
        runner.close();
      }
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
