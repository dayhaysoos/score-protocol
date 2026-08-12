import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { canonicalJson, parseJsonNoDuplicateKeys } from "./canonical.js";
import { createMalformedBundles } from "./conformance.js";
import { createAcceptedInputPacket } from "./fixture-inputs.js";
import {
  ScoreAlpha,
  type PublicationReviewResult,
  type ReviewDigestSet
} from "./score-alpha.js";

const OUTPUT_DIRECTORY = join(process.cwd(), "output");
const DATABASE_PATH = join(OUTPUT_DIRECTORY, "score.db");
const REPRODUCTION_DATABASE_PATH = join(OUTPUT_DIRECTORY, "reproduction-check.db");

function removeExactFile(path: string): void {
  if (existsSync(path)) unlinkSync(path);
}

function resetGeneratedOutputs(): void {
  const paths = [
    DATABASE_PATH,
    `${DATABASE_PATH}-shm`,
    `${DATABASE_PATH}-wal`,
    REPRODUCTION_DATABASE_PATH,
    `${REPRODUCTION_DATABASE_PATH}-shm`,
    `${REPRODUCTION_DATABASE_PATH}-wal`,
    join(OUTPUT_DIRECTORY, "compiler-input.json"),
    join(OUTPUT_DIRECTORY, "publication-review.md"),
    join(OUTPUT_DIRECTORY, "publication-review.html"),
    join(OUTPUT_DIRECTORY, "publication-review.snapshot.json"),
    join(OUTPUT_DIRECTORY, "digest-set.json"),
    join(OUTPUT_DIRECTORY, "evidence.json"),
    join(OUTPUT_DIRECTORY, "inspection.json"),
    join(OUTPUT_DIRECTORY, "inspection.txt"),
    join(OUTPUT_DIRECTORY, "approved-payloads.json")
  ];
  paths.forEach(removeExactFile);
}

function prettyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, prettyJson(value), "utf8");
}

function readAuthoredBundle(): unknown {
  const raw = readFileSync(join(process.cwd(), "fixtures", "account-status.bundle.json"), "utf8");
  return parseJsonNoDuplicateKeys(raw);
}

function createReproductionReview(bundle: unknown): PublicationReviewResult {
  const score = ScoreAlpha.open(REPRODUCTION_DATABASE_PATH);
  try {
    score.initializeAcceptedInputs(createAcceptedInputPacket());
    let invalidIndex = 0;
    for (const [label, malformedBundle] of createMalformedBundles(bundle)) {
      score.submitCompilation(malformedBundle, {
        compiler_name: "codex-existing-agent",
        model_id: "openai/gpt-5",
        received_at: `2026-08-05T20:${String(20 + invalidIndex).padStart(2, "0")}:00.000Z`,
        label
      });
      invalidIndex += 1;
    }
    const valid = score.submitCompilation(bundle, {
      compiler_name: "codex-existing-agent",
      model_id: "openai/gpt-5",
      received_at: "2026-08-05T20:30:00.000Z",
      label: "valid-account-status"
    });
    if (!valid.manifest_id) throw new Error("Reproduction valid Bundle did not import");
    return score.prepareReview(valid.manifest_id, "2026-08-05T20:31:00.000Z");
  } finally {
    score.close();
  }
}

