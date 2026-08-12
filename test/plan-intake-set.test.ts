import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import Database from "better-sqlite3";

import { prepareSliceSet, type SlicePreparationState } from "../src/plan-intake-set.js";
import { ScoreAlpha } from "../src/score-alpha.js";
import type { SliceDraft } from "../src/slice-draft.js";

function write(root: string, path: string, content: string): void {
  const target = join(root, path);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, content, "utf8");
}

function writeJson(root: string, path: string, value: unknown): void {
  write(root, path, `${JSON.stringify(value, null, 2)}\n`);
}

function createProject(): string {
  const root = mkdtempSync(join(tmpdir(), "score-slice-set-"));
  write(root, "package.json", '{"type":"module"}\n');
  write(
    root,
    "tsconfig.json",
    '{"compilerOptions":{"module":"NodeNext","moduleResolution":"NodeNext","target":"ES2024","strict":true,"skipLibCheck":true,"types":[]},"include":["src/**/*.ts"]}\n'
  );
  write(root, "src/value.ts", "export const value = 0;\n");
  return root;
}

function draft(input: {
  readonly sliceId: string;
  readonly title: string;
  readonly outcome: string;
  readonly after?: ReadonlyArray<string>;
}): SliceDraft {
  const requirement = `The value module ${input.outcome}.`;
  return {
    slice_id: input.sliceId,
    ...(input.after === undefined ? {} : { after: input.after }),
    title: input.title,
    objective: requirement,
    requirements: [requirement],
    files: [
      {
        path: "src/value.ts",
        operation: "modify",
        task: requirement,
        requirements: [requirement],
        owns: [],
        consumes: [],
        context: [],
        skills: [],
        constraints: []
      }
    ]
  };
}

function createRunnerDatabase(path: string): Database.Database {
  const database = new Database(path);
  database.exec(`CREATE TABLE runner_runs (
    run_id TEXT PRIMARY KEY,
    approved_pass_id TEXT NOT NULL,
    state TEXT NOT NULL,
    application_state TEXT NOT NULL,
    applied_at TEXT,
    created_at TEXT NOT NULL
  ) STRICT`);
  return database;
}

function recordAppliedRun(
  database: Database.Database,
  input: { readonly runId: string; readonly passId: string; readonly at: string }
): void {
  database
    .prepare(
      `INSERT INTO runner_runs
       (run_id, approved_pass_id, state, application_state, applied_at, created_at)
       VALUES (?, ?, 'completed', 'applied', ?, ?)`
    )
    .run(input.runId, input.passId, input.at, input.at);
}

function state(
  slices: ReadonlyArray<SlicePreparationState>,
  sliceId: string
): SlicePreparationState {
  const result = slices.find((slice) => slice.sliceId === sliceId);
  assert.ok(result, `Missing slice state for ${sliceId}`);
  return result;
}

function targetContent(snapshotPath: string): string | undefined {
  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as {
    passes: Array<{
      capsules: Array<{ agent_input: { target: { content?: string } } }>;
    }>;
  };
  return snapshot.passes[0]?.capsules[0]?.agent_input.target.content;
}

