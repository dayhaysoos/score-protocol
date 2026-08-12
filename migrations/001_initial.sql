PRAGMA foreign_keys = ON;

CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL
) STRICT;

CREATE TABLE accepted_specifications (
  specification_id TEXT PRIMARY KEY CHECK(length(specification_id) = 36),
  authority TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  content_json TEXT NOT NULL CHECK(json_valid(content_json)),
  content_digest TEXT NOT NULL CHECK(length(content_digest) = 71)
) STRICT;

CREATE TABLE accepted_requirements (
  requirement_id TEXT PRIMARY KEY CHECK(length(requirement_id) = 36),
  specification_id TEXT NOT NULL REFERENCES accepted_specifications(specification_id),
  label TEXT NOT NULL,
  statement TEXT NOT NULL,
  content_digest TEXT NOT NULL CHECK(length(content_digest) = 71),
  UNIQUE(specification_id, label)
) STRICT;

CREATE TABLE compilation_procedures (
  procedure_id TEXT PRIMARY KEY CHECK(length(procedure_id) = 36),
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  profile TEXT NOT NULL,
  source TEXT NOT NULL,
  content TEXT NOT NULL,
  content_digest TEXT NOT NULL CHECK(length(content_digest) = 71),
  UNIQUE(name, version, profile)
) STRICT;

CREATE TABLE compiler_input_revisions (
  compiler_input_revision_id TEXT PRIMARY KEY CHECK(length(compiler_input_revision_id) = 36),
  authority TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  content_json TEXT NOT NULL CHECK(json_valid(content_json)),
  content_digest TEXT NOT NULL CHECK(length(content_digest) = 71)
) STRICT;

CREATE TABLE repository_revisions (
  revision_id TEXT PRIMARY KEY CHECK(length(revision_id) = 36),
  label TEXT NOT NULL,
  ordered_manifest_json TEXT NOT NULL CHECK(json_valid(ordered_manifest_json)),
  content_digest TEXT NOT NULL CHECK(length(content_digest) = 71)
) STRICT;

CREATE TABLE repository_revision_files (
  revision_id TEXT NOT NULL REFERENCES repository_revisions(revision_id),
  normalized_path TEXT NOT NULL,
  media_type TEXT NOT NULL,
  content BLOB NOT NULL,
  content_digest TEXT NOT NULL CHECK(length(content_digest) = 71),
  PRIMARY KEY(revision_id, normalized_path)
) STRICT;

CREATE TABLE repository_revision_absences (
  revision_id TEXT NOT NULL REFERENCES repository_revisions(revision_id),
  normalized_path TEXT NOT NULL,
  PRIMARY KEY(revision_id, normalized_path)
) STRICT;

CREATE TABLE compilation_submissions (
  submission_id TEXT PRIMARY KEY CHECK(length(submission_id) = 36),
  submission_sequence INTEGER NOT NULL UNIQUE CHECK(submission_sequence >= 1),
  label TEXT NOT NULL,
  bundle_json TEXT NOT NULL CHECK(json_valid(bundle_json)),
  bundle_digest TEXT NOT NULL CHECK(length(bundle_digest) = 71),
  compiler_name TEXT NOT NULL,
  model_id TEXT NOT NULL,
  procedure_id TEXT NOT NULL REFERENCES compilation_procedures(procedure_id),
  procedure_digest TEXT NOT NULL CHECK(length(procedure_digest) = 71),
  compiler_input_revision_id TEXT NOT NULL REFERENCES compiler_input_revisions(compiler_input_revision_id),
  received_at TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('valid', 'invalid')),
  prior_submission_id TEXT REFERENCES compilation_submissions(submission_id),
  imported_manifest_id TEXT REFERENCES run_manifests(manifest_id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE compilation_submission_findings (
  finding_id TEXT PRIMARY KEY CHECK(length(finding_id) = 36),
  submission_id TEXT NOT NULL REFERENCES compilation_submissions(submission_id),
  validator_id TEXT NOT NULL,
  validator_version TEXT NOT NULL,
  finding_kind TEXT NOT NULL CHECK(finding_kind IN ('deterministic_validation', 'heuristic_warning', 'compilation_gap')),
  code TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('error', 'warning')),
  location TEXT NOT NULL,
  message TEXT NOT NULL,
  detail_json TEXT NOT NULL CHECK(json_valid(detail_json)),
  machine_repairable INTEGER NOT NULL CHECK(machine_repairable IN (0, 1)),
  requires_human_input INTEGER NOT NULL CHECK(requires_human_input IN (0, 1)),
  position INTEGER NOT NULL,
  UNIQUE(submission_id, position)
) STRICT;

