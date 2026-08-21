import assert from "node:assert/strict";
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

import { prepareChange, type ChangeDraft } from "../src/change-authoring.js";
import { ScoreAlpha } from "../src/score-alpha.js";

function writeProjectFile(root: string, path: string, content: string): void {
  const absolutePath = join(root, path);
  mkdirSync(join(absolutePath, ".."), { recursive: true });
  writeFileSync(absolutePath, content, "utf8");
}

function createProject(): string {
  const root = mkdtempSync(join(tmpdir(), "score-production-route-binding-"));
  writeProjectFile(
    root,
    "src/account.ts",
    "export interface Account { readonly id: string; }\n"
  );
  return realpathSync(root);
}

function routedChange(): ChangeDraft {
  return {
    title: "Account formatter",
    objective: "Add an Account name and format it from a second module.",
    requirements: [
      "Account exposes a name.",
      "formatAccount returns the Account name."
    ],
    files: [
      {
        path: "src/account.ts",
        operation: "modify",
        task: "Add the reviewed name field.",
        requirements: ["Account exposes a name."],
        owns: [
          {
            name: "Account",
            declaration:
              "export interface Account { readonly id: string; readonly name: string; }",
            description: "Represents an account with its display name."
          }
        ],
        consumes: [],
        context: [],
        skills: [],
        constraints: []
      },
      {
        path: "src/format-account.ts",
        operation: "create",
        task: "Import Account through the reviewed route and return its name.",
        requirements: ["formatAccount returns the Account name."],
        owns: [
          {
            name: "formatAccount",
            declaration: "export function formatAccount(account: Account): string;",
            description: "Returns the Account display name."
          }
        ],
        consumes: [
          {
            name: "Account",
            from: "src/account.ts",
            module_specifier: "./account.js"
          }
        ],
        context: [],
        skills: [],
        constraints: []
      }
    ]
  };
}

describe("production approved cross-file route binding", () => {
  it("carries one reviewed module specifier unchanged through approval export", () => {
    const projectRoot = createProject();
    const databasePath = join(projectRoot, ".score", "score.db");
    const originalOwner = readFileSync(join(projectRoot, "src/account.ts"), "utf8");
    try {
      const prepared = prepareChange({ projectRoot, changeDraft: routedChange() });
      assert.equal(prepared.status, "review_ready");
      if (prepared.status !== "review_ready") return;

      const snapshot = JSON.parse(readFileSync(prepared.snapshotPath, "utf8")) as {
        version: string;
        passes: Array<{
          capsules: Array<{
            target_path: string;
            agent_input: {
              declarations: { consumed: Array<Record<string, unknown>> };
            };
          }>;
        }>;
      };
      const expectedConsumption = {
        name: "Account",
        declaration:
          "export interface Account { readonly id: string; readonly name: string; }",
        description: "Represents an account with its display name.",
        owner_target: "src/account.ts",
        module_specifier: "./account.js"
      };
      const consumer = snapshot.passes
        .flatMap(({ capsules }) => capsules)
        .find(({ target_path }) => target_path === "src/format-account.ts");
      assert.ok(consumer);
      assert.equal(snapshot.version, "0.1.0-alpha.6");
      assert.deepEqual(consumer.agent_input.declarations.consumed, [expectedConsumption]);
      assert.match(readFileSync(prepared.reviewPath, "utf8"), /\.\/account\.js/u);

      const head = ScoreAlpha.listPreparedSliceHeads(databasePath).find(
        ({ passId }) => passId === prepared.passId
      );
      assert.ok(head);
      const score = ScoreAlpha.open(databasePath);
      try {
        const review = score.loadPreparedReview(head.manifestId);
        score.decidePublication({
          review_id: review.review_id,
          authority: "test-human-authority",
          decided_at: "2026-08-21T12:00:00.000Z",
          decision: "approve",
          expected_digest_set: review.digest_set,
          warning_waivers: [],
          rationale: "Approve the exact reviewed cross-file route fixture."
        });
        const approved = score.exportApprovedPass(prepared.passId);
        assert.equal(approved.version, "0.1.0-alpha.7");
        const approvedConsumer = approved.payloads.find(
          ({ target_path }) => target_path === "src/format-account.ts"
        );
        assert.ok(approvedConsumer);
        assert.deepEqual(
          (
            approvedConsumer.agent_input as {
              declarations: { consumed: Array<Record<string, unknown>> };
            }
          ).declarations.consumed,
          [expectedConsumption]
        );
      } finally {
        score.close();
      }

      assert.equal(readFileSync(join(projectRoot, "src/account.ts"), "utf8"), originalOwner);
      assert.equal(existsSync(join(projectRoot, "src/format-account.ts")), false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
