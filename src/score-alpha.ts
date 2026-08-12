import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

import { canonicalJson, sha256Bytes, sha256Json } from "./canonical.js";
import type { ValidationFinding } from "./bundle-schema.js";
import type { AcceptedInputPacket } from "./compiler-input.js";
import {
  AGENT_INPUT_RENDERER,
  PUBLICATION_REVIEW_RENDERER,
  renderAgentInput,
  renderPublicationReviewHtml,
  rendererDigest,
  type PublicationReviewRenderOptions,
  type RenderableAgentInput,
  type RenderableReviewSnapshot,
  type ReviewKind
} from "./render.js";
import {
  compareRepositoryPaths,
  repositoryRevisionContentDigest,
  type RepositorySourceSnapshot
} from "./repository-source-state.js";
import type { ResolvedSliceDependency } from "./slice-draft.js";
import type { CompilationBundle, ProposedDefinition } from "./types.js";
import { hasBlockingFindings, validateCompilationBundle } from "./validation.js";

const VALIDATOR_ID = "score-alpha.structural-validator";
const VALIDATOR_VERSION = "0.1.0-alpha.4";
const PUBLICATION_VALIDATOR_ID = "score-alpha.persisted-definition-validator";
const PUBLICATION_VALIDATOR_VERSION = "0.1.0-alpha.4";
const PUBLICATION_CHECKS = [
  "one reviewed work revision with exactly its declared file scope",
  "file operations match the Source Snapshot",
  "required Contract Input cardinality",
  "binding membership, kind, and exact-version compatibility",
  "every Context Set member has an explicit binding",
  "every Accepted Requirement has a traceability path",
  "one Agent Package per file",
  "documented interface context is routed only to its declared owners and consumers",
  "Run Rules, Agent Input, and Agent Package digests reproduce",
  "Run Rules match the Plan Manifest, reviewed work, File Brief, target, and operation"
] as const;

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function safeLegacySliceId(title: string): string {
  const value = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 64)
    .replace(/-+$/gu, "");
  return value.length > 0 ? value : "legacy-slice";
}

class PublicationValidationError extends Error {
  readonly findings: ValidationFinding[];

  constructor(findings: ValidationFinding[]) {
    super("Persisted definition failed publication validation");
    this.findings = findings;
  }
}

function publicationIssue(
  code: string,
  location: string,
  message: string,
  detail: Record<string, unknown> = {}
): ValidationFinding {
  return {
    kind: "deterministic_validation",
    code,
    severity: "error",
    location,
    message,
    detail,
    machine_repairable: false,
    requires_human_input: true
  };
}

const IMMUTABLE_TABLES = [
  "accepted_specifications",
  "accepted_requirements",
  "compilation_procedures",
  "compiler_input_revisions",
  "repository_revisions",
  "repository_project_settings",
  "repository_revision_files",
  "repository_revision_absences",
  "compilation_submissions",
  "compilation_submission_findings",
  "run_manifests",
  "compilation_reports",
  "contract_sets",
  "contracts",
  "contract_inputs",
  "coding_passes",
  "context_items",
  "context_sets",
  "context_set_items",
  "capsules",
  "planned_declarations",
  "declaration_ownership",
  "declaration_consumers",
  "dependencies",
  "capsule_contract_roles",
  "contract_input_bindings",
  "capability_requirements",
  "requirement_bindings",
  "compilation_source_citations",
  "compilation_source_bindings",
  "object_handle_mappings",
  "harness_payloads",
  "harness_payload_renders",
  "publication_reviews",
  "publication_review_renders",
  "publication_validation_runs",
  "publication_validation_findings",
  "publication_decisions",
  "publication_decision_payloads",
  "prepared_slices",
  "prepared_slice_revisions",
  "prepared_slice_publications",
  "prepared_slice_dependencies"
] as const;

export interface SubmissionMetadata {
  compiler_name: string;
  model_id: string;
  received_at: string;
  label: string;
  prior_submission_id?: string;
}

export interface SubmissionResult {
  submission_id: string;
  bundle_digest: string;
  outcome: "valid" | "invalid";
  findings: ValidationFinding[];
  manifest_id?: string;
}

export interface InspectionCounts {
  compilation_submissions: number;
  compilation_submission_findings: number;
  run_manifests: number;
  contracts: number;
  coding_passes: number;
  capsules: number;
  project_settings: number;
  planned_declarations: number;
  context_items: number;
  harness_payloads: number;
  publication_validation_runs: number;
  publication_reviews: number;
  publication_decisions: number;
}

export interface ReviewDigestSet {
  manifest: { protocol_id: string; content_digest: string };
  compilation_report: { protocol_id: string; content_digest: string };
  pass: { protocol_id: string; content_digest: string };
  payloads: Array<{
    payload_id: string;
    target_path: string;
    control_digest: string;
    agent_input_digest: string;
    payload_digest: string;
  }>;
}

export interface ReviewSnapshot extends RenderableReviewSnapshot {
  schema: "score.publication-review";
  version: "0.1.0-alpha.4";
  digest_set: ReviewDigestSet;
}

export interface PublicationReviewResult {
  review_id: string;
  snapshot: ReviewSnapshot;
  snapshot_digest: string;
  html: string;
  html_digest: string;
  digest_set: ReviewDigestSet;
}

export interface PreparedSliceRevision {
  readonly identityKey: string;
  readonly sliceId: string;
  readonly displayTitle: string;
  readonly slug: string;
  readonly revision: number;
  readonly inputDigest: string;
  readonly draftDigest: string | null;
  readonly sourcePath: string | null;
  readonly manifestId: string;
  readonly reviewId: string;
  readonly artifactStem: string;
}

export type PreparedSliceMaterializationResult =
  | {
      readonly status: "invalid";
      readonly submission: SubmissionResult;
    }
  | {
      readonly status: "review_ready";
      readonly revision: PreparedSliceRevision;
      readonly review: PublicationReviewResult;
    };

export interface ReviewedChangePlan {
  passId: string;
  reviewId: string;
  sliceId: string;
  logicalTitle: string;
  label: string;
  revision: number;
  revisionCount: number;
  objective: string;
  files: ReadonlyArray<string>;
  approvalStatus: "approved" | "needs_approval" | "review_required" | "blocked";
  warningCount: number;
  digestSet: ReviewDigestSet;
}

export interface ReviewedPlanRepositoryState {
  passId: string;
  sourceSnapshot: RepositorySourceSnapshot;
  allowedChanges: ReadonlyArray<{
    targetPath: string;
    operation: "create" | "replace" | "delete";
  }>;
}

export interface PreparedSliceHead {
  readonly sliceId: string;
  readonly title: string;
  readonly revision: number;
  readonly draftDigest: string | null;
  readonly sourcePath: string | null;
  readonly artifactStem: string;
  readonly manifestId: string;
  readonly reviewId: string;
  readonly passId: string;
  readonly published: boolean;
  readonly resolvedDependencies: ReadonlyArray<ResolvedSliceDependency>;
  readonly acceptedSpecification: unknown;
}

interface PersistedPublicationValidation {
  validation_run_id: string;
  validator_id: string;
  validator_version: string;
  validated_at: string;
  checks: readonly string[];
  outcome: "valid" | "invalid";
  finding_count: number;
}

export interface PublicationDecisionInput {
  review_id: string;
  authority: string;
  decided_at: string;
  decision: "approve" | "reject";
  expected_digest_set: ReviewDigestSet;
  warning_waivers: Array<{ code: string; rationale: string }>;
  rationale: string;
}

export interface ApprovedPassExport {
  schema: "score.approved-pass-export";
  version: "0.1.0-alpha.5";
  pass_id: string;
  publication: {
    review_id: string;
    decision_id: string;
    authority: string;
    decided_at: string;
  };
  source_snapshot: RepositorySourceSnapshot;
  payloads: Array<{
    payload_id: string;
    target_path: string;
    operation: string;
    control: unknown;
    agent_input: unknown;
    payload: unknown;
    control_digest: string;
    agent_input_digest: string;
    payload_digest: string;
  }>;
}

function opaqueId(...parts: string[]): string {
  const hex = createHash("sha256")
    .update(["score-protocol-alpha-local-id-v1", ...parts].join("\u0000"))
    .digest("hex")
    .slice(0, 32)
    .split("");
  hex[12] = "4";
  hex[16] = ((Number.parseInt(hex[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function mapKey(kind: string, handle: string): string {
  return `${kind}\u0000${handle}`;
}

function countRow(db: Database.Database, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number };
  return row.count;
}

function parseJson<T>(text: string): T {
  return JSON.parse(text) as T;
}

function documentedDeclarations(value: unknown): RenderableAgentInput["declarations"] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Documented declaration context must be an object");
  }
  const record = value as Record<string, unknown>;
  const validate = (
    items: unknown
  ): Array<{ name: string; declaration: string; description: string }> => {
    if (!Array.isArray(items)) throw new Error("Documented declarations must be arrays");
    return items.map((item) => {
      if (typeof item !== "object" || item === null || Array.isArray(item)) {
        throw new Error("Each documented declaration must be an object");
      }
      const declaration = item as Record<string, unknown>;
      if (
        typeof declaration.name !== "string" ||
        typeof declaration.declaration !== "string" ||
        typeof declaration.description !== "string"
      ) {
        throw new Error("Each documented declaration requires name, declaration, and description text");
      }
      return {
        name: declaration.name,
        declaration: declaration.declaration,
        description: declaration.description
      };
    });
  };
  return {
    owned: validate(record.owned),
    consumed: validate(record.consumed)
  };
}

function openReadOnlyScoreDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const migration = db
      .prepare("SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1")
      .get() as { version: number } | undefined;
    if (migration?.version !== 6 && migration?.version !== 7) {
      throw new Error("SCORE database does not have the supported schema version");
    }
    return db;
  } catch (cause) {
    db.close();
    throw cause;
  }
}

function readRepositorySourceSnapshot(
  db: Database.Database,
  passId: string
): RepositorySourceSnapshot {
  const sourceSnapshotRow = db
    .prepare(
      `SELECT rr.revision_id, rr.ordered_manifest_json,
              rr.content_digest AS revision_digest
       FROM coding_passes p
       JOIN repository_revisions rr ON rr.revision_id = p.base_revision_id
       WHERE p.pass_id = ?`
    )
    .get(passId) as
    | {
        revision_id: string;
        ordered_manifest_json: string;
        revision_digest: string;
      }
    | undefined;
  if (!sourceSnapshotRow) {
    throw new Error(`Reviewed work ${passId} has no Source Snapshot`);
  }
  const files = parseJson<
    Array<{ path: string; media_type: string; content_digest: string }>
  >(sourceSnapshotRow.ordered_manifest_json);
  const storedFiles = db
    .prepare(
      `SELECT normalized_path AS path, media_type, content, content_digest
       FROM repository_revision_files
       WHERE revision_id = ?
       ORDER BY normalized_path`
    )
    .all(sourceSnapshotRow.revision_id) as Array<{
    path: string;
    media_type: string;
    content: Buffer;
    content_digest: string;
  }>;
  if (
    canonicalJson(files.toSorted((left, right) => compareRepositoryPaths(left.path, right.path))) !==
      canonicalJson(
        storedFiles
          .map(({ path, media_type, content_digest }) => ({
            path,
            media_type,
            content_digest
          }))
          .toSorted((left, right) => compareRepositoryPaths(left.path, right.path))
      ) ||
    storedFiles.some((file) => sha256Bytes(file.content) !== file.content_digest) ||
    repositoryRevisionContentDigest({ orderedManifest: files }) !== sourceSnapshotRow.revision_digest
  ) {
    throw new Error(`Reviewed work ${passId} Source Snapshot does not reproduce`);
  }
  return {
    revision_id: sourceSnapshotRow.revision_id,
    content_digest: sourceSnapshotRow.revision_digest,
    files
  };
}

export class ScoreAlpha {
  readonly dbPath: string;
  private readonly db: Database.Database;
  private acceptedInputs: AcceptedInputPacket | undefined;

  private constructor(dbPath: string, db: Database.Database) {
    this.dbPath = dbPath;
    this.db = db;
  }

  static open(dbPath: string): ScoreAlpha {
    const db = new Database(dbPath);
    try {
      db.pragma("foreign_keys = ON");
      db.pragma("busy_timeout = 10000");
      try {
        db.pragma("journal_mode = WAL");
      } catch (cause) {
        if ((cause as { readonly code?: unknown }).code !== "SQLITE_BUSY") throw cause;
      }
      db.pragma("synchronous = FULL");
      const score = new ScoreAlpha(dbPath, db);
      db.transaction(() => score.applyMigrations()).immediate();
      return score;
    } catch (cause) {
      db.close();
      throw cause;
    }
  }