CREATE TABLE run_manifests (
  manifest_id TEXT PRIMARY KEY CHECK(length(manifest_id) = 36),
  submission_id TEXT NOT NULL UNIQUE REFERENCES compilation_submissions(submission_id),
  specification_id TEXT NOT NULL REFERENCES accepted_specifications(specification_id),
  compiler_input_revision_id TEXT NOT NULL REFERENCES compiler_input_revisions(compiler_input_revision_id),
  label TEXT NOT NULL,
  objective TEXT NOT NULL,
  rationale TEXT NOT NULL,
  definition_json TEXT NOT NULL CHECK(json_valid(definition_json)),
  content_digest TEXT NOT NULL CHECK(length(content_digest) = 71)
) STRICT;

CREATE TABLE compilation_reports (
  report_id TEXT PRIMARY KEY CHECK(length(report_id) = 36),
  manifest_id TEXT NOT NULL UNIQUE REFERENCES run_manifests(manifest_id),
  summary TEXT NOT NULL,
  report_json TEXT NOT NULL CHECK(json_valid(report_json)),
  content_digest TEXT NOT NULL CHECK(length(content_digest) = 71)
) STRICT;

CREATE TABLE contract_sets (
  contract_set_id TEXT PRIMARY KEY CHECK(length(contract_set_id) = 36),
  manifest_id TEXT NOT NULL REFERENCES run_manifests(manifest_id),
  logical_name TEXT NOT NULL,
  version TEXT NOT NULL,
  purpose TEXT NOT NULL,
  content_digest TEXT NOT NULL CHECK(length(content_digest) = 71),
  UNIQUE(manifest_id, logical_name, version)
) STRICT;

CREATE TABLE contracts (
  contract_id TEXT PRIMARY KEY CHECK(length(contract_id) = 36),
  contract_set_id TEXT NOT NULL REFERENCES contract_sets(contract_set_id),
  logical_name TEXT NOT NULL,
  version TEXT NOT NULL,
  kind TEXT NOT NULL,
  content_json TEXT NOT NULL CHECK(json_valid(content_json)),
  content_digest TEXT NOT NULL CHECK(length(content_digest) = 71),
  UNIQUE(contract_set_id, logical_name, version)
) STRICT;

CREATE TABLE contract_inputs (
  contract_input_id TEXT PRIMARY KEY CHECK(length(contract_input_id) = 36),
  contract_id TEXT NOT NULL REFERENCES contracts(contract_id),
  logical_name TEXT NOT NULL,
  required INTEGER NOT NULL CHECK(required IN (0, 1)),
  expected_kind TEXT NOT NULL,
  version_rule TEXT NOT NULL,
  min_cardinality INTEGER NOT NULL CHECK(min_cardinality >= 0),
  max_cardinality INTEGER NOT NULL CHECK(max_cardinality >= 1),
  purpose TEXT NOT NULL,
  content_digest TEXT NOT NULL CHECK(length(content_digest) = 71),
  UNIQUE(contract_id, logical_name)
) STRICT;

CREATE TABLE coding_passes (
  pass_id TEXT PRIMARY KEY CHECK(length(pass_id) = 36),
  manifest_id TEXT NOT NULL UNIQUE REFERENCES run_manifests(manifest_id),
  base_revision_id TEXT NOT NULL REFERENCES repository_revisions(revision_id),
  contract_set_id TEXT NOT NULL REFERENCES contract_sets(contract_set_id),
  objective TEXT NOT NULL,
  content_digest TEXT NOT NULL CHECK(length(content_digest) = 71)
) STRICT;

