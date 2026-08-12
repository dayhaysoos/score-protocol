import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync
} from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import type { SliceDraft } from "../src/plan-intake.js";
import { ScoreAlpha } from "../src/score-alpha.js";

const DEMO_ROOT = join(process.cwd(), "examples", "score-five-file-demo");

describe("five-file SCORE demo", () => {
  it("ships a compiling dependency chain and a review-ready five-file slice", () => {
    execFileSync(join(process.cwd(), "node_modules", ".bin", "tsc"), [
      "-p",
      join(DEMO_ROOT, "tsconfig.json"),
      "--noEmit"
    ]);

    const projectRoot = mkdtempSync(
      join(process.cwd(), "examples", ".score-five-file-demo-test-")
    );
    try {
      cpSync(DEMO_ROOT, projectRoot, { recursive: true });
      rmSync(join(projectRoot, ".score"), { recursive: true, force: true });
      const draft = JSON.parse(
        readFileSync(
          join(projectRoot, "score", "slices", "task-board-status-report.json"),
          "utf8"
        )
      ) as SliceDraft;
      const originalTargets = new Map(
        draft.files.map((file) => [
          file.path,
          readFileSync(join(projectRoot, file.path), "utf8")
        ])
      );
      const packageJson = JSON.parse(
        readFileSync(join(projectRoot, "package.json"), "utf8")
      ) as { scripts: Record<string, string> };
      assert.equal(
        packageJson.scripts["score:start"],
        "../../node_modules/.bin/tsx ../../src/runner/cli.ts start --score-db .score/score.db"
      );

      const preparation = execFileSync("npm", ["run", "score:prepare"], {
        cwd: projectRoot,
        encoding: "utf8"
      });

      assert.match(preparation, /Task board status report v1 · review ready/);
      assert.match(
        readFileSync(
          join(
            projectRoot,
            ".score",
            "reviews",
            "task-board-status-report-review.html"
          ),
          "utf8"
        ),
        /Task board status report/
      );
      const [plan] = ScoreAlpha.listReviewedChangePlans(
        join(projectRoot, ".score", "score.db")
      );
      assert.ok(plan);
      assert.deepEqual(plan.files, [
        "src/format-task.ts",
        "src/index.ts",
        "src/priority.ts",
        "src/task-list.ts",
        "src/task.ts"
      ]);
      for (const [path, content] of originalTargets) {
        assert.equal(readFileSync(join(projectRoot, path), "utf8"), content);
      }
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