  static readApprovedPass(dbPath: string, passId: string): ApprovedPassExport {
    const db = openReadOnlyScoreDatabase(dbPath);
    try {
      return new ScoreAlpha(dbPath, db).exportApprovedPass(passId);
    } finally {
      db.close();
    }
  }

  static listReviewedChangePlans(dbPath: string): ReadonlyArray<ReviewedChangePlan> {
    const db = openReadOnlyScoreDatabase(dbPath);
    try {
      const preparedSliceColumns = db
        .prepare("PRAGMA table_info(prepared_slices)")
        .all() as Array<{ name: string }>;
      const preparedRevisionColumns = db
        .prepare("PRAGMA table_info(prepared_slice_revisions)")
        .all() as Array<{ name: string }>;
      const hasSliceId = preparedSliceColumns.some((column) => column.name === "slice_id");
      const hasDisplayTitle = preparedRevisionColumns.some(
        (column) => column.name === "display_title"
      );
      const sliceIdExpression = hasSliceId ? "slice.slice_id" : "slice.slug";
      const displayTitleExpression = hasDisplayTitle
        ? "COALESCE(revision.display_title, slice.title)"
        : "slice.title";
      const rows = db
        .prepare(
          `WITH prepared_revisions AS (
             SELECT revision.title AS identity_key,
                    ${sliceIdExpression} AS slice_id,
                    ${displayTitleExpression} AS display_title,
                    revision.revision, revision.manifest_id, revision.review_id
             FROM prepared_slice_revisions revision
             JOIN prepared_slices slice ON slice.title = revision.title
           ),
           latest_prepared AS (
             SELECT prepared.slice_id, MAX(prepared.revision) AS latest_revision,
                    COUNT(*) AS revision_count
             FROM prepared_revisions prepared
             GROUP BY prepared.slice_id
           )
           SELECT p.pass_id, pr.review_id, pr.snapshot_json,
                  prepared.slice_id,
                  prepared.display_title AS logical_title,
                  prepared.revision,
                  latest.revision_count,
                  EXISTS (
                    SELECT 1 FROM publication_decisions pd
                    WHERE pd.review_id = pr.review_id AND pd.decision = 'approve'
                  ) AS approved
           FROM coding_passes p
           JOIN publication_reviews pr ON pr.manifest_id = p.manifest_id
           LEFT JOIN prepared_revisions prepared
             ON prepared.manifest_id = p.manifest_id
            AND prepared.review_id = pr.review_id
           LEFT JOIN prepared_slice_publications publication
             ON publication.title = prepared.identity_key
            AND publication.revision = prepared.revision
            AND publication.review_id = prepared.review_id
           LEFT JOIN latest_prepared latest ON latest.slice_id = prepared.slice_id
           WHERE prepared.slice_id IS NULL
              OR (publication.review_id IS NOT NULL AND prepared.revision = latest.latest_revision)
           ORDER BY pr.created_at DESC, p.pass_id`
        )
        .all() as Array<{
        pass_id: string;
        review_id: string;
        snapshot_json: string;
        slice_id: string | null;
        logical_title: string | null;
        revision: number | null;
        revision_count: number | null;
        approved: number;
      }>;
      return rows.map((row) => {
        const snapshot = parseJson<ReviewSnapshot>(row.snapshot_json);
        const blockers = snapshot.publication_gate.blockers.length;
        const gaps = snapshot.publication_gate.compilation_gaps.length;
        const warningCount = snapshot.publication_gate.warnings.length;
        const approvalStatus: ReviewedChangePlan["approvalStatus"] =
          row.approved === 1
            ? "approved"
            : blockers > 0 || gaps > 0
              ? "blocked"
              : warningCount > 0
                ? "review_required"
                : "needs_approval";
        const logicalTitle = row.logical_title ?? snapshot.manifest.label;
        const revision = row.revision ?? 1;
        const revisionCount = row.revision_count ?? 1;
        return {
          passId: row.pass_id,
          reviewId: row.review_id,
          sliceId: row.slice_id ?? safeLegacySliceId(logicalTitle),
          logicalTitle,
          label: revision > 1 ? `${logicalTitle} v${revision}` : logicalTitle,
          revision,
          revisionCount,
          objective: snapshot.manifest.objective,
          files: snapshot.passes
            .flatMap((pass) => pass.capsules.map((capsule) => capsule.target_path))
            .toSorted(),
          approvalStatus,
          warningCount,
          digestSet: snapshot.digest_set
        };
      }).toSorted((left, right) => left.logicalTitle.localeCompare(right.logicalTitle));
    } finally {
      db.close();
    }
  }

  static listPreparedSliceHeads(dbPath: string): ReadonlyArray<PreparedSliceHead> {
    const db = openReadOnlyScoreDatabase(dbPath);
    try {
      const rows = db
        .prepare(
          `WITH latest AS (
             SELECT slice.slice_id, MAX(revision.revision) AS revision
             FROM prepared_slices slice
             JOIN prepared_slice_revisions revision ON revision.title = slice.title
             GROUP BY slice.slice_id
           )
           SELECT slice.slice_id AS sliceId,
                  COALESCE(revision.display_title, slice.title) AS title,
                  revision.revision,
                  revision.draft_digest AS draftDigest,
                  revision.source_path AS sourcePath,
                  revision.artifact_stem AS artifactStem,
                  revision.manifest_id AS manifestId,
                  revision.review_id AS reviewId,
                  pass.pass_id AS passId,
                  publication.review_id IS NOT NULL AS published,
                  specification.content_json AS acceptedSpecificationJson
           FROM latest
           JOIN prepared_slices slice ON slice.slice_id = latest.slice_id
           JOIN prepared_slice_revisions revision
             ON revision.title = slice.title
            AND revision.revision = latest.revision
           JOIN coding_passes pass ON pass.manifest_id = revision.manifest_id
           JOIN run_manifests manifest ON manifest.manifest_id = revision.manifest_id
           JOIN accepted_specifications specification
             ON specification.specification_id = manifest.specification_id
           LEFT JOIN prepared_slice_publications publication
             ON publication.title = revision.title
            AND publication.revision = revision.revision
            AND publication.review_id = revision.review_id
           ORDER BY slice.slice_id`
        )
        .all() as Array<
        Omit<
          PreparedSliceHead,
          "published" | "resolvedDependencies" | "acceptedSpecification"
        > & {
          published: number;
          acceptedSpecificationJson: string;
        }
      >;
      const dependencies = db
        .prepare(
          `SELECT dependent_manifest_id AS dependentManifestId,
                  prerequisite_slice_id AS slice_id,
                  prerequisite_revision AS revision,
                  prerequisite_pass_id AS pass_id,
                  prerequisite_run_id AS run_id
           FROM prepared_slice_dependencies
           ORDER BY dependent_manifest_id, prerequisite_slice_id`
        )
        .all() as Array<ResolvedSliceDependency & { dependentManifestId: string }>;
      const dependenciesByManifest = Map.groupBy(
        dependencies,
        (dependency) => dependency.dependentManifestId
      );
      return rows.map((row) => ({
        sliceId: row.sliceId,
        title: row.title,
        revision: row.revision,
        draftDigest: row.draftDigest,
        sourcePath: row.sourcePath,
        artifactStem: row.artifactStem,
        manifestId: row.manifestId,
        reviewId: row.reviewId,
        passId: row.passId,
        published: row.published === 1,
        acceptedSpecification: parseJson<unknown>(row.acceptedSpecificationJson),
        resolvedDependencies: (dependenciesByManifest.get(row.manifestId) ?? []).map(
          ({ slice_id, revision, pass_id, run_id }) => ({
            slice_id,
            revision,
            pass_id,
            run_id
          })
        )
      }));
    } finally {
      db.close();
    }
  }

  static readReviewedPlanRepositoryState(
    dbPath: string,
    passId: string
  ): ReviewedPlanRepositoryState {
    const db = openReadOnlyScoreDatabase(dbPath);
    try {
      const reviewed = db
        .prepare(
          `SELECT 1 AS present
           FROM coding_passes p
           JOIN publication_reviews pr ON pr.manifest_id = p.manifest_id
           LEFT JOIN prepared_slice_revisions prepared
             ON prepared.manifest_id = p.manifest_id
            AND prepared.review_id = pr.review_id
           LEFT JOIN prepared_slice_publications publication
             ON publication.title = prepared.title
            AND publication.revision = prepared.revision
            AND publication.review_id = prepared.review_id
           WHERE p.pass_id = ?
             AND (prepared.title IS NULL OR publication.review_id IS NOT NULL)
           LIMIT 1`
        )
        .get(passId) as { present: number } | undefined;
      if (!reviewed) throw new Error(`Reviewed work ${passId} has not been reviewed`);
      const allowedChanges = db
        .prepare(
          `SELECT target_path AS targetPath, operation
           FROM capsules
           WHERE pass_id = ?
           ORDER BY target_path`
        )
        .all(passId) as Array<{
        targetPath: string;
        operation: "create" | "replace" | "delete";
      }>;
      if (allowedChanges.length === 0) {
        throw new Error(`Reviewed work ${passId} has no File Briefs`);
      }
      return {
        passId,
        sourceSnapshot: readRepositorySourceSnapshot(db, passId),
        allowedChanges
      };
    } finally {
      db.close();
    }
  }

  static approveReviewedChangePlan(
    dbPath: string,
    input: {
      readonly plan: ReviewedChangePlan;
      readonly authority: string;
      readonly decidedAt: string;
    }
  ): { decision_id: string } {
    if (input.plan.approvalStatus !== "needs_approval") {
      throw new Error(`Reviewed work ${input.plan.label} is not ready for guided approval`);
    }
    if (
      input.plan.digestSet.pass.protocol_id !== input.plan.passId ||
      input.plan.warningCount !== 0
    ) {
      throw new Error(`Reviewed work ${input.plan.label} cannot use guided approval`);
    }
    const score = ScoreAlpha.open(dbPath);
    try {
      score.assertPreparedReviewPublished(input.plan.reviewId);
      return score.decidePublication({
        review_id: input.plan.reviewId,
        authority: input.authority,
        decided_at: input.decidedAt,
        decision: "approve",
        expected_digest_set: input.plan.digestSet,
        warning_waivers: [],
        rationale: "Approved through the guided Runner start flow."
      });
    } finally {
      score.close();
    }
  }

  findPreparedSliceRevision(
    sliceId: string,
    inputDigest: string
  ): PreparedSliceRevision | undefined {
    const row = this.db
      .prepare(
        `SELECT slice.title AS identityKey, slice.slice_id AS sliceId,
                COALESCE(revision.display_title, slice.title) AS displayTitle,
                slice.slug, revision.revision,
                revision.input_digest AS inputDigest,
                revision.draft_digest AS draftDigest,
                revision.source_path AS sourcePath,
                revision.manifest_id AS manifestId,
                revision.review_id AS reviewId,
                revision.artifact_stem AS artifactStem
         FROM prepared_slices slice
         JOIN prepared_slice_revisions revision ON revision.title = slice.title
         WHERE slice.slice_id = ? AND revision.input_digest = ?`
      )
      .get(sliceId, inputDigest) as PreparedSliceRevision | undefined;
    return row;
  }

  nextPreparedSliceRevision(
    sliceId: string,
    requestedSlug: string
  ): {
    readonly identityKey: string;
    readonly slug: string;
    readonly revision: number;
    readonly artifactStem: string;
  } {
    const existing = this.db
      .prepare("SELECT title AS identityKey, slug FROM prepared_slices WHERE slice_id = ?")
      .get(sliceId) as { identityKey: string; slug: string } | undefined;
    let identityKey = existing?.identityKey ?? `slice:${sliceId}`;
    let slug = existing?.slug ?? requestedSlug;
    if (!existing) {
      let identitySuffix = 2;
      while (
        this.db.prepare("SELECT 1 AS present FROM prepared_slices WHERE title = ?").get(identityKey)
      ) {
        identityKey = `slice:${sliceId}:${identitySuffix}`;
        identitySuffix += 1;
      }
      let suffix = 2;
      while (
        this.db.prepare("SELECT 1 AS present FROM prepared_slices WHERE slug = ?").get(slug)
      ) {
        slug = `${requestedSlug}-${suffix}`;
        suffix += 1;
      }
    }
    const row = this.db
      .prepare(
        "SELECT COALESCE(MAX(revision), 0) + 1 AS revision FROM prepared_slice_revisions WHERE title = ?"
      )
      .get(identityKey) as { revision: number };
    const revision = row.revision;
    return {
      identityKey,
      slug,
      revision,
      artifactStem: `${slug}-review${revision === 1 ? "" : `-v${revision}`}`
    };
  }

