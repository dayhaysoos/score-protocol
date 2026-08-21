import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { Effect } from "effect";

import {
  prepareChange,
  type ChangeDraft
} from "../src/change-authoring.js";
import { ScoreAlpha } from "../src/score-alpha.js";
import {
  enqueueApprovedPlan,
  inspectRun,
  inspectRunner
} from "../src/runner/runner.js";
import { listReviewedSlices } from "../src/runner/slice-listing.js";

const requirements = [
  "Account exposes an active or suspended status.",
  "formatAccountLabel returns the account id and status."
] as const;

function writeProjectFile(root: string, path: string, content: string): void {
  const absolutePath = join(root, path);
  mkdirSync(join(absolutePath, ".."), { recursive: true });
  writeFileSync(absolutePath, content, "utf8");
}

function createProject(): string {
  const root = mkdtempSync(join(tmpdir(), "score-change-runner-integration-"));
  writeProjectFile(root, "README.md", "# Account project\n");
  writeProjectFile(root, "docs/account.md", "Account labels include status.\n");
  writeProjectFile(root, "package.json", '{"type":"module"}\n');
  writeProjectFile(
    root,
    "src/account.ts",
    "export interface Account {\n  id: string;\n}\n"
  );
  return realpathSync(root);
}

function changeDraft(objective: string): ChangeDraft {
  return {
    title: "Account status",
    objective,
    requirements: [...requirements],
    files: [
      {
        path: "src/account.ts",
        operation: "modify",
        task: "Add the required status field to Account.",
        requirements: [requirements[0]],
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
        constraints: ["Keep Account exported."]
      },
      {
        path: "src/format-account.ts",
        operation: "create",
        task: "Create a pure account label formatter.",
        requirements: [requirements[1]],
        owns: [
          {
            name: "formatAccountLabel",
            declaration: "export function formatAccountLabel(account: Account): string;",
            description: "Returns the account id and status as a label."
          }
        ],
        consumes: [
          {
            name: "Account",
            from: "src/account.ts",
            module_specifier: "./account.js"
          }
        ],
        context: [
          {
            path: "README.md",
            purpose: "Defines the human-facing account label expectation."
          },
          {
            path: "docs/account.md",
            purpose: "Defines the lowercase-path account label expectation."
          }
        ],
        skills: [],
        constraints: ["Return a string without side effects."]
      }
    ]
  };
}

describe("Change to Runner integration", () => {
  it("selects, approves, and enqueues only the latest immutable multi-file revision", async () => {
    const projectRoot = createProject();
    const scoreDatabasePath = join(projectRoot, ".score", "score.db");
    const runnerDatabasePath = join(projectRoot, ".score", "runner-integration.db");
    const originalAccount = readFileSync(join(projectRoot, "src/account.ts"), "utf8");
    try {
      const initial = prepareChange({
        projectRoot,
        changeDraft: changeDraft("Add account status and a pure account label formatter.")
      });
      assert.equal(initial.status, "review_ready");
      if (initial.status !== "review_ready") return;
      const initialReview = readFileSync(initial.reviewPath, "utf8");
      const initialSnapshot = readFileSync(initial.snapshotPath, "utf8");

      const revised = prepareChange({
        projectRoot,
        changeDraft: {
          ...changeDraft(
            "Add account status and a pure account label formatter with revised reviewed wording."
          ),
          change_id: initial.changeId
        }
      });
      assert.equal(revised.status, "review_ready");
      if (revised.status !== "review_ready") return;
      assert.equal(revised.revision, 2);
      assert.notEqual(revised.passId, initial.passId);
      assert.equal(readFileSync(initial.reviewPath, "utf8"), initialReview);
      assert.equal(readFileSync(initial.snapshotPath, "utf8"), initialSnapshot);
      assert.ok(existsSync(initial.reviewPath));
      assert.ok(existsSync(initial.snapshotPath));

      const expectedFiles = ["src/account.ts", "src/format-account.ts"];
      const reviewedPlans = ScoreAlpha.listReviewedChangePlans(scoreDatabasePath);
      assert.equal(reviewedPlans.length, 1);
      assert.deepEqual(
        reviewedPlans.map((plan) => ({
          passId: plan.passId,
          revision: plan.revision,
          files: plan.files,
          approvalStatus: plan.approvalStatus
        })),
        [
          {
            passId: revised.passId,
            revision: 2,
            files: expectedFiles,
            approvalStatus: "needs_approval"
          }
        ]
      );
      assert.equal(
        reviewedPlans.some((plan) => plan.passId === initial.passId),
        false
      );

      const selectable = listReviewedSlices({
        scoreDatabasePath,
        runnerDatabasePath
      });
      assert.equal(selectable.length, 1);
      assert.deepEqual(
        selectable.map((plan) => ({
          passId: plan.passId,
          revision: plan.revision,
          files: plan.files,
          runStatus: plan.runStatus
        })),
        [
          {
            passId: revised.passId,
            revision: 2,
            files: expectedFiles,
            runStatus: { marker: "○", state: "ready", detail: "Ready" }
          }
        ]
      );

      const latest = reviewedPlans[0];
      assert.ok(latest);
      const approval = spawnSync(
        join(process.cwd(), "node_modules", ".bin", "tsx"),
        [
          join(process.cwd(), "src", "cli.ts"),
          "approve",
          "--pass",
          latest.passId,
          "--score-db",
          scoreDatabasePath
        ],
        { cwd: projectRoot, encoding: "utf8", timeout: 10_000 }
      );
      assert.equal(approval.status, 0, approval.stderr);
      assert.equal(approval.stderr, "");
      assert.equal(typeof JSON.parse(approval.stdout).decision_id, "string");

      const enqueued = await Effect.runPromise(
        enqueueApprovedPlan({
          scoreDatabasePath,
          runnerDatabasePath,
          passId: revised.passId,
          repositoryRoot: projectRoot,
          adapter: {
            kind: "opencode",
            providerId: "test-provider",
            modelId: "test-model",
            variantId: null,
            sdkVersion: "0.0.0-next-17111",
            cliVersion: "0.0.0-next-17111"
          },
          maxConcurrency: 2
        })
      );

      assert.deepEqual(
        {
          passId: enqueued.passId,
          jobCount: enqueued.jobCount
        },
        {
          passId: revised.passId,
          jobCount: 2
        }
      );
      assert.deepEqual(await Effect.runPromise(inspectRunner(runnerDatabasePath)), {
        runs: 1,
        jobs: 2,
        attempts: 0
      });

      const run = await Effect.runPromise(inspectRun(runnerDatabasePath, enqueued.runId));
      assert.deepEqual(
        {
          passId: run.passId,
          state: run.state,
          applicationState: run.applicationState,
          jobs: run.jobs.map((job) => ({
            targetPath: job.targetPath,
            operation: job.operation,
            state: job.state
          }))
        },
        {
          passId: revised.passId,
          state: "pending",
          applicationState: "not_applied",
          jobs: [
            {
              targetPath: "src/account.ts",
              operation: "replace",
              state: "pending"
            },
            {
              targetPath: "src/format-account.ts",
              operation: "create",
              state: "pending"
            }
          ]
        }
      );
      assert.equal(readFileSync(join(projectRoot, "src/account.ts"), "utf8"), originalAccount);
      assert.equal(existsSync(join(projectRoot, "src/format-account.ts")), false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