CREATE TABLE context_items (
  context_item_id TEXT PRIMARY KEY CHECK(length(context_item_id) = 36),
  manifest_id TEXT NOT NULL REFERENCES run_manifests(manifest_id),
  kind TEXT NOT NULL,
  version TEXT NOT NULL,
  purpose TEXT NOT NULL,
  source_json TEXT NOT NULL CHECK(json_valid(source_json)),
  resolution TEXT NOT NULL CHECK(resolution IN ('inline', 'lookup')),
  content_json TEXT NOT NULL CHECK(json_valid(content_json)),
  content_digest TEXT NOT NULL CHECK(length(content_digest) = 71)
) STRICT;

CREATE TABLE context_sets (
  context_set_id TEXT PRIMARY KEY CHECK(length(context_set_id) = 36),
  manifest_id TEXT NOT NULL REFERENCES run_manifests(manifest_id),
  content_digest TEXT NOT NULL CHECK(length(content_digest) = 71)
) STRICT;

CREATE TABLE context_set_items (
  context_set_id TEXT NOT NULL REFERENCES context_sets(context_set_id),
  context_item_id TEXT NOT NULL REFERENCES context_items(context_item_id),
  position INTEGER NOT NULL,
  PRIMARY KEY(context_set_id, position),
  UNIQUE(context_set_id, context_item_id)
) STRICT;

CREATE TABLE capsules (
  capsule_id TEXT PRIMARY KEY CHECK(length(capsule_id) = 36),
  pass_id TEXT NOT NULL REFERENCES coding_passes(pass_id),
  context_set_id TEXT NOT NULL UNIQUE REFERENCES context_sets(context_set_id),
  target_path TEXT NOT NULL,
  operation TEXT NOT NULL CHECK(operation IN ('create', 'replace', 'delete')),
  objective TEXT NOT NULL,
  intended_outcome TEXT NOT NULL,
  constraints_json TEXT NOT NULL CHECK(json_valid(constraints_json)),
  prohibited_effects_json TEXT NOT NULL CHECK(json_valid(prohibited_effects_json)),
  content_digest TEXT NOT NULL CHECK(length(content_digest) = 71),
  UNIQUE(pass_id, target_path)
) STRICT;

CREATE TABLE dependencies (
  dependency_id TEXT PRIMARY KEY CHECK(length(dependency_id) = 36),
  pass_id TEXT NOT NULL REFERENCES coding_passes(pass_id),
  dependent_capsule_id TEXT NOT NULL REFERENCES capsules(capsule_id),
  prerequisite_kind TEXT NOT NULL CHECK(prerequisite_kind IN ('capsule', 'contract')),
  prerequisite_id TEXT NOT NULL,
  description TEXT NOT NULL,
  content_digest TEXT NOT NULL CHECK(length(content_digest) = 71)
) STRICT;

CREATE TABLE capsule_contract_roles (
  capsule_id TEXT NOT NULL REFERENCES capsules(capsule_id),
  contract_id TEXT NOT NULL REFERENCES contracts(contract_id),
  role TEXT NOT NULL CHECK(role IN ('implements', 'consumes')),
  PRIMARY KEY(capsule_id, contract_id)
) STRICT;

CREATE TABLE contract_input_bindings (
  capsule_id TEXT NOT NULL REFERENCES capsules(capsule_id),
  contract_input_id TEXT NOT NULL REFERENCES contract_inputs(contract_input_id),
  context_item_id TEXT NOT NULL REFERENCES context_items(context_item_id),
  actual_kind TEXT NOT NULL,
  actual_version TEXT NOT NULL,
  position INTEGER NOT NULL,
  content_digest TEXT NOT NULL CHECK(length(content_digest) = 71),
  PRIMARY KEY(capsule_id, contract_input_id, position),
  UNIQUE(capsule_id, contract_input_id, context_item_id)
) STRICT;

CREATE TABLE capability_requirements (
  capability_requirement_id TEXT PRIMARY KEY CHECK(length(capability_requirement_id) = 36),
  capsule_id TEXT NOT NULL REFERENCES capsules(capsule_id),
  capability TEXT NOT NULL,
  version_rule TEXT NOT NULL,
  required INTEGER NOT NULL CHECK(required IN (0, 1)),
  configuration_json TEXT NOT NULL CHECK(json_valid(configuration_json)),
  content_digest TEXT NOT NULL CHECK(length(content_digest) = 71)
) STRICT;