describe("multi-slice Plan Intake", () => {
  it("revises editable drafts and prepares same-file slices only after exact predecessors apply", () => {
    const projectRoot = createProject();
    const slicesDirectory = join(projectRoot, "score", "slices");
    const runnerDatabasePath = join(projectRoot, "runner.db");
    const runner = createRunnerDatabase(runnerDatabasePath);
    try {
      writeJson(
        projectRoot,
        "score/slices/foundation.json",
        draft({
          sliceId: "foundation",
          title: "Foundation",
          outcome: "exports value 1"
        })
      );
      writeJson(
        projectRoot,
        "score/slices/increment.json",
        draft({
          sliceId: "increment",
          title: "Increment",
          outcome: "exports value 2",
          after: ["foundation"]
        })
      );
      writeJson(
        projectRoot,
        "score/slices/label.json",
        draft({
          sliceId: "label",
          title: "Label",
          outcome: "also exports a label",
          after: ["increment"]
        })
      );

      const first = prepareSliceSet({ projectRoot, slicesDirectory, runnerDatabasePath });
      assert.equal(first.status, "ready");
      if (first.status !== "ready") return;
      const foundationV1 = state(first.slices, "foundation");
      assert.equal(foundationV1.state, "review_ready");
      if (foundationV1.state !== "review_ready") return;
      assert.deepEqual(foundationV1.nextAction, {
        command: "score start",
        condition: "after_review"
      });
      assert.deepEqual(state(first.slices, "increment"), {
        state: "waiting",
        sliceId: "increment",
        title: "Increment",
        waitingFor: ["foundation"]
      });
      assert.equal(state(first.slices, "label").state, "waiting");

      writeJson(
        projectRoot,
        "score/slices/foundation.json",
        draft({
          sliceId: "foundation",
          title: "Foundation wording revised",
          outcome: "exports the accepted value 1"
        })
      );
      const revised = prepareSliceSet({ projectRoot, slicesDirectory, runnerDatabasePath });
      assert.equal(revised.status, "ready");
      if (revised.status !== "ready") return;
      const foundationV2 = state(revised.slices, "foundation");
      assert.equal(foundationV2.state, "review_ready");
      if (foundationV2.state !== "review_ready") return;
      assert.equal(foundationV2.revision, 2);
      assert.equal(foundationV2.title, "Foundation wording revised");

      recordAppliedRun(runner, {
        runId: "foundation-v2-run",
        passId: foundationV2.passId,
        at: "2026-08-09T20:00:00.000Z"
      });
      write(projectRoot, "src/value.ts", "export const value = 1;\n");

      const second = prepareSliceSet({ projectRoot, slicesDirectory, runnerDatabasePath });
      assert.equal(second.status, "ready");
      if (second.status !== "ready") return;
      assert.equal(state(second.slices, "foundation").state, "implemented");
      const increment = state(second.slices, "increment");
      assert.equal(increment.state, "review_ready");
      if (increment.state !== "review_ready") return;
      assert.equal(targetContent(increment.snapshotPath), "export const value = 1;\n");
      assert.equal(state(second.slices, "label").state, "waiting");

      const incrementHead = ScoreAlpha.listPreparedSliceHeads(
        join(projectRoot, ".score", "score.db")
      ).find((head) => head.sliceId === "increment");
      assert.deepEqual(incrementHead?.resolvedDependencies, [
        {
          slice_id: "foundation",
          revision: 2,
          pass_id: foundationV2.passId,
          run_id: "foundation-v2-run"
        }
      ]);

      recordAppliedRun(runner, {
        runId: "increment-v1-run",
        passId: increment.passId,
        at: "2026-08-09T21:00:00.000Z"
      });
      write(projectRoot, "src/value.ts", "export const value = 2;\n");

      const third = prepareSliceSet({ projectRoot, slicesDirectory, runnerDatabasePath });
      assert.equal(third.status, "ready");
      if (third.status !== "ready") return;
      assert.equal(state(third.slices, "increment").state, "implemented");
      const label = state(third.slices, "label");
      assert.equal(label.state, "review_ready");
      if (label.state !== "review_ready") return;
      assert.equal(targetContent(label.snapshotPath), "export const value = 2;\n");
      const labelHead = ScoreAlpha.listPreparedSliceHeads(
        join(projectRoot, ".score", "score.db")
      ).find((head) => head.sliceId === "label");
      assert.deepEqual(labelHead?.resolvedDependencies, [
        {
          slice_id: "increment",
          revision: 1,
          pass_id: increment.passId,
          run_id: "increment-v1-run"
        }
      ]);
    } finally {
      runner.close();
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("reports graph errors before preparing any review", () => {
    const projectRoot = createProject();
    const slicesDirectory = join(projectRoot, "score", "slices");
    try {
      writeJson(
        projectRoot,
        "score/slices/one.json",
        draft({ sliceId: "one", title: "One", outcome: "changes", after: ["two"] })
      );
      writeJson(
        projectRoot,
        "score/slices/two.json",
        draft({ sliceId: "two", title: "Two", outcome: "changes", after: ["one"] })
      );

      const result = prepareSliceSet({
        projectRoot,
        slicesDirectory,
        runnerDatabasePath: join(projectRoot, "missing-runner.db")
      });

      assert.equal(result.status, "invalid");
      if (result.status !== "invalid") return;
      assert.ok(result.findings.some((item) => item.code === "SLICE_DEPENDENCY_CYCLE"));
      assert.equal(readFileSync(join(projectRoot, "src/value.ts"), "utf8"), "export const value = 0;\n");
      assert.throws(() => readFileSync(join(projectRoot, ".score", "score.db")));
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("installs the local .score exclusion before preparing a slice set", () => {
    const projectRoot = createProject();
    const slicesDirectory = join(projectRoot, "score", "slices");
    execFileSync("git", ["init", "-q", projectRoot]);
    try {
      writeJson(
        projectRoot,
        "score/slices/one.json",
        draft({ sliceId: "one", title: "One", outcome: "changes" })
      );

      const result = prepareSliceSet({
        projectRoot,
        slicesDirectory,
        runnerDatabasePath: join(projectRoot, "missing-runner.db")
      });

      assert.equal(result.status, "ready");
      assert.match(
        readFileSync(join(projectRoot, ".git", "info", "exclude"), "utf8"),
        /^\/\.score\/$/mu
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("fails closed before creating slice-set state when Git exclusion is unavailable", () => {
    const projectRoot = createProject();
    const slicesDirectory = join(projectRoot, "score", "slices");
    mkdirSync(join(projectRoot, ".git"));
    try {
      writeJson(
        projectRoot,
        "score/slices/one.json",
        draft({ sliceId: "one", title: "One", outcome: "changes" })
      );

      const result = prepareSliceSet({
        projectRoot,
        slicesDirectory,
        runnerDatabasePath: join(projectRoot, "missing-runner.db")
      });

      assert.equal(result.status, "invalid");
      if (result.status !== "invalid") return;
      assert.ok(result.findings.some((item) => item.code === "GIT_EXCLUDE_UNAVAILABLE"));
      assert.equal(existsSync(join(projectRoot, ".score")), false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("refuses a project state symlink before preparing a slice set", () => {
    const projectRoot = createProject();
    const slicesDirectory = join(projectRoot, "score", "slices");
    const outsideDirectory = mkdtempSync(join(tmpdir(), "score-slice-set-outside-"));
    try {
      writeJson(
        projectRoot,
        "score/slices/one.json",
        draft({ sliceId: "one", title: "One", outcome: "changes" })
      );
      symlinkSync(outsideDirectory, join(projectRoot, ".score"), "dir");

      assert.throws(
        () =>
          prepareSliceSet({
            projectRoot,
            slicesDirectory,
            runnerDatabasePath: join(projectRoot, "missing-runner.db")
          }),
        /SCORE state directory.*symbolic link/i
      );
      assert.deepEqual(readdirSync(outsideDirectory), []);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(outsideDirectory, { recursive: true, force: true });
    }
  });

  it("refuses a Runner history database symlink before reading applied slices", () => {
    const projectRoot = createProject();
    const slicesDirectory = join(projectRoot, "score", "slices");
    const outsidePath = join(projectRoot, "outside-runner.db");
    writeFileSync(outsidePath, "outside bytes\n", "utf8");
    symlinkSync(outsidePath, join(projectRoot, "runner.db"), "file");
    try {
      writeJson(
        projectRoot,
        "score/slices/one.json",
        draft({ sliceId: "one", title: "One", outcome: "changes" })
      );

      assert.throws(
        () =>
          prepareSliceSet({
            projectRoot,
            slicesDirectory,
            runnerDatabasePath: join(projectRoot, "runner.db")
          }),
        /Runner database.*symbolic link/i
      );
      assert.equal(readFileSync(outsidePath, "utf8"), "outside bytes\n");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