  recordPreparedSliceRevision(input: {
    readonly identityKey: string;
    readonly sliceId: string;
    readonly displayTitle: string;
    readonly slug: string;
    readonly revision: number;
    readonly inputDigest: string;
    readonly draftDigest: string;
    readonly sourcePath: string | null;
    readonly manifestId: string;
    readonly reviewId: string;
    readonly artifactStem: string;
    readonly createdAt: string;
  }): void {
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT OR IGNORE INTO prepared_slices(title, slug, created_at, slice_id)
           VALUES (?, ?, ?, ?)`
        )
        .run(input.identityKey, input.slug, input.createdAt, input.sliceId);
      this.db
        .prepare(
          `INSERT INTO prepared_slice_revisions
           (title, revision, input_digest, manifest_id, review_id, artifact_stem, created_at,
            display_title, draft_digest, source_path)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          input.identityKey,
          input.revision,
          input.inputDigest,
          input.manifestId,
          input.reviewId,
          input.artifactStem,
          input.createdAt,
          input.displayTitle,
          input.draftDigest,
          input.sourcePath
        );
    })();
  }

  recordPreparedSliceDependencies(
    manifestId: string,
    dependencies: ReadonlyArray<ResolvedSliceDependency>
  ): void {
    const insert = this.db.prepare(
      `INSERT INTO prepared_slice_dependencies
       (dependent_manifest_id, prerequisite_slice_id, prerequisite_revision,
        prerequisite_pass_id, prerequisite_run_id)
       VALUES (?, ?, ?, ?, ?)`
    );
    for (const dependency of dependencies) {
      insert.run(
        manifestId,
        dependency.slice_id,
        dependency.revision,
        dependency.pass_id,
        dependency.run_id
      );
    }
  }

  loadPreparedReview(manifestId: string): PublicationReviewResult {
    const review = this.loadReview(manifestId);
    if (!review) throw new Error(`Prepared slice Manifest ${manifestId} has no Plan Review`);
    return review;
  }

  markPreparedSlicePublished(input: {
    readonly revision: PreparedSliceRevision;
    readonly publishedAt: string;
  }): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO prepared_slice_publications
         (title, revision, review_id, published_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(
        input.revision.identityKey,
        input.revision.revision,
        input.revision.reviewId,
        input.publishedAt
      );
    this.assertPreparedReviewPublished(input.revision.reviewId);
  }

  private assertPreparedReviewPublished(reviewId: string): void {
    const prepared = this.db
      .prepare(
        `SELECT publication.review_id AS publishedReviewId
         FROM prepared_slice_revisions revision
         LEFT JOIN prepared_slice_publications publication
           ON publication.title = revision.title
          AND publication.revision = revision.revision
          AND publication.review_id = revision.review_id
         WHERE revision.review_id = ?`
      )
      .get(reviewId) as { publishedReviewId: string | null } | undefined;
    if (prepared && prepared.publishedReviewId === null) {
      throw new Error(`Prepared slice review ${reviewId} has not published its artifact pair`);
    }
  }

  private assertPreparedPassPublished(passId: string): void {
    const review = this.db
      .prepare(
        `SELECT publication.review_id AS reviewId
         FROM coding_passes pass
         JOIN publication_reviews publication ON publication.manifest_id = pass.manifest_id
         WHERE pass.pass_id = ?`
      )
      .get(passId) as { reviewId: string } | undefined;
    if (review) this.assertPreparedReviewPublished(review.reviewId);
  }

  materializePreparedSliceRevision(input: {
    readonly sliceId: string;
    readonly displayTitle: string;
    readonly requestedSlug: string;
    readonly inputDigest: string;
    readonly draftDigest: string;
    readonly sourcePath: string | null;
    readonly resolvedDependencies: ReadonlyArray<ResolvedSliceDependency>;
    readonly acceptedInputs: AcceptedInputPacket;
    readonly bundle: CompilationBundle;
    readonly submissionMetadata: SubmissionMetadata;
    readonly createdAt: string;
    readonly reviewKind?: Exclude<ReviewKind, "plan">;
  }): PreparedSliceMaterializationResult {
    const materialize = this.db.transaction((): PreparedSliceMaterializationResult => {
      const existing = this.findPreparedSliceRevision(input.sliceId, input.inputDigest);
      if (existing) {
        return {
          status: "review_ready",
          revision: existing,
          review: this.loadPreparedReview(existing.manifestId)
        };
      }
      const next = this.nextPreparedSliceRevision(input.sliceId, input.requestedSlug);
      this.initializeAcceptedInputs(input.acceptedInputs);
      const submission = this.submitCompilation(input.bundle, input.submissionMetadata);
      if (submission.outcome === "invalid" || !submission.manifest_id) {
        return { status: "invalid", submission };
      }
      const snapshotName = `${next.artifactStem}.snapshot.json`;
      const review = this.prepareReview(submission.manifest_id, input.createdAt, {
        snapshotHref: `./${snapshotName}`,
        includeProofLinks: false,
        reviewKind: input.reviewKind ?? "slice"
      });
      const revision: PreparedSliceRevision = {
        identityKey: next.identityKey,
        sliceId: input.sliceId,
        displayTitle: input.displayTitle,
        slug: next.slug,
        revision: next.revision,
        inputDigest: input.inputDigest,
        draftDigest: input.draftDigest,
        sourcePath: input.sourcePath,
        manifestId: submission.manifest_id,
        reviewId: review.review_id,
        artifactStem: next.artifactStem
      };
      this.recordPreparedSliceRevision({
        ...revision,
        draftDigest: input.draftDigest,
        createdAt: input.createdAt
      });
      this.recordPreparedSliceDependencies(
        submission.manifest_id,
        input.resolvedDependencies
      );
      return {
        status: "review_ready",
        revision,
        review: this.loadPreparedReview(submission.manifest_id)
      };
    });
    return materialize.immediate();
  }

  private applyMigrations(): void {
    const migrationTableExists = this.db
      .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
      .get() as { present: number } | undefined;
    if (!migrationTableExists) {
      const migration = readFileSync(join(PACKAGE_ROOT, "migrations", "001_initial.sql"), "utf8");
      this.db.exec(migration);
      this.db
        .prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)")
        .run(1, "001_initial", "2026-08-05T20:00:00.000Z");
    }
    const latest = this.db
      .prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations")
      .get() as { version: number };
    if (latest.version < 2) {
      const migration = readFileSync(
        join(PACKAGE_ROOT, "migrations", "002_declaration_registry.sql"),
        "utf8"
      );
      this.db.transaction(() => {
        this.db.exec(migration);
        this.db
          .prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)")
          .run(2, "002_declaration_registry", "2026-08-06T20:00:00.000Z");
      })();
    }
    if (latest.version < 3) {
      const migration = readFileSync(
        join(PACKAGE_ROOT, "migrations", "003_declaration_registry_view.sql"),
        "utf8"
      );
      this.db.transaction(() => {
        this.db.exec(migration);
        this.db
          .prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)")
          .run(3, "003_declaration_registry_view", "2026-08-06T20:30:00.000Z");
      })();
    }
    if (latest.version < 4) {
      const repositoryCount = this.db
        .prepare("SELECT COUNT(*) AS count FROM repository_revisions")
        .get() as { count: number };
      if (repositoryCount.count > 0) {
        throw new Error(
          "Cannot upgrade a populated pre-Project-Settings database; reproduce it from accepted inputs in a new database"
        );
      }
      const migration = readFileSync(
        join(PACKAGE_ROOT, "migrations", "004_repository_project_settings.sql"),
        "utf8"
      );
      this.db.transaction(() => {
        this.db.exec(migration);
        this.db
          .prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)")
          .run(4, "004_repository_project_settings", "2026-08-07T05:00:00.000Z");
      })();
    }
    if (latest.version < 5) {
      const migration = readFileSync(
        join(PACKAGE_ROOT, "migrations", "005_plan_intake_revisions.sql"),
        "utf8"
      );
      this.db.transaction(() => {
        this.db.exec(migration);
        this.db
          .prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)")
          .run(5, "005_plan_intake_revisions", "2026-08-07T20:00:00.000Z");
      })();
    }
    if (latest.version < 6) {
      const migration = readFileSync(
        join(PACKAGE_ROOT, "migrations", "006_prepared_slice_publications.sql"),
        "utf8"
      );
      this.db.transaction(() => {
        this.db.exec(migration);
        this.db
          .prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)")
          .run(6, "006_prepared_slice_publications", "2026-08-07T22:00:00.000Z");
      })();
    }
    if (latest.version < 7) {
      const migration = readFileSync(
        join(PACKAGE_ROOT, "migrations", "007_slice_identity_dependencies.sql"),
        "utf8"
      );
      this.db.transaction(() => {
        this.db.exec(migration);
        this.db
          .prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)")
          .run(7, "007_slice_identity_dependencies", "2026-08-09T19:00:00.000Z");
      })();
    }
    for (const table of IMMUTABLE_TABLES) {
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS ${table}_reject_update
        BEFORE UPDATE ON ${table}
        BEGIN
          SELECT RAISE(ABORT, '${table} is append-only');
        END;
        CREATE TRIGGER IF NOT EXISTS ${table}_reject_delete
        BEFORE DELETE ON ${table}
        BEGIN
          SELECT RAISE(ABORT, '${table} is append-only');
        END;
      `);
    }
  }

  initializeAcceptedInputs(inputs: AcceptedInputPacket): void {
    const repositoryDigest = repositoryRevisionContentDigest({
      orderedManifest: inputs.repository_revision.ordered_manifest
    });
    if (repositoryDigest !== inputs.repository_revision.content_digest) {
      throw new Error("Repository Revision digest does not match its ordered manifest");
    }
    const existing = this.db
      .prepare("SELECT content_digest FROM accepted_specifications WHERE specification_id = ?")
      .get(inputs.accepted_specification.protocol_id) as { content_digest: string } | undefined;
    if (existing) {
      if (existing.content_digest !== inputs.accepted_specification.content_digest) {
        throw new Error("Existing accepted specification digest does not match the compiler input packet");
      }
      const procedure = this.db
        .prepare("SELECT content_digest FROM compilation_procedures WHERE procedure_id = ?")
        .get(inputs.compilation_procedure.protocol_id) as
        | { content_digest: string }
        | undefined;
      const compilerInput = this.db
        .prepare(
          "SELECT content_digest FROM compiler_input_revisions WHERE compiler_input_revision_id = ?"
        )
        .get(inputs.compiler_input_revision.protocol_id) as
        | { content_digest: string }
        | undefined;
      const repository = this.db
        .prepare("SELECT content_digest FROM repository_revisions WHERE revision_id = ?")
        .get(inputs.repository_revision.protocol_id) as
        | { content_digest: string }
        | undefined;
      if (
        procedure?.content_digest !== inputs.compilation_procedure.content_digest ||
        compilerInput?.content_digest !== inputs.compiler_input_revision.content_digest ||
        repository?.content_digest !== inputs.repository_revision.content_digest
      ) {
        throw new Error(
          "SCORE database is already initialized with a different accepted input set"
        );
      }
      this.acceptedInputs = inputs;
      return;
    }

    const insert = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO accepted_specifications
           (specification_id, authority, accepted_at, content_json, content_digest)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(
          inputs.accepted_specification.protocol_id,
          inputs.accepted_specification.authority,
          inputs.accepted_specification.accepted_at,
          canonicalJson(inputs.accepted_specification.content),
          inputs.accepted_specification.content_digest
        );
      const requirementInsert = this.db.prepare(
        `INSERT INTO accepted_requirements
         (requirement_id, specification_id, label, statement, content_digest)
         VALUES (?, ?, ?, ?, ?)`
      );
      for (const requirement of inputs.accepted_requirements) {
        requirementInsert.run(
          requirement.protocol_id,
          inputs.accepted_specification.protocol_id,
          requirement.label,
          requirement.statement,
          requirement.content_digest
        );
      }
      const existingProcedure = this.db
        .prepare(
          `SELECT procedure_id, content_digest FROM compilation_procedures
           WHERE name = ? AND version = ? AND profile = ?`
        )
        .get(
          inputs.compilation_procedure.name,
          inputs.compilation_procedure.version,
          inputs.compilation_procedure.profile
        ) as { procedure_id: string; content_digest: string } | undefined;
      if (existingProcedure) {
        if (
          existingProcedure.procedure_id !== inputs.compilation_procedure.protocol_id ||
          existingProcedure.content_digest !== inputs.compilation_procedure.content_digest
        ) {
          throw new Error("Existing Compilation Procedure does not match the accepted input packet");
        }
      } else {
        this.db
          .prepare(
            `INSERT INTO compilation_procedures
             (procedure_id, name, version, profile, source, content, content_digest)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            inputs.compilation_procedure.protocol_id,
            inputs.compilation_procedure.name,
            inputs.compilation_procedure.version,
            inputs.compilation_procedure.profile,
            inputs.compilation_procedure.source,
            inputs.compilation_procedure.content,
            inputs.compilation_procedure.content_digest
          );
      }
      this.db
        .prepare(
          `INSERT INTO compiler_input_revisions
           (compiler_input_revision_id, authority, accepted_at, content_json, content_digest)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(
          inputs.compiler_input_revision.protocol_id,
          inputs.compiler_input_revision.authority,
          inputs.compiler_input_revision.accepted_at,
          canonicalJson(inputs.compiler_input_revision.content),
          inputs.compiler_input_revision.content_digest
        );
      this.db
        .prepare(
          `INSERT INTO repository_revisions
           (revision_id, label, ordered_manifest_json, content_digest)
           VALUES (?, ?, ?, ?)`
        )
        .run(
          inputs.repository_revision.protocol_id,
          inputs.repository_revision.label,
          canonicalJson(inputs.repository_revision.ordered_manifest),
          inputs.repository_revision.content_digest
        );
      const fileInsert = this.db.prepare(
        `INSERT INTO repository_revision_files
         (revision_id, normalized_path, media_type, content, content_digest)
         VALUES (?, ?, ?, ?, ?)`
      );
      for (const file of inputs.repository_revision.files) {
        fileInsert.run(
          inputs.repository_revision.protocol_id,
          file.path,
          file.media_type,
          Buffer.from(file.content, "utf8"),
          file.content_digest
        );
      }
      const absenceInsert = this.db.prepare(
        "INSERT INTO repository_revision_absences(revision_id, normalized_path) VALUES (?, ?)"
      );
      for (const absentPath of inputs.repository_revision.absent_paths) {
        absenceInsert.run(inputs.repository_revision.protocol_id, absentPath);
      }
    });
    insert();
    this.acceptedInputs = inputs;
  }

  submitCompilation(bundle: unknown, metadata: SubmissionMetadata): SubmissionResult {
    if (!this.acceptedInputs) {
      throw new Error("Accepted compiler inputs must be initialized before submission");
    }
    const bundleJson = canonicalJson(bundle);
    const bundleDigest = sha256Json(bundle);
    const findings = validateCompilationBundle(bundle, this.acceptedInputs);
    const outcome = hasBlockingFindings(findings) ? "invalid" : "valid";
    const submissionSequence = countRow(this.db, "compilation_submissions") + 1;
    const submissionId = opaqueId(
      "submission",
      String(submissionSequence),
      metadata.label,
      bundleDigest
    );
    const typedBundle = outcome === "valid" ? (bundle as CompilationBundle) : undefined;
    const manifestId = typedBundle
      ? opaqueId(submissionId, "manifest", typedBundle.proposed_definition.manifest.handle)
      : undefined;

    const insertSubmission = (
      persistedOutcome: "valid" | "invalid",
      persistedFindings: ValidationFinding[],
      importedManifestId?: string,
      importBundle?: CompilationBundle
    ): void => {
      this.db
        .prepare(
          `INSERT INTO compilation_submissions
           (submission_id, submission_sequence, label, bundle_json, bundle_digest, compiler_name, model_id,
            procedure_id, procedure_digest, compiler_input_revision_id, received_at,
            outcome, prior_submission_id, imported_manifest_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          submissionId,
          submissionSequence,
          metadata.label,
          bundleJson,
          bundleDigest,
          metadata.compiler_name,
          metadata.model_id,
          this.acceptedInputs?.compilation_procedure.protocol_id,
          this.acceptedInputs?.compilation_procedure.content_digest,
          this.acceptedInputs?.compiler_input_revision.protocol_id,
          metadata.received_at,
          persistedOutcome,
          metadata.prior_submission_id ?? null,
          importedManifestId ?? null
        );
      const findingInsert = this.db.prepare(
        `INSERT INTO compilation_submission_findings
         (finding_id, submission_id, validator_id, validator_version, code, severity,
          finding_kind, location, message, detail_json, machine_repairable, requires_human_input, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      persistedFindings.forEach((finding, index) => {
        findingInsert.run(
          opaqueId(submissionId, "finding", String(index), finding.code),
          submissionId,
          finding.kind === "deterministic_validation" ? VALIDATOR_ID : "compiler-provided",
          VALIDATOR_VERSION,
          finding.code,
          finding.severity,
          finding.kind,
          finding.location,
          finding.message,
          canonicalJson(finding.detail),
          finding.machine_repairable ? 1 : 0,
          finding.requires_human_input ? 1 : 0,
          index
        );
      });
      if (importBundle && importedManifestId) {
        this.importDefinition(submissionId, importedManifestId, importBundle);
      }
    };

    let persistedOutcome: "valid" | "invalid" = outcome;
    let persistedFindings = findings;
    let persistedManifestId = manifestId;
    try {
      this.db
        .transaction(() => insertSubmission(outcome, findings, manifestId, typedBundle))();
    } catch (error) {
      if (!typedBundle) throw error;
      const importFinding: ValidationFinding = {
        kind: "deterministic_validation",
        code: "IMPORT_MATERIALIZATION_FAILED",
        severity: "error",
        location: "/proposed_definition",
        message: "The validated Bundle could not be atomically imported into the relational model",
        detail: {
          error_name: error instanceof Error ? error.name : "UnknownError",
          error_message: error instanceof Error ? error.message : String(error)
        },
        machine_repairable: false,
        requires_human_input: false
      };
      persistedOutcome = "invalid";
      persistedFindings = [...findings, importFinding];
      persistedManifestId = undefined;
      this.db
        .transaction(() => insertSubmission("invalid", persistedFindings))();
    }

    return {
      submission_id: submissionId,
      bundle_digest: bundleDigest,
      outcome: persistedOutcome,
      findings: persistedFindings,
      ...(persistedManifestId ? { manifest_id: persistedManifestId } : {})
    };
  }

  private importDefinition(
    submissionId: string,
    manifestId: string,
    bundle: CompilationBundle
  ): void {
    const definition = bundle.proposed_definition;
    const ids = new Map<string, string>();
    const register = (kind: string, handle: string): string => {
      const id = opaqueId(submissionId, kind, handle);
      ids.set(mapKey(kind, handle), id);
      return id;
    };
    const id = (kind: string, handle: string): string => {
      const value = ids.get(mapKey(kind, handle));
      if (!value) throw new Error(`No imported identity for ${kind} ${handle}`);
      return value;
    };

    ids.set(mapKey("manifest", definition.manifest.handle), manifestId);
    register("compilation_report", definition.compilation_report.handle);
    register("contract_set", definition.contract_set.handle);
    register("coding_pass", definition.coding_pass.handle);
    for (const value of definition.contracts) register("contract", value.handle);
    for (const value of definition.contract_inputs) register("contract_input", value.handle);
    for (const value of definition.dependencies) register("dependency", value.handle);
    for (const value of definition.context_items) register("context_item", value.handle);
    for (const value of definition.context_sets) register("context_set", value.handle);
    for (const value of definition.capsules) register("capsule", value.handle);
    for (const value of definition.capability_requirements) register("capability_requirement", value.handle);
    for (const value of definition.source_citations) register("source_citation", value.handle);

    const manifestDigest = sha256Json({
      schema: bundle.schema,
      schema_version: bundle.schema_version,
      profile: bundle.profile,
      profile_version: bundle.profile_version,
      source_bindings: bundle.source_bindings,
      proposed_definition: definition
    });
    this.db
      .prepare(
        `INSERT INTO run_manifests
         (manifest_id, submission_id, specification_id, compiler_input_revision_id,
          label, objective, rationale, definition_json, content_digest)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        manifestId,
        submissionId,
        bundle.source_bindings.accepted_specification.protocol_id,
        bundle.source_bindings.compiler_input_revision.protocol_id,
        definition.manifest.label,
        definition.manifest.objective,
        definition.manifest.rationale,
        canonicalJson(definition),
        manifestDigest
      );

    const reportId = id("compilation_report", definition.compilation_report.handle);
    const reportJson = {
      summary: definition.compilation_report.summary,
      requirement_traceability: definition.requirement_traceability,
      source_citations: definition.source_citations,
      source_bindings: definition.source_bindings,
      compiler_findings: bundle.compiler_findings
    };
    this.db
      .prepare(
        `INSERT INTO compilation_reports(report_id, manifest_id, summary, report_json, content_digest)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        reportId,
        manifestId,
        definition.compilation_report.summary,
        canonicalJson(reportJson),
        sha256Json(reportJson)
      );

    const contractSetId = id("contract_set", definition.contract_set.handle);
    this.db
      .prepare(
        `INSERT INTO contract_sets
         (contract_set_id, manifest_id, logical_name, version, purpose, content_digest)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        contractSetId,
        manifestId,
        definition.contract_set.logical_name,
        definition.contract_set.version,
        definition.contract_set.purpose,
        sha256Json(definition.contract_set)
      );
    const contractInsert = this.db.prepare(
      `INSERT INTO contracts
       (contract_id, contract_set_id, logical_name, version, kind, content_json, content_digest)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const contract of definition.contracts) {
      contractInsert.run(
        id("contract", contract.handle),
        contractSetId,
        contract.logical_name,
        contract.version,
        contract.kind,
        canonicalJson(contract.content),
        sha256Json(contract)
      );
    }
    const inputInsert = this.db.prepare(
      `INSERT INTO contract_inputs
       (contract_input_id, contract_id, logical_name, required, expected_kind, version_rule,
        min_cardinality, max_cardinality, purpose, content_digest)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const input of definition.contract_inputs) {
      inputInsert.run(
        id("contract_input", input.handle),
        id("contract", input.contract_handle),
        input.logical_name,
        input.required ? 1 : 0,
        input.expected_kind,
        input.version_rule,
        input.min_cardinality,
        input.max_cardinality,
        input.purpose,
        sha256Json(input)
      );
    }

    const passId = id("coding_pass", definition.coding_pass.handle);
    this.db
      .prepare(
        `INSERT INTO coding_passes
         (pass_id, manifest_id, base_revision_id, contract_set_id, objective, content_digest)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        passId,
        manifestId,
        bundle.source_bindings.repository_revision.protocol_id,
        contractSetId,
        definition.coding_pass.objective,
        sha256Json(definition.coding_pass)
      );

    const itemInsert = this.db.prepare(
      `INSERT INTO context_items
       (context_item_id, manifest_id, kind, version, purpose, source_json, resolution, content_json, content_digest)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const item of definition.context_items) {
      itemInsert.run(
        id("context_item", item.handle),
        manifestId,
        item.kind,
        item.version,
        item.purpose,
        canonicalJson(item.source),
        item.resolution,
        canonicalJson(item.content),
        sha256Json(item)
      );
    }
    const contextSetInsert = this.db.prepare(
      "INSERT INTO context_sets(context_set_id, manifest_id, content_digest) VALUES (?, ?, ?)"
    );
    const membershipInsert = this.db.prepare(
      `INSERT INTO context_set_items(context_set_id, context_item_id, position) VALUES (?, ?, ?)`
    );
    for (const contextSet of definition.context_sets) {
      const contextSetId = id("context_set", contextSet.handle);
      contextSetInsert.run(contextSetId, manifestId, sha256Json(contextSet));
      contextSet.member_handles.forEach((memberHandle, position) =>
        membershipInsert.run(contextSetId, id("context_item", memberHandle), position)
      );
    }

    const capsuleInsert = this.db.prepare(
      `INSERT INTO capsules
       (capsule_id, pass_id, context_set_id, target_path, operation, objective,
        intended_outcome, constraints_json, prohibited_effects_json, content_digest)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const capsule of definition.capsules) {
      capsuleInsert.run(
        id("capsule", capsule.handle),
        passId,
        id("context_set", capsule.context_set_handle),
        capsule.target_path,
        capsule.operation,
        capsule.objective,
        capsule.intended_outcome,
        canonicalJson(capsule.constraints),
        canonicalJson(capsule.prohibited_effects),
        sha256Json(capsule)
      );
    }

    const dependencyInsert = this.db.prepare(
      `INSERT INTO dependencies
       (dependency_id, pass_id, dependent_capsule_id, prerequisite_kind,
        prerequisite_id, description, content_digest)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const dependency of definition.dependencies) {
      dependencyInsert.run(
        id("dependency", dependency.handle),
        passId,
        id("capsule", dependency.dependent_capsule_handle),
        dependency.prerequisite_kind,
        id(dependency.prerequisite_kind, dependency.prerequisite_handle),
        dependency.description,
        sha256Json(dependency)
      );
    }
    const roleInsert = this.db.prepare(
      "INSERT INTO capsule_contract_roles(capsule_id, contract_id, role) VALUES (?, ?, ?)"
    );
    for (const role of definition.capsule_contract_roles) {
      roleInsert.run(id("capsule", role.capsule_handle), id("contract", role.contract_handle), role.role);
    }
    const bindingInsert = this.db.prepare(
      `INSERT INTO contract_input_bindings
       (capsule_id, contract_input_id, context_item_id, actual_kind,
        actual_version, position, content_digest)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const binding of definition.contract_input_bindings) {
      bindingInsert.run(
        id("capsule", binding.capsule_handle),
        id("contract_input", binding.contract_input_handle),
        id("context_item", binding.context_item_handle),
        binding.actual_kind,
        binding.actual_version,
        binding.position,
        sha256Json(binding)
      );
    }
    const capabilityInsert = this.db.prepare(
      `INSERT INTO capability_requirements
       (capability_requirement_id, capsule_id, capability, version_rule,
        required, configuration_json, content_digest)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const capability of definition.capability_requirements) {
      capabilityInsert.run(
        id("capability_requirement", capability.handle),
        id("capsule", capability.capsule_handle),
        capability.capability,
        capability.version_rule,
        capability.required ? 1 : 0,
        canonicalJson(capability.configuration),
        sha256Json(capability)
      );
    }

    const requirementInsert = this.db.prepare(
      `INSERT INTO requirement_bindings
       (requirement_id, report_id, target_kind, target_id, position, content_digest)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const trace of definition.requirement_traceability) {
      const targetGroups: Array<["contract" | "capsule" | "dependency" | "context_item", string[]]> = [
        ["contract", trace.contract_handles],
        ["capsule", trace.capsule_handles],
        ["dependency", trace.dependency_handles],
        ["context_item", trace.context_item_handles]
      ];
      let position = 0;
      for (const [kind, handles] of targetGroups) {
        for (const handle of handles) {
          const edge = { requirement_id: trace.requirement_protocol_id, target_kind: kind, target_handle: handle };
          requirementInsert.run(
            trace.requirement_protocol_id,
            reportId,
            kind,
            id(kind, handle),
            position,
            sha256Json(edge)
          );
          position += 1;
        }
      }
    }

    const citationInsert = this.db.prepare(
      `INSERT INTO compilation_source_citations
       (citation_id, report_id, repository_revision_id, location, source_digest,
        purpose, excerpt, citation_digest)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const citation of definition.source_citations) {
      citationInsert.run(
        id("source_citation", citation.handle),
        reportId,
        citation.repository_revision_protocol_id,
        citation.location,
        citation.source_digest,
        citation.purpose,
        citation.excerpt,
        sha256Json(citation)
      );
    }
    const sourceBindingInsert = this.db.prepare(
      `INSERT INTO compilation_source_bindings
       (citation_id, target_kind, target_id, purpose, content_digest)
       VALUES (?, ?, ?, ?, ?)`
    );
    for (const binding of definition.source_bindings) {
      sourceBindingInsert.run(
        id("source_citation", binding.citation_handle),
        binding.target_kind,
        id(binding.target_kind, binding.target_handle),
        binding.purpose,
        sha256Json(binding)
      );
    }

    const mappingInsert = this.db.prepare(
      `INSERT INTO object_handle_mappings(submission_id, object_kind, local_handle, protocol_id)
       VALUES (?, ?, ?, ?)`
    );
    for (const [key, protocolId] of ids) {
      const [kind, localHandle] = key.split("\u0000");
      if (!kind || !localHandle) throw new Error("Invalid local-handle mapping key");
      mappingInsert.run(submissionId, kind, localHandle, protocolId);
    }
  }

  private validatePersistedDefinition(manifestId: string): ValidationFinding[] {
    const findings: ValidationFinding[] = [];
    const passes = this.db
      .prepare(
        `SELECT pass_id, base_revision_id
         FROM coding_passes WHERE manifest_id = ? ORDER BY pass_id`
      )
      .all(manifestId) as Array<{ pass_id: string; base_revision_id: string }>;
    if (passes.length !== 1) {
      findings.push(
        publicationIssue(
          "PUBLICATION_PASS_COUNT_INVALID",
          "/coding_passes",
          "The persisted Manifest must own exactly one Coding Pass",
          { actual: passes.length, expected: 1 }
        )
      );
      return findings;
    }

    const pass = passes[0]!;
    const repositoryRevision = this.db
      .prepare(
        `SELECT rr.ordered_manifest_json, rr.content_digest AS revision_digest
         FROM repository_revisions rr
         WHERE rr.revision_id = ?`
      )
      .get(pass.base_revision_id) as
      | {
          ordered_manifest_json: string;
          revision_digest: string;
        }
      | undefined;
    if (!repositoryRevision) {
      findings.push(
        publicationIssue(
          "PUBLICATION_SOURCE_SNAPSHOT_MISSING",
          `/repository_revisions/${pass.base_revision_id}`,
          "The reviewed work has no Source Snapshot"
        )
      );
    } else if (
      repositoryRevisionContentDigest({
        orderedManifest: parseJson<unknown>(repositoryRevision.ordered_manifest_json)
      }) !== repositoryRevision.revision_digest
    ) {
      findings.push(
        publicationIssue(
          "PUBLICATION_SOURCE_SNAPSHOT_DIGEST_MISMATCH",
          `/repository_revisions/${pass.base_revision_id}`,
          "The stored Source Snapshot digest does not reproduce"
        )
      );
    }
    const capsules = this.db
      .prepare(
        `SELECT capsule_id, context_set_id, target_path, operation
         FROM capsules WHERE pass_id = ? ORDER BY target_path`
      )
      .all(pass.pass_id) as Array<{
      capsule_id: string;
      context_set_id: string;
      target_path: string;
      operation: "create" | "replace" | "delete";
    }>;
    for (const capsule of capsules) {
      const present = this.db
        .prepare(
          `SELECT 1 AS present FROM repository_revision_files
           WHERE revision_id = ? AND normalized_path = ?`
        )
        .get(pass.base_revision_id, capsule.target_path) as { present: number } | undefined;
      const declaredAbsent = this.db
        .prepare(
          `SELECT 1 AS present FROM repository_revision_absences
           WHERE revision_id = ? AND normalized_path = ?`
        )
        .get(pass.base_revision_id, capsule.target_path) as { present: number } | undefined;
      if (capsule.operation === "replace" && !present) {
        findings.push(
          publicationIssue(
            "PUBLICATION_REPLACE_TARGET_ABSENT",
            `/capsules/${capsule.capsule_id}`,
            `Persisted replace target ${capsule.target_path} is absent from the stored base revision`
          )
        );
      }
      if (capsule.operation === "create" && (present || !declaredAbsent)) {
        findings.push(
          publicationIssue(
            "PUBLICATION_CREATE_TARGET_NOT_DECLARED_ABSENT",
            `/capsules/${capsule.capsule_id}`,
            `Persisted create target ${capsule.target_path} is not proven absent in the stored base revision`,
            { file_present: Boolean(present), absence_declared: Boolean(declaredAbsent) }
          )
        );
      }
    }

    const inputCardinalities = this.db
      .prepare(
        `SELECT c.capsule_id, ci.contract_input_id, ci.logical_name,
                ci.min_cardinality, ci.max_cardinality,
                COUNT(b.context_item_id) AS actual_count
         FROM capsules c
         JOIN coding_passes p ON p.pass_id = c.pass_id
         JOIN capsule_contract_roles role ON role.capsule_id = c.capsule_id
         JOIN contract_inputs ci ON ci.contract_id = role.contract_id
         LEFT JOIN contract_input_bindings b
           ON b.capsule_id = c.capsule_id
          AND b.contract_input_id = ci.contract_input_id
         WHERE p.manifest_id = ?
         GROUP BY c.capsule_id, ci.contract_input_id
         ORDER BY c.capsule_id, ci.logical_name`
      )
      .all(manifestId) as Array<{
      capsule_id: string;
      contract_input_id: string;
      logical_name: string;
      min_cardinality: number;
      max_cardinality: number;
      actual_count: number;
    }>;
    for (const input of inputCardinalities) {
      if (
        input.actual_count < input.min_cardinality ||
        input.actual_count > input.max_cardinality
      ) {
        findings.push(
          publicationIssue(
            "PUBLICATION_INPUT_CARDINALITY_INVALID",
            `/capsules/${input.capsule_id}/contract_inputs/${input.contract_input_id}`,
            `Persisted binding count for ${input.logical_name} is outside its Contract Input cardinality`,
            {
              minimum: input.min_cardinality,
              maximum: input.max_cardinality,
              actual: input.actual_count
            }
          )
        );
      }
    }

    const bindings = this.db
      .prepare(
        `SELECT b.capsule_id, b.contract_input_id, b.context_item_id,
                b.actual_kind, b.actual_version,
                ci.contract_id, ci.expected_kind, ci.version_rule,
                item.kind AS item_kind, item.version AS item_version,
                role.contract_id AS assigned_contract_id,
                member.context_item_id AS member_context_item_id
         FROM contract_input_bindings b
         JOIN capsules c ON c.capsule_id = b.capsule_id
         JOIN coding_passes p ON p.pass_id = c.pass_id
         JOIN contract_inputs ci ON ci.contract_input_id = b.contract_input_id
         JOIN context_items item ON item.context_item_id = b.context_item_id
         LEFT JOIN capsule_contract_roles role
           ON role.capsule_id = b.capsule_id AND role.contract_id = ci.contract_id
         LEFT JOIN context_set_items member
           ON member.context_set_id = c.context_set_id
          AND member.context_item_id = b.context_item_id
         WHERE p.manifest_id = ?
         ORDER BY b.capsule_id, b.contract_input_id, b.position`
      )
      .all(manifestId) as Array<{
      capsule_id: string;
      contract_input_id: string;
      context_item_id: string;
      actual_kind: string;
      actual_version: string;
      contract_id: string;
      expected_kind: string;
      version_rule: string;
      item_kind: string;
      item_version: string;
      assigned_contract_id: string | null;
      member_context_item_id: string | null;
    }>;
    for (const binding of bindings) {
      if (!binding.assigned_contract_id) {
        findings.push(
          publicationIssue(
            "PUBLICATION_INPUT_CONTRACT_NOT_ASSIGNED",
            `/capsules/${binding.capsule_id}/contract_inputs/${binding.contract_input_id}`,
            "A persisted Contract Input binding belongs to a Contract not assigned to its Capsule"
          )
        );
      }
      if (!binding.member_context_item_id) {
        findings.push(
          publicationIssue(
            "PUBLICATION_BINDING_OUTSIDE_CONTEXT_SET",
            `/capsules/${binding.capsule_id}/context_items/${binding.context_item_id}`,
            "A persisted binding supplier is outside the Capsule Context Set"
          )
        );
      }
      const versionMatches =
        binding.version_rule === "*" ||
        (binding.version_rule.startsWith("=") &&
          binding.version_rule.slice(1) === binding.actual_version);
      if (
        binding.actual_kind !== binding.expected_kind ||
        binding.actual_kind !== binding.item_kind ||
        binding.actual_version !== binding.item_version ||
        !versionMatches
      ) {
        findings.push(
          publicationIssue(
            "PUBLICATION_BINDING_COMPATIBILITY_INVALID",
            `/capsules/${binding.capsule_id}/contract_inputs/${binding.contract_input_id}`,
            "A persisted Contract Input binding is incompatible with its Input or Context Item",
            {
              actual_kind: binding.actual_kind,
              expected_kind: binding.expected_kind,
              item_kind: binding.item_kind,
              actual_version: binding.actual_version,
              item_version: binding.item_version,
              version_rule: binding.version_rule
            }
          )
        );
      }
    }

    const unboundMembers = this.db
      .prepare(
        `SELECT c.capsule_id, member.context_item_id
         FROM capsules c
         JOIN coding_passes p ON p.pass_id = c.pass_id
         JOIN context_set_items member ON member.context_set_id = c.context_set_id
         LEFT JOIN contract_input_bindings b
           ON b.capsule_id = c.capsule_id
          AND b.context_item_id = member.context_item_id
         WHERE p.manifest_id = ? AND b.context_item_id IS NULL
         ORDER BY c.capsule_id, member.position`
      )
      .all(manifestId) as Array<{ capsule_id: string; context_item_id: string }>;
    for (const member of unboundMembers) {
      findings.push(
        publicationIssue(
          "PUBLICATION_CONTEXT_ITEM_UNBOUND",
          `/capsules/${member.capsule_id}/context_items/${member.context_item_id}`,
          "A persisted Context Set member has no explicit Contract Input binding"
        )
      );
    }

    const requirementRows = this.db
      .prepare(
        `SELECT ar.requirement_id, COUNT(rb.target_id) AS binding_count
         FROM run_manifests m
         JOIN accepted_requirements ar ON ar.specification_id = m.specification_id
         JOIN compilation_reports report ON report.manifest_id = m.manifest_id
         LEFT JOIN requirement_bindings rb
           ON rb.report_id = report.report_id
          AND rb.requirement_id = ar.requirement_id
         WHERE m.manifest_id = ?
         GROUP BY ar.requirement_id
         ORDER BY ar.requirement_id`
      )
      .all(manifestId) as Array<{ requirement_id: string; binding_count: number }>;
    for (const requirement of requirementRows) {
      if (requirement.binding_count === 0) {
        findings.push(
          publicationIssue(
            "PUBLICATION_REQUIREMENT_UNTRACED",
            `/accepted_requirements/${requirement.requirement_id}`,
            "An Accepted Requirement has no persisted implementation path"
          )
        );
      }
    }

    const traceRows = this.db
      .prepare(
        `SELECT rb.requirement_id, rb.target_kind, rb.target_id
         FROM requirement_bindings rb
         JOIN compilation_reports report ON report.report_id = rb.report_id
         WHERE report.manifest_id = ?
         ORDER BY rb.requirement_id, rb.position`
      )
      .all(manifestId) as Array<{
      requirement_id: string;
      target_kind: "contract" | "capsule" | "dependency" | "context_item";
      target_id: string;
    }>;
    const targetTables = {
      contract: ["contracts", "contract_id"],
      capsule: ["capsules", "capsule_id"],
      dependency: ["dependencies", "dependency_id"],
      context_item: ["context_items", "context_item_id"]
    } as const;
    for (const trace of traceRows) {
      const [table, column] = targetTables[trace.target_kind];
      const exists = this.db
        .prepare(`SELECT 1 AS present FROM ${table} WHERE ${column} = ?`)
        .get(trace.target_id) as { present: number } | undefined;
      if (!exists) {
        findings.push(
          publicationIssue(
            "PUBLICATION_TRACE_TARGET_DANGLING",
            `/accepted_requirements/${trace.requirement_id}`,
            `Persisted traceability target ${trace.target_kind} ${trace.target_id} does not exist`
          )
        );
      }
    }

    return findings;
  }

  private validateStoredPayloads(manifestId: string): ValidationFinding[] {
    const findings: ValidationFinding[] = [];
    const expectedCount = (
      this.db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM capsules c JOIN coding_passes p ON p.pass_id = c.pass_id
           WHERE p.manifest_id = ?`
        )
        .get(manifestId) as { count: number }
    ).count;
    const rows = this.db
      .prepare(
        `SELECT hp.payload_id, hp.manifest_id, hp.pass_id, hp.capsule_id,
                hp.control_json, hp.agent_input_json, hp.payload_json,
                hp.control_digest, hp.agent_input_digest, hp.payload_digest,
                c.target_path, c.operation, c.content_digest AS capsule_digest,
                p.content_digest AS pass_digest,
                m.content_digest AS manifest_digest,
                p.base_revision_id, rr.content_digest AS base_revision_digest,
                p.contract_set_id, cs.content_digest AS contract_set_digest
         FROM harness_payloads hp
         JOIN capsules c ON c.capsule_id = hp.capsule_id
         JOIN coding_passes p ON p.pass_id = hp.pass_id AND p.pass_id = c.pass_id
         JOIN run_manifests m ON m.manifest_id = hp.manifest_id AND m.manifest_id = p.manifest_id
         JOIN repository_revisions rr ON rr.revision_id = p.base_revision_id
         JOIN contract_sets cs ON cs.contract_set_id = p.contract_set_id
         WHERE hp.manifest_id = ?
         ORDER BY c.target_path`
      )
      .all(manifestId) as Array<{
      payload_id: string;
      manifest_id: string;
      pass_id: string;
      capsule_id: string;
      control_json: string;
      agent_input_json: string;
      payload_json: string;
      control_digest: string;
      agent_input_digest: string;
      payload_digest: string;
      target_path: string;
      operation: string;
      capsule_digest: string;
      pass_digest: string;
      manifest_digest: string;
      base_revision_id: string;
      base_revision_digest: string;
      contract_set_id: string;
      contract_set_digest: string;
    }>;
    if (rows.length !== expectedCount) {
      findings.push(
        publicationIssue(
          "PUBLICATION_PAYLOAD_COVERAGE_INVALID",
          "/harness_payloads",
          "The stored Harness Payload set does not cover every persisted Capsule exactly once",
          { expected: expectedCount, actual: rows.length }
        )
      );
    }

    for (const row of rows) {
      const control = parseJson<Record<string, unknown>>(row.control_json);
      const agentInput = parseJson<unknown>(row.agent_input_json);
      const agentInputRecord =
        typeof agentInput === "object" && agentInput !== null
          ? (agentInput as Record<string, unknown>)
          : {};
      const payload = parseJson<unknown>(row.payload_json);
      if (
        sha256Json(control) !== row.control_digest ||
        sha256Json(agentInput) !== row.agent_input_digest ||
        sha256Json(payload) !== row.payload_digest
      ) {
        findings.push(
          publicationIssue(
            "PUBLICATION_PAYLOAD_DIGEST_MISMATCH",
            `/harness_payloads/${row.payload_id}`,
            "One or more stored Harness Payload component digests do not reproduce"
          )
        );
      }
      if (canonicalJson(payload) !== canonicalJson({ control, agent_input: agentInput })) {
        findings.push(
          publicationIssue(
            "PUBLICATION_PAYLOAD_ENVELOPE_INVALID",
            `/harness_payloads/${row.payload_id}`,
            "The stored complete payload is not exactly its stored Control and Agent Input"
          )
        );
      }
      const expectedControl = {
        manifest_id: row.manifest_id,
        manifest_digest: row.manifest_digest,
        pass_id: row.pass_id,
        pass_digest: row.pass_digest,
        capsule_id: row.capsule_id,
        capsule_digest: row.capsule_digest,
        base_revision_id: row.base_revision_id,
        base_revision_digest: row.base_revision_digest,
        contract_set_id: row.contract_set_id,
        contract_set_digest: row.contract_set_digest,
        target_path: row.target_path,
        operation: row.operation
      };
      const mismatches = Object.entries(expectedControl)
        .filter(([key, expected]) => control[key] !== expected)
        .map(([key]) => key);
      if (mismatches.length > 0) {
        findings.push(
          publicationIssue(
            "PUBLICATION_CONTROL_IDENTITY_MISMATCH",
            `/harness_payloads/${row.payload_id}/control`,
            "Stored Harness Control disagrees with the persisted Manifest graph",
            { mismatched_fields: mismatches }
          )
        );
      }
      const documentedDeclarations = this.db
        .prepare(
          `SELECT item.content_json
           FROM contract_input_bindings binding
           JOIN context_items item ON item.context_item_id = binding.context_item_id
           WHERE binding.capsule_id = ? AND item.kind = 'documented_declarations'`
        )
        .get(row.capsule_id) as { content_json: string } | undefined;
      if (
        !documentedDeclarations ||
        canonicalJson(agentInputRecord.declarations) !==
          canonicalJson(parseJson<unknown>(documentedDeclarations.content_json))
      ) {
        findings.push(
          publicationIssue(
            "PUBLICATION_PAYLOAD_DECLARATIONS_MISMATCH",
            `/harness_payloads/${row.payload_id}/agent_input/declarations`,
            "Agent Input documented interfaces do not match their immutable Context Item"
          )
        );
      }
    }
    return findings;
  }

  private recordPublicationValidation(
    manifestId: string,
    validatedAt: string,
    findings: ValidationFinding[]
  ): PersistedPublicationValidation {
    const validationRunId = opaqueId(
      manifestId,
      "publication_validation",
      PUBLICATION_VALIDATOR_VERSION,
      validatedAt
    );
    const outcome = findings.length === 0 ? "valid" : "invalid";
    this.db
      .prepare(
        `INSERT INTO publication_validation_runs
         (validation_run_id, manifest_id, validator_id, validator_version,
          validated_at, checks_json, outcome)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        validationRunId,
        manifestId,
        PUBLICATION_VALIDATOR_ID,
        PUBLICATION_VALIDATOR_VERSION,
        validatedAt,
        canonicalJson(PUBLICATION_CHECKS),
        outcome
      );
    const findingInsert = this.db.prepare(
      `INSERT INTO publication_validation_findings
       (finding_id, validation_run_id, code, severity, location, message, detail_json, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    findings.forEach((finding, position) => {
      findingInsert.run(
        opaqueId(validationRunId, "finding", String(position), finding.code),
        validationRunId,
        finding.code,
        finding.severity,
        finding.location,
        finding.message,
        canonicalJson(finding.detail),
        position
      );
    });
    return {
      validation_run_id: validationRunId,
      validator_id: PUBLICATION_VALIDATOR_ID,
      validator_version: PUBLICATION_VALIDATOR_VERSION,
      validated_at: validatedAt,
      checks: PUBLICATION_CHECKS,
      outcome,
      finding_count: findings.length
    };
  }

  private loadReview(manifestId: string): PublicationReviewResult | undefined {
    const row = this.db
      .prepare(
        `SELECT pr.review_id, pr.snapshot_json, pr.snapshot_digest,
                rr.rendered_content, rr.rendered_content_digest
         FROM publication_reviews pr
         JOIN publication_review_renders rr ON rr.review_id = pr.review_id
         WHERE pr.manifest_id = ?`
      )
      .get(manifestId) as
      | {
          review_id: string;
          snapshot_json: string;
          snapshot_digest: string;
          rendered_content: string;
          rendered_content_digest: string;
        }
      | undefined;
    if (!row) return undefined;
    const snapshot = parseJson<ReviewSnapshot>(row.snapshot_json);
    return {
      review_id: row.review_id,
      snapshot,
      snapshot_digest: row.snapshot_digest,
      html: row.rendered_content,
      html_digest: row.rendered_content_digest,
      digest_set: snapshot.digest_set
    };
  }

  prepareReview(
    manifestId: string,
    createdAt: string,
    renderOptions: PublicationReviewRenderOptions = {}
  ): PublicationReviewResult {
    const existing = this.loadReview(manifestId);
    if (existing) return existing;

    const manifest = this.db
      .prepare(
        `SELECT m.manifest_id, m.label, m.objective, m.content_digest,
                m.submission_id, s.bundle_digest, s.compiler_name, s.model_id,
                s.procedure_id, s.procedure_digest, s.compiler_input_revision_id,
                s.received_at, r.report_id, r.summary AS report_summary,
                r.content_digest AS report_digest
         FROM run_manifests m
         JOIN compilation_submissions s ON s.submission_id = m.submission_id
         JOIN compilation_reports r ON r.manifest_id = m.manifest_id
         WHERE m.manifest_id = ?`
      )
      .get(manifestId) as
      | {
          manifest_id: string;
          label: string;
          objective: string;
          content_digest: string;
          submission_id: string;
          bundle_digest: string;
          compiler_name: string;
          model_id: string;
          procedure_id: string;
          procedure_digest: string;
          compiler_input_revision_id: string;
          received_at: string;
          report_id: string;
          report_summary: string;
          report_digest: string;
        }
      | undefined;
    if (!manifest) throw new Error(`Unknown imported Manifest ${manifestId}`);

    const persistedDefinitionFindings = this.validatePersistedDefinition(manifestId);
    if (persistedDefinitionFindings.length > 0) {
      this.db.transaction(() => {
        this.recordPublicationValidation(manifestId, createdAt, persistedDefinitionFindings);
      })();
      throw new PublicationValidationError(persistedDefinitionFindings);
    }

    const pass = this.db
      .prepare(
        `SELECT p.pass_id, p.objective, p.content_digest,
                rr.revision_id, rr.label AS revision_label, rr.content_digest AS revision_digest,
                cs.contract_set_id, cs.logical_name AS contract_set_name,
                cs.version AS contract_set_version, cs.purpose AS contract_set_purpose,
                cs.content_digest AS contract_set_digest
         FROM coding_passes p
         JOIN repository_revisions rr ON rr.revision_id = p.base_revision_id
         JOIN contract_sets cs ON cs.contract_set_id = p.contract_set_id
         WHERE p.manifest_id = ?`
      )
      .get(manifestId) as {
      pass_id: string;
      objective: string;
      content_digest: string;
      revision_id: string;
      revision_label: string;
      revision_digest: string;
      contract_set_id: string;
      contract_set_name: string;
      contract_set_version: string;
      contract_set_purpose: string;
      contract_set_digest: string;
    } | undefined;
    if (!pass) throw new Error(`Manifest ${manifestId} has no Coding Pass`);

    const findingRows = this.db
      .prepare(
        `SELECT finding_kind, code, severity, location, message, detail_json,
                machine_repairable, requires_human_input
         FROM compilation_submission_findings
         WHERE submission_id = ? ORDER BY position`
      )
      .all(manifest.submission_id) as Array<{
      code: string;
      finding_kind: ValidationFinding["kind"];
      severity: "error" | "warning";
      location: string;
      message: string;
      detail_json: string;
      machine_repairable: number;
      requires_human_input: number;
    }>;
    const findings = findingRows.map((row) => ({
      kind: row.finding_kind,
      code: row.code,
      severity: row.severity,
      location: row.location,
      message: row.message,
      detail: parseJson<Record<string, unknown>>(row.detail_json),
      machine_repairable: row.machine_repairable === 1,
      requires_human_input: row.requires_human_input === 1
    }));
    const blockers = findings.filter((finding) => finding.severity === "error");
    if (blockers.length > 0) {
      throw new Error(`Manifest ${manifestId} still has deterministic publication blockers`);
    }
    const warnings = findings.filter((finding) => finding.kind === "heuristic_warning");
    const compilationGaps = findings.filter((finding) => finding.kind === "compilation_gap");

    const contracts = this.db
      .prepare(
        `SELECT contract_id, logical_name, version, kind, content_json, content_digest
         FROM contracts WHERE contract_set_id = ? ORDER BY logical_name, version`
      )
      .all(pass.contract_set_id) as Array<{
      contract_id: string;
      logical_name: string;
      version: string;
      kind: string;
      content_json: string;
      content_digest: string;
    }>;
    const contractSnapshots = contracts.map((contract) => ({
      contract_id: contract.contract_id,
      logical_name: contract.logical_name,
      version: contract.version,
      kind: contract.kind,
      content: parseJson<unknown>(contract.content_json),
      content_digest: contract.content_digest
    }));

    const dependencies = this.db
      .prepare(
        `SELECT dependency_id, dependent_capsule_id, prerequisite_kind,
                prerequisite_id, description, content_digest
         FROM dependencies WHERE pass_id = ? ORDER BY dependency_id`
      )
      .all(pass.pass_id) as Array<Record<string, unknown>>;

    const requirementRows = this.db
      .prepare(
        `SELECT ar.label, ar.statement, ar.requirement_id,
                rb.target_kind, rb.target_id, rb.binding_digest
         FROM accepted_requirements ar
         LEFT JOIN (
           SELECT requirement_id, target_kind, target_id,
                  content_digest AS binding_digest, position
           FROM requirement_bindings WHERE report_id = ?
         ) rb ON rb.requirement_id = ar.requirement_id
         WHERE ar.specification_id = (
           SELECT specification_id FROM run_manifests WHERE manifest_id = ?
         )
         ORDER BY ar.label, rb.position`
      )
      .all(manifest.report_id, manifestId) as Array<{
      label: string;
      statement: string;
      requirement_id: string;
      target_kind: string | null;
      target_id: string | null;
      binding_digest: string | null;
    }>;
    const requirementMap = new Map<string, Record<string, unknown>>();
    for (const row of requirementRows) {
      const value = requirementMap.get(row.requirement_id) ?? {
        requirement_id: row.requirement_id,
        label: row.label,
        statement: row.statement,
        implementation_path: [] as Array<Record<string, unknown>>
      };
      if (row.target_kind && row.target_id && row.binding_digest) {
        (value.implementation_path as Array<Record<string, unknown>>).push({
          target_kind: row.target_kind,
          target_id: row.target_id,
          binding_digest: row.binding_digest
        });
      }
      requirementMap.set(row.requirement_id, value);
    }

    const citationRows = this.db
      .prepare(
        `SELECT citation_id, repository_revision_id, location, source_digest,
                purpose, excerpt, citation_digest
         FROM compilation_source_citations
         WHERE report_id = ? ORDER BY location`
      )
      .all(manifest.report_id) as Array<{
      citation_id: string;
      repository_revision_id: string;
      location: string;
      source_digest: string;
      purpose: string;
      excerpt: string;
      citation_digest: string;
    }>;
    const sourceBindingRows = this.db
      .prepare(
        `SELECT citation_id, target_kind, target_id, purpose, content_digest
         FROM compilation_source_bindings
         WHERE citation_id IN (
           SELECT citation_id FROM compilation_source_citations WHERE report_id = ?
         ) ORDER BY citation_id, target_kind, target_id`
      )
      .all(manifest.report_id) as Array<{
      citation_id: string;
      target_kind: string;
      target_id: string;
      purpose: string;
      content_digest: string;
    }>;
    const sourceCitations = citationRows.map((citation) => ({
      ...citation,
      bindings: sourceBindingRows
        .filter((binding) => binding.citation_id === citation.citation_id)
        .map(({ citation_id: _citationId, ...binding }) => binding)
    }));

    const reviewId = opaqueId(manifestId, "publication_review", PUBLICATION_REVIEW_RENDERER.version);
    const capsuleRows = this.db
      .prepare(
        `SELECT capsule_id, context_set_id, target_path, operation, objective,
                intended_outcome, constraints_json, prohibited_effects_json, content_digest
         FROM capsules WHERE pass_id = ? ORDER BY target_path`
      )
      .all(pass.pass_id) as Array<{
      capsule_id: string;
      context_set_id: string;
      target_path: string;
      operation: "create" | "replace" | "delete";
      objective: string;
      intended_outcome: string;
      constraints_json: string;
      prohibited_effects_json: string;
      content_digest: string;
    }>;

    const materialize = this.db.transaction((): PublicationReviewResult => {
      const capsuleSnapshots: RenderableReviewSnapshot["passes"][number]["capsules"] = [];
      const digestPayloads: ReviewDigestSet["payloads"] = [];
      const payloadInsert = this.db.prepare(
        `INSERT INTO harness_payloads
         (payload_id, manifest_id, pass_id, capsule_id, control_json, agent_input_json,
          payload_json, control_digest, agent_input_digest, payload_digest)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const agentRenderInsert = this.db.prepare(
        `INSERT INTO harness_payload_renders
         (render_id, payload_id, renderer_id, renderer_version, renderer_digest,
          media_type, rendered_content, rendered_content_digest)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );

      for (const capsule of capsuleRows) {
        const roleRows = this.db
          .prepare(
            `SELECT r.role, c.contract_id, c.logical_name, c.version
             FROM capsule_contract_roles r
             JOIN contracts c ON c.contract_id = r.contract_id
             WHERE r.capsule_id = ? ORDER BY c.logical_name`
          )
          .all(capsule.capsule_id) as Array<Record<string, unknown>>;
        const bindingRows = this.db
          .prepare(
            `SELECT ci.logical_name AS contract_input, ci.purpose AS input_purpose,
                    ci.required, item.context_item_id, item.kind, item.version,
                    item.purpose, item.source_json, item.content_json, item.content_digest,
                    b.position
             FROM contract_input_bindings b
             JOIN contract_inputs ci ON ci.contract_input_id = b.contract_input_id
             JOIN context_items item ON item.context_item_id = b.context_item_id
             WHERE b.capsule_id = ?
             ORDER BY ci.logical_name, b.position`
          )
          .all(capsule.capsule_id) as Array<{
          contract_input: string;
          input_purpose: string;
          required: number;
          context_item_id: string;
          kind: string;
          version: string;
          purpose: string;
          source_json: string;
          content_json: string;
          content_digest: string;
          position: number;
        }>;
        const contextItems = bindingRows.map((binding) => ({
          contract_input: binding.contract_input,
          input_purpose: binding.input_purpose,
          required: binding.required === 1,
          context_item_id: binding.context_item_id,
          kind: binding.kind,
          version: binding.version,
          purpose: binding.purpose,
          source: parseJson<Record<string, unknown>>(binding.source_json),
          content: parseJson<unknown>(binding.content_json),
          content_digest: binding.content_digest,
          position: binding.position
        }));
        const capabilities = (
          this.db
            .prepare(
              `SELECT capability_requirement_id, capability, version_rule, required,
                      configuration_json, content_digest
               FROM capability_requirements WHERE capsule_id = ? ORDER BY capability`
            )
            .all(capsule.capsule_id) as Array<{
            capability_requirement_id: string;
            capability: string;
            version_rule: string;
            required: number;
            configuration_json: string;
            content_digest: string;
          }>
        ).map((capability) => ({
          capability: capability.capability,
          version_rule: capability.version_rule,
          required: capability.required === 1,
          configuration: parseJson<unknown>(capability.configuration_json)
        }));
        const targetState = contextItems.find((item) => item.contract_input === "target-state");
        if (!targetState) throw new Error(`Capsule ${capsule.capsule_id} has no target-state binding`);
        const declarationContext = contextItems.find(
          (item) => item.kind === "documented_declarations"
        );
        if (!declarationContext) {
          throw new Error(`Capsule ${capsule.capsule_id} has no documented declaration context`);
        }
        const declarations = documentedDeclarations(declarationContext.content);
        const constraints = parseJson<string[]>(capsule.constraints_json);
        const prohibitedEffects = parseJson<string[]>(capsule.prohibited_effects_json);
        const allowedEffects = [
          {
            kind:
              capsule.operation === "create"
                ? "create_file"
                : capsule.operation === "replace"
                  ? "replace_file"
                  : "delete_file",
            path: capsule.target_path
          }
        ];
        const agentInput: RenderableAgentInput = {
          objective: capsule.objective,
          target: {
            path: capsule.target_path,
            operation: capsule.operation,
            ...(targetState.content as Record<string, unknown>)
          },
          intended_outcome: capsule.intended_outcome,
          declarations,
          input_bindings: contextItems
            .filter((item) => item.kind !== "documented_declarations")
            .map((item) => ({
            contract_input: item.contract_input,
            purpose: item.purpose,
            kind: item.kind,
            version: item.version,
            content: item.content
            })),
          required_capabilities: capabilities,
          constraints,
          prohibited_effects: prohibitedEffects
        };
        const control = {
          protocol: {
            bundle_schema: "score.compilation-bundle@0.1.0-alpha.4",
            profile: "score.coding@0.1.0-alpha.4",
            canonicalization: "RFC 8785",
            digest_algorithm: "SHA-256"
          },
          manifest_id: manifest.manifest_id,
          manifest_digest: manifest.content_digest,
          pass_id: pass.pass_id,
          pass_digest: pass.content_digest,
          capsule_id: capsule.capsule_id,
          capsule_digest: capsule.content_digest,
          base_revision_id: pass.revision_id,
          base_revision_digest: pass.revision_digest,
          contract_set_id: pass.contract_set_id,
          contract_set_digest: pass.contract_set_digest,
          target_path: capsule.target_path,
          operation: capsule.operation,
          allowed_effects: allowedEffects
        };
        const payload = { control, agent_input: agentInput };
        const controlDigest = sha256Json(control);
        const agentInputDigest = sha256Json(agentInput);
        const payloadDigest = sha256Json(payload);
        const payloadId = opaqueId(manifestId, "harness_payload", capsule.capsule_id);
        const agentInputMarkdown = renderAgentInput(agentInput);
        const agentInputMarkdownDigest = sha256Bytes(agentInputMarkdown);
        payloadInsert.run(
          payloadId,
          manifestId,
          pass.pass_id,
          capsule.capsule_id,
          canonicalJson(control),
          canonicalJson(agentInput),
          canonicalJson(payload),
          controlDigest,
          agentInputDigest,
          payloadDigest
        );
        agentRenderInsert.run(
          opaqueId(payloadId, "agent_input_render", AGENT_INPUT_RENDERER.version),
          payloadId,
          AGENT_INPUT_RENDERER.id,
          AGENT_INPUT_RENDERER.version,
          rendererDigest(AGENT_INPUT_RENDERER),
          "text/markdown; charset=utf-8",
          agentInputMarkdown,
          agentInputMarkdownDigest
        );
        const capsuleTargetIds = new Set([
          capsule.capsule_id,
          ...contextItems.map((item) => item.context_item_id)
        ]);
        const capsuleCitations = sourceCitations.filter((citation) =>
          (citation.bindings as Array<{ target_id: string }>).some((binding) =>
            capsuleTargetIds.has(binding.target_id)
          )
        );
        capsuleSnapshots.push({
          capsule_id: capsule.capsule_id,
          capsule_digest: capsule.content_digest,
          target_path: capsule.target_path,
          operation: capsule.operation,
          objective: capsule.objective,
          intended_outcome: capsule.intended_outcome,
          contract_roles: roleRows,
          context_items: contextItems,
          resolved_skills: contextItems.filter((item) => item.kind === "skill"),
          required_capabilities: capabilities,
          allowed_effects: allowedEffects,
          prohibited_effects: prohibitedEffects,
          source_citations: capsuleCitations,
          payload_id: payloadId,
          control,
          control_digest: controlDigest,
          agent_input: agentInput,
          agent_input_digest: agentInputDigest,
          payload_digest: payloadDigest,
          agent_input_markdown: agentInputMarkdown,
          agent_input_markdown_digest: agentInputMarkdownDigest
        });
        digestPayloads.push({
          payload_id: payloadId,
          target_path: capsule.target_path,
          control_digest: controlDigest,
          agent_input_digest: agentInputDigest,
          payload_digest: payloadDigest
        });
      }

      const payloadFindings = this.validateStoredPayloads(manifestId);
      if (payloadFindings.length > 0) {
        throw new PublicationValidationError(payloadFindings);
      }
      const publicationValidation = this.recordPublicationValidation(manifestId, createdAt, []);
      if (publicationValidation.outcome !== "valid") {
        throw new Error("A successful publication validation was not recorded as valid");
      }

      const digestSet: ReviewDigestSet = {
        manifest: { protocol_id: manifest.manifest_id, content_digest: manifest.content_digest },
        compilation_report: {
          protocol_id: manifest.report_id,
          content_digest: manifest.report_digest
        },
        pass: { protocol_id: pass.pass_id, content_digest: pass.content_digest },
        payloads: digestPayloads
      };
      const snapshot: ReviewSnapshot = {
        schema: "score.publication-review",
        version: "0.1.0-alpha.4",
        review_id: reviewId,
        created_at: createdAt,
        manifest: {
          protocol_id: manifest.manifest_id,
          content_digest: manifest.content_digest,
          label: manifest.label,
          objective: manifest.objective
        },
        compilation_report: {
          protocol_id: manifest.report_id,
          content_digest: manifest.report_digest,
          summary: manifest.report_summary
        },
        compiler_submission: {
          submission_id: manifest.submission_id,
          bundle_digest: manifest.bundle_digest,
          compiler_name: manifest.compiler_name,
          model_id: manifest.model_id,
          compilation_procedure_id: manifest.procedure_id,
          compilation_procedure_digest: manifest.procedure_digest,
          compiler_input_revision_id: manifest.compiler_input_revision_id,
          received_at: manifest.received_at
        },
        publication_gate: {
          publication_validation: {
            ...publicationValidation,
            outcome: "valid"
          },
          blockers,
          warnings,
          compilation_gaps: compilationGaps
        },
        digest_set: digestSet,
        requirements: [...requirementMap.values()],
        source_citations: sourceCitations,
        passes: [
          {
            pass_id: pass.pass_id,
            pass_digest: pass.content_digest,
            objective: pass.objective,
            base_revision: {
              revision_id: pass.revision_id,
              label: pass.revision_label,
              content_digest: pass.revision_digest
            },
            contract_set: {
              contract_set_id: pass.contract_set_id,
              logical_name: pass.contract_set_name,
              version: pass.contract_set_version,
              purpose: pass.contract_set_purpose,
              content_digest: pass.contract_set_digest
            },
            contracts: contractSnapshots,
            dependencies,
            capsules: capsuleSnapshots
          }
        ]
      };
      const snapshotDigest = sha256Json(snapshot);
      const html = renderPublicationReviewHtml(snapshot, renderOptions);
      const htmlDigest = sha256Bytes(html);
      this.db
        .prepare(
          `INSERT INTO publication_reviews
           (review_id, manifest_id, report_id, snapshot_json, snapshot_digest, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          reviewId,
          manifestId,
          manifest.report_id,
          canonicalJson(snapshot),
          snapshotDigest,
          createdAt
        );
      this.db
        .prepare(
          `INSERT INTO publication_review_renders
           (render_id, review_id, renderer_id, renderer_version, renderer_digest,
            rendered_content, rendered_content_digest)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          opaqueId(reviewId, "publication_review_render", PUBLICATION_REVIEW_RENDERER.version),
          reviewId,
          PUBLICATION_REVIEW_RENDERER.id,
          PUBLICATION_REVIEW_RENDERER.version,
          rendererDigest(PUBLICATION_REVIEW_RENDERER),
          html,
          htmlDigest
        );
      return {
        review_id: reviewId,
        snapshot,
        snapshot_digest: snapshotDigest,
        html,
        html_digest: htmlDigest,
        digest_set: digestSet
      };
    });

    try {
      return materialize();
    } catch (error) {
      if (error instanceof PublicationValidationError) {
        this.db.transaction(() => {
          this.recordPublicationValidation(manifestId, createdAt, error.findings);
        })();
      }
      throw error;
    }
  }

  decidePublication(input: PublicationDecisionInput): { decision_id: string } {
    this.assertPreparedReviewPublished(input.review_id);
    const reviewRow = this.db
      .prepare("SELECT manifest_id, report_id, snapshot_json FROM publication_reviews WHERE review_id = ?")
      .get(input.review_id) as
      | { manifest_id: string; report_id: string; snapshot_json: string }
      | undefined;
    if (!reviewRow) throw new Error(`Unknown Publication Review ${input.review_id}`);
    const snapshot = parseJson<ReviewSnapshot>(reviewRow.snapshot_json);
    if (canonicalJson(input.expected_digest_set) !== canonicalJson(snapshot.digest_set)) {
      throw new Error("Publication Decision digest set does not match the exact reviewed digest set");
    }
    if (snapshot.publication_gate.blockers.length > 0 || snapshot.publication_gate.compilation_gaps.length > 0) {
      throw new Error("Publication Review has unresolved blockers or Compilation Gaps");
    }
    const waivedCodes = new Set(input.warning_waivers.map((waiver) => waiver.code));
    for (const warning of snapshot.publication_gate.warnings as Array<{ code?: string }>) {
      if (!warning.code || !waivedCodes.has(warning.code)) {
        throw new Error(`Publication warning ${warning.code ?? "unknown"} has no explicit waiver`);
      }
    }
    const decisionId = opaqueId(
      input.review_id,
      "publication_decision",
      input.authority,
      input.decided_at,
      input.decision
    );
    const persist = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO publication_decisions
           (decision_id, review_id, authority, decided_at, decision,
            approved_manifest_digest, approved_report_digest, warning_waivers_json, rationale)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          decisionId,
          input.review_id,
          input.authority,
          input.decided_at,
          input.decision,
          snapshot.digest_set.manifest.content_digest,
          snapshot.digest_set.compilation_report.content_digest,
          canonicalJson(input.warning_waivers),
          input.rationale
        );
      if (input.decision === "approve") {
        const bindingInsert = this.db.prepare(
          `INSERT INTO publication_decision_payloads
           (decision_id, payload_id, control_digest, agent_input_digest, payload_digest)
           VALUES (?, ?, ?, ?, ?)`
        );
        for (const payload of snapshot.digest_set.payloads) {
          bindingInsert.run(
            decisionId,
            payload.payload_id,
            payload.control_digest,
            payload.agent_input_digest,
            payload.payload_digest
          );
        }
      }
    });
    persist();
    return { decision_id: decisionId };
  }

  exportApprovedPass(passId: string): ApprovedPassExport {
    this.assertPreparedPassPublished(passId);
    const rows = this.db
      .prepare(
        `SELECT hp.payload_id, hp.target_path, hp.operation,
                hp.control_json, hp.agent_input_json, hp.payload_json,
                hp.control_digest, hp.agent_input_digest, hp.payload_digest,
                pd.decision_id, pd.authority, pd.decided_at, pd.review_id
         FROM (
           SELECT payload_id, pass_id, capsule_id, control_json, agent_input_json,
                  payload_json, control_digest, agent_input_digest, payload_digest,
                  json_extract(control_json, '$.target_path') AS target_path,
                  json_extract(control_json, '$.operation') AS operation
           FROM harness_payloads
         ) hp
         JOIN publication_decision_payloads pdp ON pdp.payload_id = hp.payload_id
           AND pdp.control_digest = hp.control_digest
           AND pdp.agent_input_digest = hp.agent_input_digest
           AND pdp.payload_digest = hp.payload_digest
         JOIN publication_decisions pd ON pd.decision_id = pdp.decision_id
           AND pd.decision = 'approve'
         WHERE hp.pass_id = ?
         ORDER BY hp.target_path`
      )
      .all(passId) as Array<{
      payload_id: string;
      target_path: string;
      operation: string;
      control_json: string;
      agent_input_json: string;
      payload_json: string;
      control_digest: string;
      agent_input_digest: string;
      payload_digest: string;
      decision_id: string;
      authority: string;
      decided_at: string;
      review_id: string;
    }>;
    const expectedCount = (
      this.db.prepare("SELECT COUNT(*) AS count FROM capsules WHERE pass_id = ?").get(passId) as
        | { count: number }
        | undefined
    )?.count;
    if (!expectedCount || rows.length !== expectedCount) {
      throw new Error(`Coding Pass ${passId} is not approved with a complete frozen payload set`);
    }
    const first = rows[0];
    if (!first) throw new Error(`Coding Pass ${passId} is not approved`);
    const sourceSnapshot = readRepositorySourceSnapshot(this.db, passId);
    return {
      schema: "score.approved-pass-export",
      version: "0.1.0-alpha.5",
      pass_id: passId,
      publication: {
        review_id: first.review_id,
        decision_id: first.decision_id,
        authority: first.authority,
        decided_at: first.decided_at
      },
      source_snapshot: sourceSnapshot,
      payloads: rows.map((row) => ({
        payload_id: row.payload_id,
        target_path: row.target_path,
        operation: row.operation,
        control: parseJson<unknown>(row.control_json),
        agent_input: parseJson<unknown>(row.agent_input_json),
        payload: parseJson<unknown>(row.payload_json),
        control_digest: row.control_digest,
        agent_input_digest: row.agent_input_digest,
        payload_digest: row.payload_digest
      }))
    };
  }

  inspectCounts(): InspectionCounts {
    return {
      compilation_submissions: countRow(this.db, "compilation_submissions"),
      compilation_submission_findings: countRow(this.db, "compilation_submission_findings"),
      run_manifests: countRow(this.db, "run_manifests"),
      contracts: countRow(this.db, "contracts"),
      coding_passes: countRow(this.db, "coding_passes"),
      capsules: countRow(this.db, "capsules"),
      project_settings: countRow(this.db, "repository_project_settings"),
      planned_declarations: countRow(this.db, "planned_declarations"),
      context_items: countRow(this.db, "context_items"),
      harness_payloads: countRow(this.db, "harness_payloads"),
      publication_validation_runs: countRow(this.db, "publication_validation_runs"),
      publication_reviews: countRow(this.db, "publication_reviews"),
      publication_decisions: countRow(this.db, "publication_decisions")
    };
  }

  inspectViews(): Record<string, Array<Record<string, unknown>>> {
    const views = [
      "v_accepted_requirement_traceability",
      "v_repository_files",
      "v_repository_project_settings",
      "v_prepared_slice_revisions",
      "v_contract_inputs",
      "v_coding_pass_capsules",
      "v_declaration_registry",
      "v_context_bindings",
      "v_resolved_skills",
      "v_compilation_history",
      "v_compilation_findings",
      "v_publication_validation",
      "v_harness_payload_digests",
      "v_publication_bindings"
    ] as const;
    return Object.fromEntries(
      views.map((view) => [view, this.db.prepare(`SELECT * FROM ${view}`).all()])
    ) as Record<string, Array<Record<string, unknown>>>;
  }

  close(): void {
    this.db.close();
  }
}