CREATE TABLE requirement_bindings (
  requirement_id TEXT NOT NULL REFERENCES accepted_requirements(requirement_id),
  report_id TEXT NOT NULL REFERENCES compilation_reports(report_id),
  target_kind TEXT NOT NULL CHECK(target_kind IN ('contract', 'capsule', 'dependency', 'context_item')),
  target_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  content_digest TEXT NOT NULL CHECK(length(content_digest) = 71),
  PRIMARY KEY(requirement_id, target_kind, target_id)
) STRICT;

CREATE TABLE compilation_source_citations (
  citation_id TEXT PRIMARY KEY CHECK(length(citation_id) = 36),
  report_id TEXT NOT NULL REFERENCES compilation_reports(report_id),
  repository_revision_id TEXT NOT NULL REFERENCES repository_revisions(revision_id),
  location TEXT NOT NULL,
  source_digest TEXT NOT NULL CHECK(length(source_digest) = 71),
  purpose TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  citation_digest TEXT NOT NULL CHECK(length(citation_digest) = 71)
) STRICT;

CREATE TABLE compilation_source_bindings (
  citation_id TEXT NOT NULL REFERENCES compilation_source_citations(citation_id),
  target_kind TEXT NOT NULL CHECK(target_kind IN ('contract', 'dependency', 'capsule', 'context_item')),
  target_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  content_digest TEXT NOT NULL CHECK(length(content_digest) = 71),
  PRIMARY KEY(citation_id, target_kind, target_id)
) STRICT;

CREATE TABLE object_handle_mappings (
  submission_id TEXT NOT NULL REFERENCES compilation_submissions(submission_id),
  object_kind TEXT NOT NULL,
  local_handle TEXT NOT NULL,
  protocol_id TEXT NOT NULL CHECK(length(protocol_id) = 36),
  PRIMARY KEY(submission_id, object_kind, local_handle),
  UNIQUE(protocol_id)
) STRICT;

CREATE TABLE harness_payloads (
  payload_id TEXT PRIMARY KEY CHECK(length(payload_id) = 36),
  manifest_id TEXT NOT NULL REFERENCES run_manifests(manifest_id),
  pass_id TEXT NOT NULL REFERENCES coding_passes(pass_id),
  capsule_id TEXT NOT NULL UNIQUE REFERENCES capsules(capsule_id),
  control_json TEXT NOT NULL CHECK(json_valid(control_json)),
  agent_input_json TEXT NOT NULL CHECK(json_valid(agent_input_json)),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  control_digest TEXT NOT NULL CHECK(length(control_digest) = 71),
  agent_input_digest TEXT NOT NULL CHECK(length(agent_input_digest) = 71),
  payload_digest TEXT NOT NULL CHECK(length(payload_digest) = 71)
) STRICT;

CREATE TABLE harness_payload_renders (
  render_id TEXT PRIMARY KEY CHECK(length(render_id) = 36),
  payload_id TEXT NOT NULL REFERENCES harness_payloads(payload_id),
  renderer_id TEXT NOT NULL,
  renderer_version TEXT NOT NULL,
  renderer_digest TEXT NOT NULL CHECK(length(renderer_digest) = 71),
  media_type TEXT NOT NULL,
  rendered_content TEXT NOT NULL,
  rendered_content_digest TEXT NOT NULL CHECK(length(rendered_content_digest) = 71),
  UNIQUE(payload_id, renderer_id, renderer_version)
) STRICT;

CREATE TABLE publication_reviews (
  review_id TEXT PRIMARY KEY CHECK(length(review_id) = 36),
  manifest_id TEXT NOT NULL UNIQUE REFERENCES run_manifests(manifest_id),
  report_id TEXT NOT NULL REFERENCES compilation_reports(report_id),
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
  snapshot_digest TEXT NOT NULL CHECK(length(snapshot_digest) = 71),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE publication_validation_runs (
  validation_run_id TEXT PRIMARY KEY CHECK(length(validation_run_id) = 36),
  manifest_id TEXT NOT NULL REFERENCES run_manifests(manifest_id),
  validator_id TEXT NOT NULL,
  validator_version TEXT NOT NULL,
  validated_at TEXT NOT NULL,
  checks_json TEXT NOT NULL CHECK(json_valid(checks_json)),
  outcome TEXT NOT NULL CHECK(outcome IN ('valid', 'invalid')),
  UNIQUE(manifest_id, validator_version, validated_at)
) STRICT;

CREATE TABLE publication_validation_findings (
  finding_id TEXT PRIMARY KEY CHECK(length(finding_id) = 36),
  validation_run_id TEXT NOT NULL REFERENCES publication_validation_runs(validation_run_id),
  code TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('error', 'warning')),
  location TEXT NOT NULL,
  message TEXT NOT NULL,
  detail_json TEXT NOT NULL CHECK(json_valid(detail_json)),
  position INTEGER NOT NULL,
  UNIQUE(validation_run_id, position)
) STRICT;

