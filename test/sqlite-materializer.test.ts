import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import Database from "better-sqlite3";

import { createMalformedBundles } from "../src/conformance.js";
import { createAcceptedInputPacket } from "../src/fixture-inputs.js";
import { ScoreAlpha } from "../src/score-alpha.js";
import type { CompilationBundle } from "../src/types.js";

function readBundle(): unknown {
  return JSON.parse(
    readFileSync(join(process.cwd(), "fixtures", "account-status.bundle.json"), "utf8")
  );
}

describe("deterministic SQLite materializer", () => {
  it("migrates historical prepared slices to stable IDs with no dependencies", () => {
    const directory = mkdtempSync(join(tmpdir(), "score-alpha-v6-upgrade-"));
    const databasePath = join(directory, "score.db");
    try {
      const raw = new Database(databasePath);
      for (const [version, name] of [
        [1, "001_initial"],
        [2, "002_declaration_registry"],
        [3, "003_declaration_registry_view"],
        [4, "004_repository_project_settings"],
        [5, "005_plan_intake_revisions"],
        [6, "006_prepared_slice_publications"]
      ] as const) {
        raw.exec(
          readFileSync(
            join(process.cwd(), "migrations", `${String(version).padStart(3, "0")}_${name.slice(4)}.sql`),
            "utf8"
          )
        );
        raw.prepare(
          "INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)"
        ).run(version, name, "2026-08-09T19:00:00.000Z");
      }
      raw.pragma("foreign_keys = OFF");
      raw
        .prepare("INSERT INTO prepared_slices(title, slug, created_at) VALUES (?, ?, ?)")
        .run("Historical Slice", "historical-slice", "2026-08-08T12:00:00.000Z");
      raw
        .prepare(
          `INSERT INTO prepared_slice_revisions
           (title, revision, input_digest, manifest_id, review_id, artifact_stem, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          "Historical Slice",
          1,
          `sha256:${"1".repeat(64)}`,
          "historical-manifest",
          "historical-review",
          "historical-slice-review",
          "2026-08-08T12:00:00.000Z"
        );
      raw.close();

      const upgraded = ScoreAlpha.open(databasePath);
      upgraded.close();

      const inspected = new Database(databasePath, { readonly: true });
      assert.deepEqual(
        inspected
          .prepare(
            `SELECT slice.slice_id AS sliceId,
                    revision.display_title AS displayTitle,
                    revision.draft_digest AS draftDigest,
                    revision.source_path AS sourcePath
             FROM prepared_slices slice
             JOIN prepared_slice_revisions revision ON revision.title = slice.title`
          )
          .get(),
        {
          sliceId: "historical-slice",
          displayTitle: "Historical Slice",
          draftDigest: null,
          sourcePath: null
        }
      );
      assert.equal(
        (inspected.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as {
          version: number;
        }).version,
        7
      );
      assert.equal(
        (inspected.prepare("SELECT COUNT(*) AS count FROM prepared_slice_dependencies").get() as {
          count: number;
        }).count,
        0
      );
      inspected.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("upgrades an existing schema-version-2 database with the declaration inspection view", () => {
    const directory = mkdtempSync(join(tmpdir(), "score-alpha-v2-upgrade-"));
    const databasePath = join(directory, "score.db");
    try {
      const raw = new Database(databasePath);
      raw.exec(readFileSync(join(process.cwd(), "migrations", "001_initial.sql"), "utf8"));
      raw.prepare(
        "INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)"
      ).run(1, "001_initial", "2026-08-05T20:00:00.000Z");
      raw.exec(
        readFileSync(join(process.cwd(), "migrations", "002_declaration_registry.sql"), "utf8")
      );
      raw.prepare(
        "INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)"
      ).run(2, "002_declaration_registry", "2026-08-06T20:00:00.000Z");
      raw.close();

      const upgraded = ScoreAlpha.open(databasePath);
      assert.deepEqual(upgraded.inspectViews().v_declaration_registry, []);
      assert.deepEqual(upgraded.inspectViews().v_repository_project_settings, []);
      upgraded.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("refuses to mislabel a populated pre-Project-Settings database as schema version 4", () => {
    const directory = mkdtempSync(join(tmpdir(), "score-alpha-v3-populated-upgrade-"));
    const databasePath = join(directory, "score.db");
    try {
      const raw = new Database(databasePath);
      for (const [version, name] of [
        [1, "001_initial"],
        [2, "002_declaration_registry"],
        [3, "003_declaration_registry_view"]
      ] as const) {
        raw.exec(
          readFileSync(
            join(
              process.cwd(),
              "migrations",
              `${String(version).padStart(3, "0")}_${name.slice(4)}.sql`
            ),
            "utf8"
          )
        );
        raw.prepare(
          "INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)"
        ).run(version, name, "2026-08-06T20:30:00.000Z");
      }
      raw.prepare(
        `INSERT INTO repository_revisions
         (revision_id, label, ordered_manifest_json, content_digest)
         VALUES (?, ?, ?, ?)`
      ).run(
        "00000000-0000-4000-8000-000000000001",
        "legacy-r1",
        "[]",
        `sha256:${"0".repeat(64)}`
      );
      raw.close();

      assert.throws(
        () => ScoreAlpha.open(databasePath),
        /Cannot upgrade a populated pre-Project-Settings database/
      );
      const unchanged = new Database(databasePath, { readonly: true });
      assert.equal(
        (unchanged.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as {
          version: number;
        }).version,
        3
      );
      unchanged.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("retains an invalid Submission without partial draft rows, then atomically imports the valid graph", () => {
    const directory = mkdtempSync(join(tmpdir(), "score-alpha-test-"));
    try {
      const score = ScoreAlpha.open(join(directory, "score.db"));
      const acceptedInputs = createAcceptedInputPacket();
      score.initializeAcceptedInputs(acceptedInputs);
      score.initializeAcceptedInputs(acceptedInputs);
      const differentInputs = structuredClone(acceptedInputs);
      (
        differentInputs.compilation_procedure as { protocol_id: string }
      ).protocol_id = "00000000-0000-4000-8000-000000000002";
      assert.throws(
        () => score.initializeAcceptedInputs(differentInputs),
        /already initialized with a different accepted input set/
      );
      const validBundle = readBundle();
      const invalidBundle = createMalformedBundles(validBundle).get("unknown-bundle-field");
      const invalid = score.submitCompilation(invalidBundle, {
        compiler_name: "codex-existing-agent",
        model_id: "openai/gpt-5",
        received_at: "2026-08-05T20:01:00.000Z",
        label: "unknown-bundle-field"
      });

      assert.equal(invalid.outcome, "invalid");
      assert.ok(invalid.findings.some((finding) => finding.code === "SCHEMA_ADDITIONAL_PROPERTY"));
      assert.equal(score.inspectCounts().compilation_submissions, 1);
      assert.equal(score.inspectCounts().run_manifests, 0);
      assert.equal(score.inspectCounts().capsules, 0);

      const repeatedInvalid = score.submitCompilation(invalidBundle, {
        compiler_name: "codex-existing-agent",
        model_id: "openai/gpt-5",
        received_at: "2026-08-05T20:01:30.000Z",
        label: "unknown-bundle-field"
      });
      assert.notEqual(repeatedInvalid.submission_id, invalid.submission_id);
      assert.equal(score.inspectCounts().compilation_submissions, 2);
      assert.equal(score.inspectCounts().run_manifests, 0);

      const duplicateRoleBundle = structuredClone(validBundle) as CompilationBundle;
      duplicateRoleBundle.proposed_definition.capsule_contract_roles.push(
        structuredClone(duplicateRoleBundle.proposed_definition.capsule_contract_roles[0]!)
      );
      const duplicateRole = score.submitCompilation(duplicateRoleBundle, {
        compiler_name: "codex-existing-agent",
        model_id: "openai/gpt-5",
        received_at: "2026-08-05T20:01:45.000Z",
        label: "duplicate-contract-role"
      });
      assert.equal(duplicateRole.outcome, "invalid");
      assert.ok(duplicateRole.findings.some((finding) => finding.code === "CONTRACT_ROLE_DUPLICATE"));
      assert.equal(score.inspectCounts().compilation_submissions, 3);
      assert.equal(score.inspectCounts().run_manifests, 0);

      const valid = score.submitCompilation(validBundle, {
        compiler_name: "codex-existing-agent",
        model_id: "openai/gpt-5",
        received_at: "2026-08-05T20:02:00.000Z",
        label: "valid-account-status"
      });

      assert.equal(valid.outcome, "valid");
      assert.ok(valid.manifest_id);
      assert.deepEqual(score.inspectCounts(), {
        compilation_submissions: 4,
        compilation_submission_findings:
          invalid.findings.length + repeatedInvalid.findings.length + duplicateRole.findings.length,
        run_manifests: 1,
        contracts: 1,
        coding_passes: 1,
        capsules: 2,
        project_settings: 0,
        planned_declarations: 0,
        context_items: 7,
        harness_payloads: 0,
        publication_validation_runs: 0,
        publication_reviews: 0,
        publication_decisions: 0
      });
      const views = score.inspectViews();
      assert.equal(views.v_repository_files?.length, 1);
      assert.equal(views.v_repository_project_settings?.length, 0);
      assert.equal(views.v_coding_pass_capsules?.length, 2);
      assert.equal(views.v_declaration_registry?.length, 0);
      assert.equal(views.v_context_bindings?.length, 7);
      assert.equal(views.v_resolved_skills?.length, 1);
      assert.equal(views.v_compilation_history?.length, 4);
      score.close();

      const raw = new Database(join(directory, "score.db"));
      assert.throws(
        () => raw.prepare("UPDATE run_manifests SET label = 'mutated'").run(),
        /append-only/
      );
      assert.throws(() => raw.prepare("DELETE FROM compilation_submissions").run(), /append-only/);
      raw.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