export function reproduceDraft(): {
  database_path: string;
  review_path: string;
  review_id: string;
  pass_id: string;
  digest_set: ReviewDigestSet;
} {
  mkdirSync(OUTPUT_DIRECTORY, { recursive: true });
  resetGeneratedOutputs();
  const inputs = createAcceptedInputPacket();
  const authoredBundle = readAuthoredBundle();
  writeJson(join(OUTPUT_DIRECTORY, "compiler-input.json"), inputs);

  const score = ScoreAlpha.open(DATABASE_PATH);
  let review: PublicationReviewResult;
  const invalidEvidence: Array<Record<string, unknown>> = [];
  let preApprovalExportError = "";
  try {
    score.initializeAcceptedInputs(inputs);
    let invalidIndex = 0;
    for (const [label, malformedBundle] of createMalformedBundles(authoredBundle)) {
      const result = score.submitCompilation(malformedBundle, {
        compiler_name: "codex-existing-agent",
        model_id: "openai/gpt-5",
        received_at: `2026-08-05T20:${String(20 + invalidIndex).padStart(2, "0")}:00.000Z`,
        label
      });
      const counts = score.inspectCounts();
      invalidEvidence.push({
        label,
        submission_id: result.submission_id,
        bundle_digest: result.bundle_digest,
        outcome: result.outcome,
        finding_codes: result.findings.map((finding) => finding.code),
        draft_definition_counts_after_submission: {
          run_manifests: counts.run_manifests,
          contracts: counts.contracts,
          coding_passes: counts.coding_passes,
          capsules: counts.capsules,
          context_items: counts.context_items
        }
      });
      invalidIndex += 1;
    }
    const valid = score.submitCompilation(authoredBundle, {
      compiler_name: "codex-existing-agent",
      model_id: "openai/gpt-5",
      received_at: "2026-08-05T20:30:00.000Z",
      label: "valid-account-status"
    });
    if (!valid.manifest_id || valid.outcome !== "valid") {
      throw new Error(`Authored Bundle failed validation: ${JSON.stringify(valid.findings)}`);
    }
    review = score.prepareReview(valid.manifest_id, "2026-08-05T20:31:00.000Z");
    try {
      score.exportApprovedPass(review.digest_set.pass.protocol_id);
    } catch (error) {
      preApprovalExportError = error instanceof Error ? error.message : String(error);
    }
    const views = score.inspectViews();
    writeJson(join(OUTPUT_DIRECTORY, "inspection.json"), views);
    writeFileSync(
      join(OUTPUT_DIRECTORY, "inspection.txt"),
      Object.entries(views)
        .map(([name, rows]) => `## ${name}\n\n${JSON.stringify(rows, null, 2)}`)
        .join("\n\n"),
      "utf8"
    );
    writeFileSync(join(OUTPUT_DIRECTORY, "publication-review.html"), review.html, "utf8");
    writeJson(join(OUTPUT_DIRECTORY, "publication-review.snapshot.json"), review.snapshot);
    writeJson(join(OUTPUT_DIRECTORY, "digest-set.json"), review.digest_set);

    const reproduction = createReproductionReview(authoredBundle);
    const deterministic = {
      digest_set_byte_identical:
        canonicalJson(reproduction.digest_set) === canonicalJson(review.digest_set),
      publication_review_html_byte_identical: reproduction.html === review.html,
      publication_review_snapshot_digest_identical:
        reproduction.snapshot_digest === review.snapshot_digest,
      agent_input_markdown_digests_identical:
        canonicalJson(
          reproduction.snapshot.passes.flatMap((pass) =>
            pass.capsules.map((capsule) => capsule.agent_input_markdown_digest)
          )
        ) ===
        canonicalJson(
          review.snapshot.passes.flatMap((pass) =>
            pass.capsules.map((capsule) => capsule.agent_input_markdown_digest)
          )
        )
    };
    writeJson(join(OUTPUT_DIRECTORY, "evidence.json"), {
      experiment: "SCORE Protocol Account Status SQLite alpha",
      phase: "Phase 1 draft awaiting Human Gate 1",
      experiment_path: ".",
      database_path: "output/score.db",
      authored_bundle_path: "fixtures/account-status.bundle.json",
      authoring_skill_path: "skills/score-authoring/SKILL.md",
      compiler_provenance: {
        compiler_name: "codex-existing-agent",
        model_id: "openai/gpt-5",
        procedure_id: inputs.compilation_procedure.protocol_id,
        procedure_digest: inputs.compilation_procedure.content_digest
      },
      invalid_submissions: invalidEvidence,
      valid_submission: {
        submission_id: valid.submission_id,
        bundle_digest: valid.bundle_digest,
        outcome: valid.outcome,
        findings: valid.findings,
        manifest_id: valid.manifest_id
      },
      final_counts: score.inspectCounts(),
      deterministic_reproduction: deterministic,
      publication_gate: {
        review_id: review.review_id,
        review_snapshot_digest: review.snapshot_digest,
        review_html_digest: review.html_digest,
        blockers: review.snapshot.publication_gate.blockers,
        warnings: review.snapshot.publication_gate.warnings,
        compilation_gaps: review.snapshot.publication_gate.compilation_gaps,
        persisted_definition_validation:
          review.snapshot.publication_gate.publication_validation,
        pre_approval_export_rejected: preApprovalExportError.length > 0,
        rejection_message: preApprovalExportError,
        publication_decision_count: score.inspectCounts().publication_decisions,
        exact_digest_set: review.digest_set
      },
      manual_interventions: [
        "The current Codex agent authored the complete Bundle while following the versioned local SCORE authoring skill.",
        "During artifact review, the agent sharpened the authoring skill completion criterion and updated the Bundle's Compilation Procedure and Compiler Input Revision source digests to the newly accepted bytes before the final clean reproduction.",
        "No SQL row, persistent Protocol Identifier, proposed-object digest, Harness Payload, or Markdown prompt was manually authored.",
        "No validation repair was applied to the valid Bundle; the malformed submissions are deliberate conformance mutations."
      ],
      deviations_and_limitations: [
        "The relational DDL is the smallest experimental schema needed by this fixture; docs/sqlite-alpha.md explicitly labels its table list provisional.",
        "Opaque Protocol Identifiers are assigned by deterministic experiment code so independent clean reproductions can be compared; they remain distinct from Content Digests.",
        "The disposable ScoreAlpha class still co-locates several materializer and publication responsibilities; an independent Standards review flagged that maintainability seam, but it was not split into production architecture for this narrow proof.",
        "This evidence proves only compilation, deterministic storage/materialization, review, and the publication/export gate. No Cursor agent ran and no application file was produced."
      ]
    });

    if (!Object.values(deterministic).every(Boolean)) {
      throw new Error(`Deterministic reproduction failed: ${JSON.stringify(deterministic)}`);
    }
    if (!preApprovalExportError) {
      throw new Error("Pre-approval export unexpectedly succeeded");
    }
  } finally {
    score.close();
    removeExactFile(REPRODUCTION_DATABASE_PATH);
    removeExactFile(`${REPRODUCTION_DATABASE_PATH}-shm`);
    removeExactFile(`${REPRODUCTION_DATABASE_PATH}-wal`);
  }

  return {
    database_path: DATABASE_PATH,
    review_path: join(OUTPUT_DIRECTORY, "publication-review.html"),
    review_id: review.review_id,
    pass_id: review.digest_set.pass.protocol_id,
    digest_set: review.digest_set
  };
}