CREATE TABLE publication_review_renders (
  render_id TEXT PRIMARY KEY CHECK(length(render_id) = 36),
  review_id TEXT NOT NULL REFERENCES publication_reviews(review_id),
  renderer_id TEXT NOT NULL,
  renderer_version TEXT NOT NULL,
  renderer_digest TEXT NOT NULL CHECK(length(renderer_digest) = 71),
  rendered_content TEXT NOT NULL,
  rendered_content_digest TEXT NOT NULL CHECK(length(rendered_content_digest) = 71),
  UNIQUE(review_id, renderer_id, renderer_version)
) STRICT;

CREATE TABLE publication_decisions (
  decision_id TEXT PRIMARY KEY CHECK(length(decision_id) = 36),
  review_id TEXT NOT NULL REFERENCES publication_reviews(review_id),
  authority TEXT NOT NULL,
  decided_at TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('approve', 'reject')),
  approved_manifest_digest TEXT NOT NULL CHECK(length(approved_manifest_digest) = 71),
  approved_report_digest TEXT NOT NULL CHECK(length(approved_report_digest) = 71),
  warning_waivers_json TEXT NOT NULL CHECK(json_valid(warning_waivers_json)),
  rationale TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX one_approval_per_review
ON publication_decisions(review_id)
WHERE decision = 'approve';

CREATE TABLE publication_decision_payloads (
  decision_id TEXT NOT NULL REFERENCES publication_decisions(decision_id),
  payload_id TEXT NOT NULL UNIQUE REFERENCES harness_payloads(payload_id),
  control_digest TEXT NOT NULL CHECK(length(control_digest) = 71),
  agent_input_digest TEXT NOT NULL CHECK(length(agent_input_digest) = 71),
  payload_digest TEXT NOT NULL CHECK(length(payload_digest) = 71),
  PRIMARY KEY(decision_id, payload_id)
) STRICT;

CREATE VIEW v_accepted_requirement_traceability AS
SELECT ar.label AS requirement_label,
       ar.statement AS requirement,
       rb.target_kind,
       rb.target_id,
       rb.content_digest AS binding_digest
FROM accepted_requirements ar
LEFT JOIN requirement_bindings rb ON rb.requirement_id = ar.requirement_id
ORDER BY ar.label, rb.target_kind, rb.position;

CREATE VIEW v_repository_files AS
SELECT rr.revision_id,
       rr.label AS revision_label,
       rr.content_digest AS revision_digest,
       f.normalized_path,
       f.media_type,
       CAST(f.content AS TEXT) AS exact_content,
       f.content_digest
FROM repository_revisions rr
JOIN repository_revision_files f ON f.revision_id = rr.revision_id
ORDER BY f.normalized_path;

CREATE VIEW v_contract_inputs AS
SELECT cs.logical_name AS contract_set,
       cs.version AS contract_set_version,
       c.logical_name AS contract,
       c.version AS contract_version,
       ci.logical_name AS contract_input,
       ci.required,
       ci.expected_kind,
       ci.version_rule,
       ci.min_cardinality,
       ci.max_cardinality,
       ci.purpose
FROM contract_sets cs
JOIN contracts c ON c.contract_set_id = cs.contract_set_id
JOIN contract_inputs ci ON ci.contract_id = c.contract_id
ORDER BY ci.logical_name;

CREATE VIEW v_coding_pass_capsules AS
SELECT p.pass_id,
       p.objective AS pass_objective,
       p.content_digest AS pass_digest,
       c.capsule_id,
       c.target_path,
       c.operation,
       c.objective,
       c.intended_outcome,
       r.role AS contract_role,
       ct.logical_name AS contract,
       c.content_digest AS capsule_digest
