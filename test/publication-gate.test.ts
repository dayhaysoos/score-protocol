import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import Database from "better-sqlite3";

import { createAcceptedInputPacket } from "../src/fixture-inputs.js";
import { ScoreAlpha } from "../src/score-alpha.js";
import type { CompilationBundle } from "../src/types.js";

function readBundle(): unknown {
  return JSON.parse(
    readFileSync(join(process.cwd(), "fixtures", "account-status.bundle.json"), "utf8")
  );
}

describe("Publication Review, decision, and harness-facing export", () => {
  it("reruns publication validation against the persisted graph and retains a failed gate", () => {
    const directory = mkdtempSync(join(tmpdir(), "score-alpha-publication-invalid-"));
    const databasePath = join(directory, "score.db");
    try {
      const score = ScoreAlpha.open(databasePath);
      score.initializeAcceptedInputs(createAcceptedInputPacket());
      const submitted = score.submitCompilation(readBundle(), {
        compiler_name: "codex-existing-agent",
        model_id: "openai/gpt-5",
        received_at: "2026-08-05T20:10:00.000Z",
        label: "valid-account-status"
      });
      assert.ok(submitted.manifest_id);
      score.close();

      const raw = new Database(databasePath);
      raw.exec("DROP TRIGGER contract_input_bindings_reject_delete");
      raw.prepare(
        `DELETE FROM contract_input_bindings
         WHERE rowid = (SELECT MIN(rowid) FROM contract_input_bindings)`
      ).run();
      raw.close();

      const reopened = ScoreAlpha.open(databasePath);
      assert.throws(
        () =>
          reopened.prepareReview(
            submitted.manifest_id ?? "",
            "2026-08-05T20:11:00.000Z"
          ),
        /Persisted definition failed publication validation/
      );
      assert.equal(reopened.inspectCounts().harness_payloads, 0);
      assert.equal(reopened.inspectCounts().publication_reviews, 0);
      assert.equal(reopened.inspectCounts().publication_validation_runs, 1);
      const validationRows = reopened.inspectViews().v_publication_validation ?? [];
      assert.ok(validationRows.length >= 1);
      assert.ok(validationRows.every((row) => row.outcome === "invalid"));
      assert.ok(
        validationRows.some(
          (row) => row.code === "PUBLICATION_INPUT_CARDINALITY_INVALID"
        )
      );
      reopened.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("renders deterministic closed payloads, blocks pre-approval export, and exports frozen approved rows", () => {
    const directory = mkdtempSync(join(tmpdir(), "score-alpha-publication-"));
    const databasePath = join(directory, "score.db");
    try {
      const score = ScoreAlpha.open(databasePath);
      const acceptedInputs = createAcceptedInputPacket();
      score.initializeAcceptedInputs(acceptedInputs);
      const submitted = score.submitCompilation(readBundle(), {
        compiler_name: "codex-existing-agent",
        model_id: "openai/gpt-5",
        received_at: "2026-08-05T20:10:00.000Z",
        label: "valid-account-status"
      });
      assert.ok(submitted.manifest_id);

      const review = score.prepareReview(
        submitted.manifest_id ?? "",
        "2026-08-05T20:11:00.000Z"
      );
      const repeated = score.prepareReview(
        submitted.manifest_id ?? "",
        "2026-08-05T20:11:00.000Z"
      );

      assert.equal(review.html, repeated.html);
      assert.equal(review.html_digest, repeated.html_digest);
      assert.equal(review.snapshot.publication_gate.publication_validation.outcome, "valid");
      assert.equal(review.snapshot.publication_gate.publication_validation.finding_count, 0);
      assert.equal(score.inspectCounts().publication_validation_runs, 1);
      assert.equal(score.inspectViews().v_publication_validation?.length, 1);
      assert.match(review.html, /<!doctype html>/);
      assert.match(review.html, /<title>SCORE Plan Review/);
      assert.match(review.html, /<span class="product-name">SCORE Plan Review<\/span>/);
      assert.doesNotMatch(review.html, /Ready for human review/);
      assert.doesNotMatch(review.html, /Publication findings/);
      assert.doesNotMatch(review.html, /What must be true/);
      assert.doesNotMatch(review.html, />Coding Pass</);
      assert.doesNotMatch(review.html, /No publication decision recorded/);
      assert.doesNotMatch(review.html, /Slice 1:/);
      assert.match(review.html, /2 files will change/);
      assert.match(review.html, /2 isolated file-agents/);
      assert.match(review.html, /One isolated agent handles each file/);
      assert.match(review.html, /<h2[^>]*>Files to change<\/h2>/);
      assert.match(review.html, /<h2[^>]*>Read-only context<\/h2>/);
      assert.match(review.html, /<h2[^>]*>Requirement coverage<\/h2>/);
      assert.match(review.html, /<h4>Purpose<\/h4>/);
      assert.match(review.html, /<h4>Context supplied<\/h4>/);
      assert.match(review.html, /<h4>Skills<\/h4>/);
      assert.match(review.html, /TypeScript module boundaries/);
      assert.match(review.html, /<summary>Plan validation and audit<\/summary>/);
      assert.match(review.html, /This validates the plan only\. It does not test an implementation\./);
      assert.match(review.html, /No candidates have been generated or applied from this plan\./);
      assert.match(review.html, /Implementation quality is evaluated outside SCORE\./);
      assert.doesNotMatch(review.html, /Project and acceptance checks/);
      assert.doesNotMatch(review.html, /<summary>Verification<\/summary>/);
      assert.doesNotMatch(review.html, /<strong>valid<\/strong>/);
      assert.match(review.html, /Machine evidence/);
      assert.match(review.html, /Exact Agent Input JSON/);
      assert.doesNotMatch(review.html, /name="slice-1-files" open/);
      assert.match(review.html, /src\/schema\.ts/);
      assert.match(review.html, /src\/account-label\.ts/);
      assert.doesNotMatch(review.html, /Exact Harness Control/);
      assert.match(review.html, />Plan Manifest</);
      assert.match(review.html, />Reviewed work</);
      assert.doesNotMatch(review.html, />Change Plan</);
      assert.match(review.html, /one Agent Package per file/);
      assert.ok(
        review.snapshot.publication_gate.publication_validation.checks.every(
          (check) => !/\bone Change\b|\bone Slice\b|Plan Manifest, Change,/u.test(check)
        )
      );
      assert.equal(review.digest_set.payloads.length, 2);
      const schemaPayload = review.snapshot.passes[0]?.capsules.find(
        (capsule) => capsule.target_path === "src/schema.ts"
      );
      const labelPayload = review.snapshot.passes[0]?.capsules.find(
        (capsule) => capsule.target_path === "src/account-label.ts"
      );
      assert.ok(schemaPayload);
      assert.ok(labelPayload);
      const schemaAgentInput = schemaPayload.agent_input as {
        declarations: {
          owned: Array<{ name: string; declaration: string; description: string }>;
          consumed: unknown[];
        };
      };
      const labelAgentInput = labelPayload.agent_input as {
        declarations: {
          owned: Array<{ name: string; declaration: string; description: string }>;
          consumed: Array<{ name: string; declaration: string; description: string }>;
        };
      };
      const accountDeclaration = {
        name: "Account",
        declaration:
          'export interface Account {\n  id: string;\n  name: string;\n  status: "active" | "suspended";\n}',
        description: "Represents an account with the required status used by callers and the formatter."
      };
      assert.deepEqual(schemaAgentInput.declarations.owned, [accountDeclaration]);
      assert.deepEqual(schemaAgentInput.declarations.consumed, []);
      assert.deepEqual(labelAgentInput.declarations.owned, [
        {
          name: "formatAccountLabel",
          declaration: "export declare function formatAccountLabel(account: Account): string;",
          description: "Returns the account name and status exactly as name [status]."
        }
      ]);
      assert.deepEqual(labelAgentInput.declarations.consumed, [accountDeclaration]);
      assert.doesNotMatch(review.html, /TypeScript project settings/);
      assert.doesNotMatch(schemaPayload.agent_input_markdown, /formatAccountLabel/);
      assert.match(labelPayload.agent_input_markdown, /Use this documented interface as read-only context/);
      assert.doesNotMatch(schemaPayload.agent_input_markdown, /TypeScript Module Boundaries/);
      assert.match(labelPayload.agent_input_markdown, /TypeScript Module Boundaries/);
      assert.match(labelPayload.agent_input_markdown, /Import type-only dependencies with `import type`/);
      assert.doesNotMatch(labelPayload.agent_input_markdown, /Pure TypeScript Formatter/);
      assert.doesNotMatch(labelPayload.agent_input_markdown, /manifest_id|control_digest/);
      assert.throws(
        () => score.exportApprovedPass(review.digest_set.pass.protocol_id),
        /not approved/
      );

      score.decidePublication({
        review_id: review.review_id,
        authority: "test-human-authority",
        decided_at: "2026-08-05T20:12:00.000Z",
        decision: "approve",
        expected_digest_set: review.digest_set,
        warning_waivers: [],
        rationale: "Synthetic test approval in an isolated temporary database."
      });
      const exported = score.exportApprovedPass(review.digest_set.pass.protocol_id);
      score.close();

      const reopened = ScoreAlpha.open(databasePath);
      const exportedAgain = reopened.exportApprovedPass(review.digest_set.pass.protocol_id);
      assert.deepEqual(exportedAgain, exported);
      assert.equal(exported.version, "0.1.0-alpha.5");
      assert.deepEqual(exported.source_snapshot, {
        revision_id: acceptedInputs.repository_revision.protocol_id,
        content_digest: acceptedInputs.repository_revision.content_digest,
        files: acceptedInputs.repository_revision.ordered_manifest
      });
      assert.equal(exported.payloads.length, 2);
      reopened.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

});