FROM coding_passes p
JOIN capsules c ON c.pass_id = p.pass_id
LEFT JOIN capsule_contract_roles r ON r.capsule_id = c.capsule_id
LEFT JOIN contracts ct ON ct.contract_id = r.contract_id
ORDER BY c.target_path;

CREATE VIEW v_context_bindings AS
SELECT c.target_path,
       c.operation,
       ci.logical_name AS contract_input,
       ci.required,
       item.kind AS context_kind,
       item.version AS context_version,
       item.purpose,
       item.source_json,
       item.content_json,
       item.content_digest,
       b.position
FROM contract_input_bindings b
JOIN capsules c ON c.capsule_id = b.capsule_id
JOIN contract_inputs ci ON ci.contract_input_id = b.contract_input_id
JOIN context_items item ON item.context_item_id = b.context_item_id
ORDER BY c.target_path, ci.logical_name, b.position;

CREATE VIEW v_resolved_skills AS
SELECT c.target_path,
       item.version,
       item.purpose,
       item.source_json AS skill_source,
       item.content_json AS complete_skill_content,
       item.content_digest
FROM context_items item
JOIN context_set_items csi ON csi.context_item_id = item.context_item_id
JOIN capsules c ON c.context_set_id = csi.context_set_id
WHERE item.kind = 'skill'
ORDER BY c.target_path;

CREATE VIEW v_compilation_history AS
SELECT s.submission_id,
       s.label,
       s.received_at,
       s.compiler_name,
       s.model_id,
       s.bundle_digest,
       s.outcome,
       s.imported_manifest_id,
       COUNT(f.finding_id) AS finding_count,
       COALESCE(group_concat(f.code, ', '), '') AS finding_codes
FROM compilation_submissions s
LEFT JOIN compilation_submission_findings f ON f.submission_id = s.submission_id
GROUP BY s.submission_id
ORDER BY s.received_at, s.label;

CREATE VIEW v_compilation_findings AS
SELECT s.submission_id,
       s.submission_sequence,
       s.label AS submission_label,
       s.outcome,
       f.validator_id,
       f.validator_version,
       f.finding_kind,
       f.code,
       f.severity,
       f.location,
       f.message,
       f.detail_json,
       f.machine_repairable,
       f.requires_human_input,
       f.position
FROM compilation_submissions s
JOIN compilation_submission_findings f ON f.submission_id = s.submission_id
ORDER BY s.submission_sequence, f.position;

CREATE VIEW v_publication_validation AS
SELECT r.validation_run_id,
       r.manifest_id,
       r.validator_id,
       r.validator_version,
       r.validated_at,
       r.checks_json,
       r.outcome,
       f.code,
       f.severity,
       f.location,
       f.message,
       f.detail_json,
       f.position
FROM publication_validation_runs r
LEFT JOIN publication_validation_findings f ON f.validation_run_id = r.validation_run_id
ORDER BY r.validated_at, f.position;

CREATE VIEW v_harness_payload_digests AS
SELECT c.target_path,
       c.operation,
       hp.payload_id,
       hp.control_json,
       hp.control_digest,
       hp.agent_input_json,
       hp.agent_input_digest,
       hp.payload_digest,
       hpr.rendered_content_digest AS agent_input_markdown_digest
FROM harness_payloads hp
JOIN capsules c ON c.capsule_id = hp.capsule_id
LEFT JOIN harness_payload_renders hpr ON hpr.payload_id = hp.payload_id
ORDER BY c.target_path;

CREATE VIEW v_publication_bindings AS
SELECT pr.review_id,
       pr.snapshot_digest AS review_digest,
       pd.decision_id,
       pd.authority,
       pd.decided_at,
       pd.decision,
       c.target_path,
       pdp.control_digest,
       pdp.agent_input_digest,
       pdp.payload_digest
FROM publication_reviews pr
LEFT JOIN publication_decisions pd ON pd.review_id = pr.review_id
LEFT JOIN publication_decision_payloads pdp ON pdp.decision_id = pd.decision_id
LEFT JOIN harness_payloads hp ON hp.payload_id = pdp.payload_id
LEFT JOIN capsules c ON c.capsule_id = hp.capsule_id
ORDER BY c.target_path;
