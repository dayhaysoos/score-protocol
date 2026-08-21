import { randomUUID } from "node:crypto";

import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import { Context, Effect, Layer, Schema } from "effect";

import { canonicalJson, sha256Bytes, sha256Json } from "../canonical.js";
import {
  repositoryRevisionContentDigest,
  type RepositorySourceSnapshot
} from "../repository-source-state.js";
import type { ApprovedPassExport } from "../score-alpha.js";
import {
  ApprovedPackageIntegrityError,
  ApplicationState,
  AdapterCompatibilityError,
  AttemptId,
  AdapterConfiguration,
  CandidateFile,
  type CandidateFile as CandidateFileType,
  ConfirmedTarget,
  type ConfirmedTarget as ConfirmedTargetType,
  ClaimedJob,
  type ClaimedJob as ClaimedJobType,
  type EnqueuedRun,
  type FailureEvidence as FailureEvidenceType,
  type FailureCategory as FailureCategoryType,
  type FileObservationStage as FileObservationStageType,
  JobId,
  MAX_RUNNER_CONCURRENCY,
  type ObservationSource as ObservationSourceType,
  RunSnapshot,
  type RunSnapshot as RunSnapshotType,
  RunObservation,
  type RunRuntimeVersion as RunRuntimeVersionType,
  type RunObservationPhase as RunObservationPhaseType,
  RunRecoveryRequired,
  RunnerCounts,
  RunnerStoreError,
  RunId,
  type SanitizedTerminalOutcome as SanitizedTerminalOutcomeType,
  type TargetOutputState as TargetOutputStateType,
  type RepositoryBinding
} from "./domain.js";
import {
  safeFailureMessage,
  sanitizeFailureEvidence,
  sanitizeFailureCategory,
  sanitizeRuntimeSessionId,
  sanitizeTerminalOutcome
} from "./diagnostic-sanitization.js";
import {
  assertSecureDatabaseIdentity,
  prepareRunnerDatabaseState,
  secureSqliteSidecars,
  type SecureDatabaseIdentity
} from "../private-state-filesystem.js";

const CountRow = Schema.Struct({ count: Schema.Number });
const SavedRepositoryRootRow = Schema.Struct({ repositoryRoot: Schema.String });
const LatestRunRow = Schema.Struct({ runId: RunId });
const RunRow = Schema.Struct({
  runId: RunId,
  passId: Schema.String,
  state: Schema.String,
  repositoryRoot: Schema.NullOr(Schema.String),
  sourceSnapshotId: Schema.NullOr(Schema.String),
  sourceSnapshotDigest: Schema.NullOr(Schema.String),
  applicationState: ApplicationState,
  appliedAt: Schema.NullOr(Schema.String),
  confirmedTargetsJson: Schema.NullOr(Schema.String),
  adapterKind: Schema.String,
  providerId: Schema.String,
  modelId: Schema.String,
  variantId: Schema.NullOr(Schema.String),
  sdkVersion: Schema.String,
  cliVersion: Schema.String,
  maxConcurrency: Schema.Number,
  createdAt: Schema.String,
  observationSequence: Schema.Number,
  observedPhase: Schema.NullOr(Schema.String),
  lastObservedAt: Schema.NullOr(Schema.String),
  terminalAt: Schema.NullOr(Schema.String),
  runFailureCategory: Schema.NullOr(Schema.String),
  runFailureMessage: Schema.NullOr(Schema.String)
});
const JobSummaryRow = Schema.Struct({
  jobId: JobId,
  ordinal: Schema.Number,
  targetPath: Schema.String,
  operation: Schema.String,
  state: Schema.String,
  packageDigest: Schema.String
});
const AttemptSummaryRow = Schema.Struct({
  jobId: JobId,
  attemptId: AttemptId,
  attemptNumber: Schema.Number,
  state: Schema.String,
  claimedAt: Schema.String,
  completedAt: Schema.NullOr(Schema.String),
  candidateDigest: Schema.NullOr(Schema.String),
  failureCategory: Schema.NullOr(Schema.String),
  failureStage: Schema.NullOr(Schema.String),
  terminalOutcomeJson: Schema.NullOr(Schema.String),
  failureEvidenceJson: Schema.NullOr(Schema.String)
});
const ObservationJobRow = Schema.Struct({
  jobId: JobId,
  targetPath: Schema.String,
  operation: Schema.String,
  agentInputDigest: Schema.String,
  jobState: Schema.String,
  createdAt: Schema.String,
  attemptId: Schema.NullOr(AttemptId),
  attemptState: Schema.NullOr(Schema.String),
  claimedAt: Schema.NullOr(Schema.String),
  completedAt: Schema.NullOr(Schema.String),
  observedStage: Schema.NullOr(Schema.String),
  observationSource: Schema.NullOr(Schema.String),
  observedAt: Schema.NullOr(Schema.String),
  observationSequence: Schema.NullOr(Schema.Number),
  runtimeSessionId: Schema.NullOr(Schema.String),
  failureCategory: Schema.NullOr(Schema.String),
  failureMessage: Schema.NullOr(Schema.String),
  failureStage: Schema.NullOr(Schema.String),
  terminalOutcomeJson: Schema.NullOr(Schema.String),
  failureEvidenceJson: Schema.NullOr(Schema.String),
  targetOutputState: Schema.NullOr(Schema.String),
  hasCandidate: Schema.Number,
  rejectedOutputDigest: Schema.NullOr(Schema.String),
  rejectedOutputPath: Schema.NullOr(Schema.String)
});
const AcceptedMissingReplacementRow = Schema.Struct({ targetPath: Schema.String });
const TargetPathRow = Schema.Struct({ targetPath: Schema.String });
const ClaimableJobRow = Schema.Struct({
  jobId: JobId,
  runId: RunId,
  targetPath: Schema.String,
  operation: Schema.String,
  controlJson: Schema.String,
  agentInputJson: Schema.String,
  packageDigest: Schema.String,
  adapterKind: Schema.String,
  providerId: Schema.String,
  modelId: Schema.String,
  variantId: Schema.NullOr(Schema.String),
  sdkVersion: Schema.String,
  cliVersion: Schema.String
});

const TransitionRow = Schema.Struct({ id: Schema.String });
const StoredAttemptStageRow = Schema.Struct({
  attemptId: AttemptId,
  observedStage: Schema.NullOr(Schema.String)
});
const StoredAttemptFailureRow = Schema.Struct({
  attemptId: AttemptId,
  failureCategory: Schema.NullOr(Schema.String)
});
const StoredRunFailureRow = Schema.Struct({
  runId: RunId,
  failureCategory: Schema.NullOr(Schema.String)
});
const StoredTerminalOutcomeRow = Schema.Struct({
  attemptId: AttemptId,
  terminalOutcomeJson: Schema.String
});
const StoredRuntimeSessionRow = Schema.Struct({
  attemptId: AttemptId,
  runtimeSessionId: Schema.String
});
const RunnerSchemaStateRow = Schema.Struct({ failurePrivacyVersion: Schema.Number });
const RetryableRunRow = Schema.Struct({
  state: Schema.String,
  applicationState: Schema.String
});
const StoredJobProtocolRow = Schema.Struct({
  targetPath: Schema.String,
  controlJson: Schema.String
});
const SupportedRunRules = Schema.Struct({
  protocol: Schema.Struct({
    bundle_schema: Schema.Literal("score.compilation-bundle@0.1.0-alpha.5"),
    profile: Schema.Literal("score.coding@0.1.0-alpha.5"),
    canonicalization: Schema.Literal("RFC 8785"),
    digest_algorithm: Schema.Literal("SHA-256")
  }),
  target_path: Schema.String,
  operation: Schema.Literals(["create", "replace", "delete"]),
  base_revision_id: Schema.String,
  base_revision_digest: Schema.String,
  allowed_effects: Schema.Array(
    Schema.Struct({ kind: Schema.String, path: Schema.String })
  )
});
const SupportedAgentInput = Schema.Struct({
  target: Schema.Struct({
    path: Schema.String,
    operation: Schema.Literals(["create", "replace", "delete"]),
    state_at_base_revision: Schema.String
  }),
  required_capabilities: Schema.Array(
    Schema.Struct({
      capability: Schema.String,
      version_rule: Schema.String,
      required: Schema.Boolean,
      configuration: Schema.Struct({
        allowed_operations: Schema.Array(Schema.String),
        network: Schema.Boolean,
        repository_discovery: Schema.Boolean,
        shell: Schema.Boolean,
        target_path: Schema.String
      })
    })
  ),
  declarations: Schema.Struct({
    owned: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        declaration: Schema.String,
        description: Schema.String
      })
    ),
    consumed: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        declaration: Schema.String,
        description: Schema.String
      })
    )
  })
});

function frozenJobProtocolDescription(controlJson: string): string {
  try {
    const control = JSON.parse(controlJson) as {
      readonly protocol?: {
        readonly bundle_schema?: unknown;
        readonly profile?: unknown;
      };
    };
    const bundleSchema =
      typeof control.protocol?.bundle_schema === "string"
        ? control.protocol.bundle_schema
        : "missing bundle schema";
    const profile =
      typeof control.protocol?.profile === "string"
        ? control.protocol.profile
        : "missing profile";
    return `${bundleSchema} / ${profile}`;
  } catch {
    return "invalid Control JSON";
  }
}

function requireSupportedStoredJobProtocol(
  operation: "beginWork" | "claimNext",
  row: { readonly targetPath: string; readonly controlJson: string }
): Effect.Effect<void, RunnerStoreError> {
  return Effect.try({
    try: () => {
      Schema.decodeUnknownSync(SupportedRunRules)(JSON.parse(row.controlJson));
    },
    catch: () =>
      new RunnerStoreError({
        operation,
        message:
          `Job ${row.targetPath} has an unsupported frozen Agent Package protocol ` +
          `(${frozenJobProtocolDescription(row.controlJson)}); this Runner executes only ` +
          "score.compilation-bundle@0.1.0-alpha.5 / score.coding@0.1.0-alpha.5 Jobs. " +
          "Prepare and approve a new revision before execution."
      })
  });
}

function objectRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function validateOpaquePackageShape(input: {
  readonly control: unknown;
  readonly agentInput: unknown;
  readonly sourceSnapshot: unknown;
}): void {
  const control = objectRecord(input.control, "Run Rules");
  if (Object.hasOwn(control, "project_settings_digest")) {
    throw new Error("Run Rules contain removed Project Settings");
  }
  const agentInput = objectRecord(input.agentInput, "Agent Input");
  if (Object.hasOwn(agentInput, "project_settings")) {
    throw new Error("Agent Input contains removed Project Settings");
  }
  const sourceSnapshot = objectRecord(input.sourceSnapshot, "Source Snapshot");
  if (
    Object.hasOwn(sourceSnapshot, "project_settings") ||
    Object.hasOwn(sourceSnapshot, "project_settings_digest")
  ) {
    throw new Error("Source Snapshot contains removed Project Settings");
  }

  const declarations = objectRecord(agentInput.declarations, "Agent Input declarations");
  for (const group of ["owned", "consumed"] as const) {
    const entries = declarations[group];
    if (!Array.isArray(entries)) {
      throw new Error(`Agent Input declarations.${group} must be an array`);
    }
    entries.forEach((entry, index) => {
      const declaration = objectRecord(
        entry,
        `Agent Input declarations.${group}[${index}]`
      );
      const keys = Object.keys(declaration).toSorted();
      if (
        keys.length !== 3 ||
        keys[0] !== "declaration" ||
        keys[1] !== "description" ||
        keys[2] !== "name"
      ) {
        throw new Error(
          `Each documented declaration must contain exactly name, declaration, and description; ` +
            `declarations.${group}[${index}] contains ${keys.join(", ") || "no fields"}`
        );
      }
    });
  }
}

const connectionPragmaStatements = [
  "PRAGMA foreign_keys = ON",
  "PRAGMA synchronous = FULL"
] as const;

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS runner_runs (
     run_id TEXT PRIMARY KEY,
     approved_pass_id TEXT NOT NULL,
     review_id TEXT NOT NULL,
     decision_id TEXT NOT NULL,
     decision_authority TEXT NOT NULL,
     decision_at TEXT NOT NULL,
     adapter_kind TEXT NOT NULL,
     provider_id TEXT NOT NULL,
     model_id TEXT NOT NULL,
     variant_id TEXT,
     sdk_version TEXT NOT NULL,
     cli_version TEXT NOT NULL,
     max_concurrency INTEGER NOT NULL CHECK (max_concurrency BETWEEN 1 AND 32),
     state TEXT NOT NULL CHECK (state IN ('pending', 'running', 'completed', 'completed_with_failures')),
     repository_root TEXT,
     source_snapshot_id TEXT,
     source_snapshot_digest TEXT,
     source_snapshot_json TEXT,
     confirmed_targets_json TEXT,
     application_state TEXT NOT NULL DEFAULT 'not_applied'
       CHECK (application_state IN ('not_applied', 'applying', 'applied', 'apply_failed')),
     applied_at TEXT,
     observation_sequence INTEGER NOT NULL DEFAULT 0 CHECK (observation_sequence >= 0),
     observed_phase TEXT CHECK (observed_phase IS NULL OR observed_phase IN
       ('generating candidates', 'checking current target state', 'checking the complete set',
        'applying all candidates', 'applied', 'not applied', 'application failed')),
     last_observed_at TEXT,
     terminal_at TEXT,
     run_failure_category TEXT,
     run_failure_message TEXT,
     created_at TEXT NOT NULL
   ) STRICT`,
  `CREATE TABLE IF NOT EXISTS runner_jobs (
     job_id TEXT PRIMARY KEY,
     run_id TEXT NOT NULL REFERENCES runner_runs(run_id),
     ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
     payload_id TEXT NOT NULL,
     target_path TEXT NOT NULL,
     operation TEXT NOT NULL CHECK (operation IN ('create', 'replace', 'delete')),
     control_json TEXT NOT NULL,
     agent_input_json TEXT NOT NULL,
     package_json TEXT NOT NULL,
     control_digest TEXT NOT NULL,
     agent_input_digest TEXT NOT NULL,
     package_digest TEXT NOT NULL,
     state TEXT NOT NULL CHECK (state IN ('pending', 'running', 'succeeded', 'failed', 'needs_attention')),
     created_at TEXT NOT NULL,
     UNIQUE (run_id, target_path),
     UNIQUE (run_id, ordinal)
   ) STRICT`,
  `CREATE TABLE IF NOT EXISTS runner_attempts (
     attempt_id TEXT PRIMARY KEY,
     job_id TEXT NOT NULL REFERENCES runner_jobs(job_id),
     attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
     state TEXT NOT NULL CHECK (state IN ('running', 'succeeded', 'failed', 'needs_attention')),
     claimed_at TEXT NOT NULL,
     completed_at TEXT,
     candidate_path TEXT,
     candidate_digest TEXT,
     candidate_content TEXT,
     runtime_session_id TEXT,
     failure_tag TEXT,
     failure_message TEXT,
     failure_stage TEXT CHECK (failure_stage IS NULL OR failure_stage IN
       ('starting', 'Agent working', 'checking output', 'candidate ready')),
     observed_stage TEXT CHECK (observed_stage IS NULL OR observed_stage IN
       ('starting', 'Agent working', 'checking output', 'candidate ready',
        'succeeded', 'failed', 'needs attention')),
     observation_source TEXT CHECK (observation_source IS NULL OR observation_source IN
       ('runner', 'runtime adapter', 'recovery', 'historical')),
     observed_at TEXT,
     observation_sequence INTEGER NOT NULL DEFAULT 0 CHECK (observation_sequence >= 0),
     terminal_outcome_json TEXT CHECK (terminal_outcome_json IS NULL OR json_valid(terminal_outcome_json)),
     target_output_state TEXT CHECK (target_output_state IS NULL OR target_output_state IN
       ('not observed', 'missing', 'present', 'unchanged', 'different')),
     target_output_digest TEXT,
     rejected_output_digest TEXT,
     rejected_output_path TEXT,
     failure_evidence_json TEXT CHECK
       (failure_evidence_json IS NULL OR json_valid(failure_evidence_json)),
     UNIQUE (job_id, attempt_number)
   ) STRICT`,
  `CREATE TABLE IF NOT EXISTS runner_accepted_missing_replacements (
     run_id TEXT NOT NULL REFERENCES runner_runs(run_id),
     target_path TEXT NOT NULL,
     PRIMARY KEY (run_id, target_path)
   ) STRICT`,
  `CREATE TABLE IF NOT EXISTS runner_repository_bindings (
     score_database_path TEXT PRIMARY KEY,
     repository_root TEXT NOT NULL,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   ) STRICT`,
  `CREATE TRIGGER IF NOT EXISTS runner_jobs_reject_frozen_package_update
   BEFORE UPDATE OF payload_id, target_path, operation, control_json,
                    agent_input_json, package_json, control_digest,
                    agent_input_digest, package_digest
   ON runner_jobs
   BEGIN
     SELECT RAISE(ABORT, 'runner Job package is frozen');
   END`
] as const;

const repositoryBindingTrigger = `CREATE TRIGGER IF NOT EXISTS runner_runs_reject_repository_binding_update
  BEFORE UPDATE OF repository_root, source_snapshot_id,
                   source_snapshot_digest, source_snapshot_json,
                   confirmed_targets_json
  ON runner_runs
  BEGIN
    SELECT RAISE(ABORT, 'runner repository binding is frozen');
  END`;

const confirmedTargetsTrigger = `CREATE TRIGGER IF NOT EXISTS runner_runs_reject_confirmed_targets_update
  BEFORE UPDATE OF confirmed_targets_json
  ON runner_runs
  BEGIN
    SELECT RAISE(ABORT, 'runner confirmed target state is frozen');
  END`;

export class RunnerStore extends Context.Service<RunnerStore, {
  readonly initialize: Effect.Effect<void, RunnerStoreError>;
  readonly enqueue: (input: {
    readonly approvedPlan: ApprovedPassExport;
    readonly repositoryRoot: string;
    readonly acceptedMissingReplacementPaths?: ReadonlyArray<string>;
    readonly confirmedTargets?: ReadonlyArray<ConfirmedTargetType>;
    readonly adapter: AdapterConfiguration;
    readonly maxConcurrency: number;
  }) => Effect.Effect<
    EnqueuedRun,
    ApprovedPackageIntegrityError | AdapterCompatibilityError | RunnerStoreError
  >;
  readonly inspect: Effect.Effect<RunnerCounts, RunnerStoreError>;
  readonly readSavedRepositoryRoot: (
    scoreDatabasePath: string
  ) => Effect.Effect<string | null, RunnerStoreError>;
  readonly saveRepositoryRoot: (input: {
    readonly scoreDatabasePath: string;
    readonly repositoryRoot: string;
  }) => Effect.Effect<void, RunnerStoreError>;
  readonly inspectLatestRun: (
    repositoryRoot: string
  ) => Effect.Effect<RunSnapshotType, RunnerStoreError>;
  readonly inspectRun: (runId: RunId) => Effect.Effect<RunSnapshotType, RunnerStoreError>;
  readonly claimNext: (runId: RunId) => Effect.Effect<ClaimedJobType | null, RunnerStoreError>;
  readonly completeSuccess: (input: {
    readonly job: ClaimedJobType;
    readonly content: string;
    readonly runtimeSessionId: string;
    readonly targetOutputState?: TargetOutputStateType;
    readonly targetOutputDigest?: string;
  }) => Effect.Effect<void, RunnerStoreError>;
  readonly completeFailure: (input: {
    readonly job: ClaimedJobType;
    readonly failureEvidence: FailureEvidenceType;
    readonly runtimeSessionId?: string;
    readonly targetOutputState?: TargetOutputStateType;
    readonly targetOutputDigest?: string;
    readonly diagnosticContent?: string;
  }) => Effect.Effect<void, RunnerStoreError>;
  readonly recordAttemptObservation: (input: {
    readonly job: ClaimedJobType;
    readonly stage: FileObservationStageType;
    readonly source: ObservationSourceType;
    readonly runtimeSessionId?: string;
    readonly targetOutputState?: TargetOutputStateType;
    readonly targetOutputDigest?: string;
  }) => Effect.Effect<void, RunnerStoreError>;
  readonly recordRunPhase: (input: {
    readonly runId: RunId;
    readonly phase: RunObservationPhaseType;
  }) => Effect.Effect<void, RunnerStoreError>;
  readonly recordRunFailure: (input: {
    readonly runId: RunId;
    readonly phase: "not applied" | "application failed";
    readonly failureCategory: FailureCategoryType;
  }) => Effect.Effect<void, RunnerStoreError>;
  readonly finalizeRun: (runId: RunId) => Effect.Effect<void, RunnerStoreError>;
  readonly requireNoRunningAttempts: (
    runId: RunId
  ) => Effect.Effect<void, RunRecoveryRequired | RunnerStoreError>;
  readonly recoverRun: (runId: RunId) => Effect.Effect<number, RunnerStoreError>;
  readonly prepareRetry: (input: {
    readonly runId: RunId;
    readonly targetPaths: ReadonlyArray<string>;
  }) => Effect.Effect<number, RunnerStoreError>;
  readonly beginWork: (runId: RunId) => Effect.Effect<void, RunnerStoreError>;
  readonly readCandidates: (
    runId: RunId
  ) => Effect.Effect<ReadonlyArray<CandidateFileType>, RunnerStoreError>;
  readonly readRepositoryBinding: (
    runId: RunId
  ) => Effect.Effect<RepositoryBinding, RunnerStoreError>;
  readonly beginApplication: (runId: RunId) => Effect.Effect<void, RunnerStoreError>;
  readonly completeApplication: (runId: RunId) => Effect.Effect<void, RunnerStoreError>;
  readonly failApplication: (input: {
    readonly runId: RunId;
    readonly failureCategory: FailureCategoryType;
  }) => Effect.Effect<void, RunnerStoreError>;
}>()("score/RunnerStore") {}

function storeError(operation: string, cause: unknown): RunnerStoreError {
  return new RunnerStoreError({
    operation,
    message: cause instanceof Error ? cause.message : String(cause)
  });
}

function fileObservationStageRank(stage: FileObservationStageType): number {
  switch (stage) {
    case "waiting":
      return 0;
    case "starting":
      return 1;
    case "Agent working":
      return 2;
    case "checking output":
      return 3;
    case "candidate ready":
      return 4;
    case "succeeded":
    case "failed":
    case "needs attention":
      return 5;
  }
}

function runObservationPhaseRank(phase: RunObservationPhaseType): number {
  switch (phase) {
    case "generating candidates":
      return 0;
    case "checking current target state":
      return 1;
    case "checking the complete set":
      return 2;
    case "applying all candidates":
      return 3;
    case "applied":
    case "not applied":
    case "application failed":
      return 4;
  }
}

function decodeStoredAdapter(input: {
  readonly adapterKind: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly variantId: string | null;
  readonly sdkVersion: string;
  readonly cliVersion: string;
}): AdapterConfiguration {
  return Schema.decodeUnknownSync(AdapterConfiguration)(
    input.adapterKind === "opencode"
      ? {
          kind: "opencode",
          providerId: input.providerId,
          modelId: input.modelId,
          variantId: input.variantId,
          sdkVersion: input.sdkVersion,
          cliVersion: input.cliVersion
        }
      : input.adapterKind === "pi"
        ? {
            kind: "pi",
            providerId: input.providerId,
            modelId: input.modelId,
            variantId: input.variantId,
            sdkVersion: input.sdkVersion,
            workerProtocolVersion: input.cliVersion
          }
        : { kind: input.adapterKind }
  );
}

function storedAdapterVersion(adapter: AdapterConfiguration): string {
  return adapter.kind === "opencode"
    ? adapter.cliVersion
    : adapter.workerProtocolVersion;
}

function observedRuntimeVersion(
  adapter: AdapterConfiguration
): RunRuntimeVersionType {
  return adapter.kind === "opencode"
    ? {
        sdkVersion: adapter.sdkVersion,
        cliVersion: adapter.cliVersion
      }
    : {
        sdkVersion: adapter.sdkVersion,
        workerProtocolVersion: adapter.workerProtocolVersion
      };
}

function validateAgentPackage(
  payload: ApprovedPassExport["payloads"][number],
  sourceSnapshot: RepositorySourceSnapshot
): void {
  try {
    validateOpaquePackageShape({
      control: payload.control,
      agentInput: payload.agent_input,
      sourceSnapshot
    });
    const control = Schema.decodeUnknownSync(SupportedRunRules)(payload.control);
    const agentInput = Schema.decodeUnknownSync(SupportedAgentInput)(payload.agent_input);
    const operation = Schema.decodeUnknownSync(
      Schema.Literals(["create", "replace", "delete"])
    )(payload.operation);
    if (
      control.base_revision_id !== sourceSnapshot.revision_id ||
      control.base_revision_digest !== sourceSnapshot.content_digest
    ) {
      throw new Error("Run Rules do not bind the approved Source Snapshot");
    }

    if (
      control.target_path !== payload.target_path ||
      agentInput.target.path !== payload.target_path ||
      control.operation !== operation ||
      agentInput.target.operation !== operation
    ) {
      throw new Error("Run Rules, Agent Input, and exported target do not agree");
    }
    if (operation === "delete") {
      throw new Error("Runtime adapter supports create and replace, not delete");
    }

    const expectedEffect = operation === "create" ? "create_file" : "replace_file";
    if (
      control.allowed_effects.length !== 1 ||
      control.allowed_effects[0]?.kind !== expectedEffect ||
      control.allowed_effects[0]?.path !== payload.target_path
    ) {
      throw new Error("Run Rules declare effects the Runtime adapter cannot enforce");
    }

    const required = agentInput.required_capabilities.filter((capability) => capability.required);
    if (required.length !== 1) {
      throw new Error("Runtime adapter requires one supported filesystem capability");
    }
    const capability = required[0];
    const expectedOperations =
      operation === "create"
        ? ["create_assigned_target"]
        : ["read_assigned_target", "replace_assigned_target"];
    if (
      capability?.capability !== "score.coding.filesystem.single-target" ||
      capability.version_rule !== "=1.0.0" ||
      capability.configuration.target_path !== payload.target_path ||
      capability.configuration.network ||
      capability.configuration.repository_discovery ||
      capability.configuration.shell ||
      canonicalJson([...capability.configuration.allowed_operations].toSorted()) !==
        canonicalJson([...expectedOperations].toSorted())
    ) {
      throw new Error("Runtime adapter cannot satisfy the required capability exactly");
    }

    const expectedBaseState = operation === "create" ? "absent" : "present";
    if (agentInput.target.state_at_base_revision !== expectedBaseState) {
      throw new Error(`Agent Input target must be ${expectedBaseState} for ${operation}`);
    }
  } catch (cause) {
    if (cause instanceof AdapterCompatibilityError) throw cause;
    throw new AdapterCompatibilityError({
      payloadId: payload.payload_id,
      message: cause instanceof Error ? cause.message : String(cause)
    });
  }
}

function storedTerminalOutcome(value: string | null): SanitizedTerminalOutcomeType | null {
  if (value === null) return null;
  try {
    return sanitizeTerminalOutcome(JSON.parse(value));
  } catch {
    return null;
  }
}

function terminalOutcomeKindForCategory(
  category: FailureCategoryType
): SanitizedTerminalOutcomeType["kind"] {
  switch (category) {
    case "provider":
    case "tool":
    case "timeout":
    case "interruption":
      return category;
    case "workspace integrity":
    case "missing output":
      return "workspace";
    case "candidate integrity":
    case "target drift":
      return "integrity";
    case "application":
      return "application";
    case "runtime":
    case "ambiguous recovery":
    case "persistence":
      return "runtime";
    case "unknown":
      return "unknown";
  }
}

function terminalOutcomeFromEvidence(
  evidence: FailureEvidenceType
): SanitizedTerminalOutcomeType {
  return {
    kind: terminalOutcomeKindForCategory(evidence.category),
    status: evidence.status,
    statusCode: evidence.statusCode,
    name: evidence.name
  };
}

function storedFailureEvidence(input: {
  readonly failureEvidenceJson: string | null;
  readonly failureCategory: string | null;
  readonly failureStage: string | null;
  readonly terminalOutcomeJson: string | null;
}): FailureEvidenceType | null {
  if (input.failureEvidenceJson !== null) {
    try {
      return sanitizeFailureEvidence(JSON.parse(input.failureEvidenceJson));
    } catch {
      // Fall through to the honest legacy projection below.
    }
  }
  if (input.failureCategory === null) return null;
  const category = sanitizeFailureCategory(
    input.failureCategory,
    input.failureCategory
  );
  const terminal = storedTerminalOutcome(input.terminalOutcomeJson);
  return sanitizeFailureEvidence({
    category,
    stage: input.failureStage,
    name: terminal?.name ?? null,
    status: terminal?.status ?? null,
    statusCode: terminal?.statusCode ?? null,
    reason: null
  });
}

const makeRunnerStore = (
  databasePath: string,
  databaseIdentity?: SecureDatabaseIdentity
) => Effect.gen(function*() {
  const sql = yield* SqliteClient.SqliteClient;
  if (databaseIdentity !== undefined) {
    yield* Effect.try({
      try: () => assertSecureDatabaseIdentity(databaseIdentity, "Runner database"),
      catch: (cause) =>
        new RunnerStoreError({
          operation: "initialize",
          message: cause instanceof Error ? cause.message : String(cause)
        })
    });
  }

  const initialize = Effect.fn("RunnerStore.initialize")(function*() {
    yield* sql.unsafe("PRAGMA busy_timeout = 15000");
    for (const statement of connectionPragmaStatements) {
      yield* sql.unsafe(statement);
    }
    const scoreTables = yield* sql.unsafe(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name = 'accepted_specifications'`
    );
    if (scoreTables.length > 0) {
      return yield* new RunnerStoreError({
        operation: "initialize",
        message: "Runner database path points to a SCORE definition database"
      });
    }
    yield* sql.unsafe(
      `CREATE TABLE IF NOT EXISTS runner_schema_state (
         singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
         failure_privacy_version INTEGER NOT NULL CHECK (failure_privacy_version >= 0)
       ) STRICT`
    );
    yield* sql.unsafe(
      `INSERT OR IGNORE INTO runner_schema_state (singleton, failure_privacy_version)
       VALUES (1, 0)`
    );
    yield* sql.withTransaction(
      Effect.gen(function*() {
        yield* sql.unsafe(
          `UPDATE runner_schema_state
           SET failure_privacy_version = failure_privacy_version
           WHERE singleton = 1`
        );
        for (const statement of schemaStatements) {
          yield* sql.unsafe(statement);
        }
    const runColumns = (yield* sql.unsafe("PRAGMA table_info(runner_runs)")) as Array<{
      name?: unknown;
    }>;
    const existingColumns = new Set(
      runColumns.flatMap((column) =>
        typeof column.name === "string" ? [column.name] : []
      )
    );
    const migrations = [
      ["repository_root", "ALTER TABLE runner_runs ADD COLUMN repository_root TEXT"],
      ["source_snapshot_id", "ALTER TABLE runner_runs ADD COLUMN source_snapshot_id TEXT"],
      ["source_snapshot_digest", "ALTER TABLE runner_runs ADD COLUMN source_snapshot_digest TEXT"],
      ["source_snapshot_json", "ALTER TABLE runner_runs ADD COLUMN source_snapshot_json TEXT"],
      ["confirmed_targets_json", "ALTER TABLE runner_runs ADD COLUMN confirmed_targets_json TEXT"],
      ["variant_id", "ALTER TABLE runner_runs ADD COLUMN variant_id TEXT"],
      [
        "application_state",
        `ALTER TABLE runner_runs ADD COLUMN application_state TEXT NOT NULL DEFAULT 'not_applied'
         CHECK (application_state IN ('not_applied', 'applying', 'applied', 'apply_failed'))`
      ],
      ["applied_at", "ALTER TABLE runner_runs ADD COLUMN applied_at TEXT"],
      [
        "observation_sequence",
        "ALTER TABLE runner_runs ADD COLUMN observation_sequence INTEGER NOT NULL DEFAULT 0 CHECK (observation_sequence >= 0)"
      ],
      [
        "observed_phase",
        `ALTER TABLE runner_runs ADD COLUMN observed_phase TEXT CHECK (observed_phase IS NULL OR observed_phase IN
          ('generating candidates', 'checking current target state', 'checking the complete set',
           'applying all candidates', 'applied', 'not applied', 'application failed'))`
      ],
      ["last_observed_at", "ALTER TABLE runner_runs ADD COLUMN last_observed_at TEXT"],
      ["terminal_at", "ALTER TABLE runner_runs ADD COLUMN terminal_at TEXT"],
      ["run_failure_category", "ALTER TABLE runner_runs ADD COLUMN run_failure_category TEXT"],
      ["run_failure_message", "ALTER TABLE runner_runs ADD COLUMN run_failure_message TEXT"]
    ] as const;
    for (const [column, statement] of migrations) {
      if (!existingColumns.has(column)) yield* sql.unsafe(statement);
    }
    const attemptColumns = (yield* sql.unsafe("PRAGMA table_info(runner_attempts)")) as Array<{
      name?: unknown;
    }>;
    const existingAttemptColumns = new Set(
      attemptColumns.flatMap((column) =>
        typeof column.name === "string" ? [column.name] : []
      )
    );
    const schemaStateRows = yield* sql.unsafe(
      `SELECT failure_privacy_version AS failurePrivacyVersion
       FROM runner_schema_state WHERE singleton = 1`
    ).pipe(
      Effect.flatMap((rows) =>
        Schema.decodeUnknownEffect(Schema.Array(RunnerSchemaStateRow))(rows)
      )
    );
    const requiresFailurePrivacyMigration =
      (schemaStateRows[0]?.failurePrivacyVersion ?? 0) < 2;
    const attemptMigrations = [
      [
        "observed_stage",
        `ALTER TABLE runner_attempts ADD COLUMN observed_stage TEXT CHECK (observed_stage IS NULL OR observed_stage IN
          ('starting', 'Agent working', 'checking output', 'candidate ready',
           'succeeded', 'failed', 'needs attention'))`
      ],
      [
        "observation_source",
        `ALTER TABLE runner_attempts ADD COLUMN observation_source TEXT CHECK
          (observation_source IS NULL OR observation_source IN
           ('runner', 'runtime adapter', 'recovery', 'historical'))`
      ],
      ["observed_at", "ALTER TABLE runner_attempts ADD COLUMN observed_at TEXT"],
      [
        "observation_sequence",
        `ALTER TABLE runner_attempts ADD COLUMN observation_sequence INTEGER NOT NULL DEFAULT 0
         CHECK (observation_sequence >= 0)`
      ],
      [
        "terminal_outcome_json",
        `ALTER TABLE runner_attempts ADD COLUMN terminal_outcome_json TEXT
         CHECK (terminal_outcome_json IS NULL OR json_valid(terminal_outcome_json))`
      ],
      [
        "target_output_state",
        `ALTER TABLE runner_attempts ADD COLUMN target_output_state TEXT CHECK
          (target_output_state IS NULL OR target_output_state IN
           ('not observed', 'missing', 'present', 'unchanged', 'different'))`
      ],
      ["target_output_digest", "ALTER TABLE runner_attempts ADD COLUMN target_output_digest TEXT"],
      [
        "rejected_output_digest",
        "ALTER TABLE runner_attempts ADD COLUMN rejected_output_digest TEXT"
      ],
      ["rejected_output_path", "ALTER TABLE runner_attempts ADD COLUMN rejected_output_path TEXT"],
      [
        "failure_evidence_json",
        `ALTER TABLE runner_attempts ADD COLUMN failure_evidence_json TEXT
         CHECK (failure_evidence_json IS NULL OR json_valid(failure_evidence_json))`
      ],
      [
        "failure_stage",
        `ALTER TABLE runner_attempts ADD COLUMN failure_stage TEXT CHECK
          (failure_stage IS NULL OR failure_stage IN
           ('starting', 'Agent working', 'checking output', 'candidate ready'))`
      ]
    ] as const;
    for (const [column, statement] of attemptMigrations) {
      if (!existingAttemptColumns.has(column)) yield* sql.unsafe(statement);
    }
    if (requiresFailurePrivacyMigration) {
      const attemptFailures = yield* sql.unsafe(
        `SELECT attempt_id AS attemptId, failure_tag AS failureCategory
         FROM runner_attempts WHERE failure_message IS NOT NULL`
      ).pipe(
        Effect.flatMap((rows) =>
          Schema.decodeUnknownEffect(Schema.Array(StoredAttemptFailureRow))(rows)
        )
      );
      yield* Effect.forEach(
        attemptFailures,
        (row) => {
          const category = sanitizeFailureCategory(
            row.failureCategory,
            row.failureCategory ?? undefined
          );
          return sql.unsafe(
            `UPDATE runner_attempts SET failure_message = ? WHERE attempt_id = ?`,
            [safeFailureMessage(category), row.attemptId]
          );
        },
        { discard: true }
      );
      const runFailures = yield* sql.unsafe(
        `SELECT run_id AS runId, run_failure_category AS failureCategory
         FROM runner_runs WHERE run_failure_message IS NOT NULL`
      ).pipe(
        Effect.flatMap((rows) =>
          Schema.decodeUnknownEffect(Schema.Array(StoredRunFailureRow))(rows)
        )
      );
      yield* Effect.forEach(
        runFailures,
        (row) => {
          const category = sanitizeFailureCategory(
            row.failureCategory,
            row.failureCategory ?? undefined
          );
          return sql.unsafe(
            `UPDATE runner_runs SET run_failure_message = ? WHERE run_id = ?`,
            [safeFailureMessage(category), row.runId]
          );
        },
        { discard: true }
      );
      const terminalOutcomes = yield* sql.unsafe(
        `SELECT attempt_id AS attemptId, terminal_outcome_json AS terminalOutcomeJson
         FROM runner_attempts WHERE terminal_outcome_json IS NOT NULL`
      ).pipe(
        Effect.flatMap((rows) =>
          Schema.decodeUnknownEffect(Schema.Array(StoredTerminalOutcomeRow))(rows)
        )
      );
      yield* Effect.forEach(
        terminalOutcomes,
        (row) => {
          let sanitized: ReturnType<typeof sanitizeTerminalOutcome> = null;
          try {
            sanitized = sanitizeTerminalOutcome(JSON.parse(row.terminalOutcomeJson));
          } catch {
            sanitized = null;
          }
          return sql.unsafe(
            `UPDATE runner_attempts
             SET terminal_outcome_json = ? WHERE attempt_id = ?`,
            [sanitized === null ? null : canonicalJson(sanitized), row.attemptId]
          );
        },
        { discard: true }
      );
      const runtimeSessions = yield* sql.unsafe(
        `SELECT attempt_id AS attemptId, runtime_session_id AS runtimeSessionId
         FROM runner_attempts WHERE runtime_session_id IS NOT NULL`
      ).pipe(
        Effect.flatMap((rows) =>
          Schema.decodeUnknownEffect(Schema.Array(StoredRuntimeSessionRow))(rows)
        )
      );
      yield* Effect.forEach(
        runtimeSessions,
        (row) =>
          sql.unsafe(
            `UPDATE runner_attempts SET runtime_session_id = ? WHERE attempt_id = ?`,
            [sanitizeRuntimeSessionId(row.runtimeSessionId), row.attemptId]
          ),
        { discard: true }
      );
      yield* sql.unsafe(
        `UPDATE runner_attempts SET rejected_output_path = NULL
         WHERE rejected_output_path IS NOT NULL`
      );
      yield* sql.unsafe(
        `UPDATE runner_schema_state SET failure_privacy_version = 2
         WHERE singleton = 1`
      );
    }
    yield* sql.unsafe(repositoryBindingTrigger);
    yield* sql.unsafe(confirmedTargetsTrigger);
      })
    );
    if (databaseIdentity !== undefined) {
      yield* Effect.try({
        try: () => secureSqliteSidecars(databaseIdentity, "Runner database"),
        catch: (cause) =>
          new RunnerStoreError({
            operation: "initialize",
            message: cause instanceof Error ? cause.message : String(cause)
          })
      });
    }
  })().pipe(
    Effect.retry({
      times: 5,
      while: (cause) => !(cause instanceof RunnerStoreError)
    }),
    Effect.mapError((cause) => storeError("initialize", cause))
  );

  const enqueue = Effect.fn("RunnerStore.enqueue")(function*(input: {
    readonly approvedPlan: ApprovedPassExport;
    readonly repositoryRoot: string;
    readonly acceptedMissingReplacementPaths?: ReadonlyArray<string>;
    readonly confirmedTargets?: ReadonlyArray<ConfirmedTargetType>;
    readonly adapter: AdapterConfiguration;
    readonly maxConcurrency: number;
  }) {
    if (
      !Number.isSafeInteger(input.maxConcurrency) ||
      input.maxConcurrency < 1 ||
      input.maxConcurrency > MAX_RUNNER_CONCURRENCY
    ) {
      return yield* new RunnerStoreError({
        operation: "enqueue",
        message: `maxConcurrency must be an integer between 1 and ${MAX_RUNNER_CONCURRENCY}`
      });
    }

    const adapter = yield* Effect.try({
      try: () => Schema.decodeUnknownSync(AdapterConfiguration)(input.adapter),
      catch: (cause) =>
        new AdapterCompatibilityError({
          payloadId: "adapter",
          message: `Frozen Runtime adapter configuration is invalid: ${cause instanceof Error ? cause.message : String(cause)}`
        })
    });
    const frozen = yield* Effect.try({
      try: () => {
        if (input.approvedPlan.version !== "0.1.0-alpha.6") {
          throw new Error(`Unsupported approved Plan export ${input.approvedPlan.version}`);
        }
        const sourceSnapshot = input.approvedPlan.source_snapshot;
        if (
          repositoryRevisionContentDigest({
            orderedManifest: sourceSnapshot.files
          }) !== sourceSnapshot.content_digest
        ) {
          throw new Error("Approved Source Snapshot digests do not reproduce");
        }
        const paths = sourceSnapshot.files.map((file) => file.path);
        if (new Set(paths).size !== paths.length) {
          throw new Error("Approved Source Snapshot contains duplicate file paths");
        }
        const payloads = input.approvedPlan.payloads.map((payload) => {
          if (
            sha256Json(payload.control) !== payload.control_digest ||
            sha256Json(payload.agent_input) !== payload.agent_input_digest ||
            sha256Json(payload.payload) !== payload.payload_digest ||
            sha256Json({ control: payload.control, agent_input: payload.agent_input }) !==
              payload.payload_digest
          ) {
            throw new ApprovedPackageIntegrityError({
              payloadId: payload.payload_id,
              message: `Approved Agent Package ${payload.payload_id} does not match its bound digests`
            });
          }
          validateAgentPackage(payload, sourceSnapshot);
          return {
            payload,
            controlJson: canonicalJson(payload.control),
            agentInputJson: canonicalJson(payload.agent_input),
            packageJson: canonicalJson(payload.payload)
          };
        });
        return { sourceSnapshot, payloads };
      },
      catch: (cause) =>
        cause instanceof ApprovedPackageIntegrityError ||
        cause instanceof AdapterCompatibilityError
          ? cause
          : new ApprovedPackageIntegrityError({
              payloadId: "unknown",
              message: cause instanceof Error ? cause.message : String(cause)
            })
    });
    const frozenPayloads = frozen.payloads;
    const confirmedTargets = yield* Effect.try({
      try: () => {
        if (input.confirmedTargets === undefined) return [];
        const decoded = Schema.decodeUnknownSync(Schema.Array(ConfirmedTarget))(
          input.confirmedTargets
        );
        const targetPaths = decoded.map((target) => target.targetPath);
        if (new Set(targetPaths).size !== targetPaths.length) {
          throw new Error("Confirmed target state contains duplicate paths");
        }
        const approvedPaths = frozenPayloads
          .map(({ payload }) => payload.target_path)
          .toSorted();
        if (
          canonicalJson(targetPaths.toSorted()) !== canonicalJson(approvedPaths)
        ) {
          throw new Error(
            "Confirmed target state does not contain every approved target exactly once"
          );
        }
        return decoded.toSorted((left, right) =>
          left.targetPath.localeCompare(right.targetPath)
        );
      },
      catch: (cause) =>
        new RunnerStoreError({
          operation: "enqueue",
          message: cause instanceof Error ? cause.message : String(cause)
        })
    });
    const acceptedMissingReplacementPaths = [
      ...new Set(input.acceptedMissingReplacementPaths ?? [])
    ].toSorted();
    if (
      acceptedMissingReplacementPaths.length !==
      (input.acceptedMissingReplacementPaths ?? []).length
    ) {
      return yield* new RunnerStoreError({
        operation: "enqueue",
        message: "Accepted missing replacement paths contain duplicates"
      });
    }
    const approvedReplacementPaths = new Set(
      frozenPayloads
        .filter(({ payload }) => payload.operation === "replace")
        .map(({ payload }) => payload.target_path)
    );
    const invalidMissingPath = acceptedMissingReplacementPaths.find(
      (path) => !approvedReplacementPaths.has(path)
    );
    if (invalidMissingPath !== undefined) {
      return yield* new RunnerStoreError({
        operation: "enqueue",
        message: `Accepted missing path ${invalidMissingPath} is not an approved replace target`
      });
    }

    const runId = RunId.make(randomUUID());
    const createdAt = new Date().toISOString();
    const write = Effect.gen(function*() {
      yield* sql.unsafe(
        `INSERT INTO runner_runs
         (run_id, approved_pass_id, review_id, decision_id, decision_authority,
          decision_at, adapter_kind, provider_id, model_id, variant_id, sdk_version, cli_version,
          max_concurrency, state, repository_root, source_snapshot_id,
          source_snapshot_digest, source_snapshot_json, confirmed_targets_json,
          application_state, observation_sequence, observed_phase, last_observed_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?,
                 'not_applied', 0, 'generating candidates', ?, ?)`,
        [
          runId,
          input.approvedPlan.pass_id,
          input.approvedPlan.publication.review_id,
          input.approvedPlan.publication.decision_id,
          input.approvedPlan.publication.authority,
          input.approvedPlan.publication.decided_at,
          adapter.kind,
          adapter.providerId,
          adapter.modelId,
          adapter.variantId,
          adapter.sdkVersion,
          storedAdapterVersion(adapter),
          input.maxConcurrency,
          input.repositoryRoot,
          frozen.sourceSnapshot.revision_id,
          frozen.sourceSnapshot.content_digest,
          canonicalJson(frozen.sourceSnapshot),
          input.confirmedTargets === undefined ? null : canonicalJson(confirmedTargets),
          createdAt,
          createdAt
        ]
      );
      for (const [ordinal, frozen] of frozenPayloads.entries()) {
        yield* sql.unsafe(
          `INSERT INTO runner_jobs
           (job_id, run_id, ordinal, payload_id, target_path, operation,
            control_json, agent_input_json, package_json, control_digest,
            agent_input_digest, package_digest, state, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
          [
            JobId.make(randomUUID()),
            runId,
            ordinal,
            frozen.payload.payload_id,
            frozen.payload.target_path,
            frozen.payload.operation,
            frozen.controlJson,
            frozen.agentInputJson,
            frozen.packageJson,
            frozen.payload.control_digest,
            frozen.payload.agent_input_digest,
            frozen.payload.payload_digest,
            createdAt
          ]
        );
      }
      for (const targetPath of acceptedMissingReplacementPaths) {
        yield* sql.unsafe(
          `INSERT INTO runner_accepted_missing_replacements (run_id, target_path)
           VALUES (?, ?)`,
          [runId, targetPath]
        );
      }
    });

    yield* sql.withTransaction(write).pipe(
      Effect.mapError((cause) => storeError("enqueue", cause))
    );
    return {
      runId,
      passId: input.approvedPlan.pass_id,
      jobCount: frozenPayloads.length
    } satisfies EnqueuedRun;
  });

  const count = (table: "runner_runs" | "runner_jobs" | "runner_attempts") =>
    sql.unsafe(`SELECT COUNT(*) AS count FROM ${table}`).pipe(
      Effect.flatMap((rows) => Schema.decodeUnknownEffect(Schema.Array(CountRow))(rows)),
      Effect.map((rows) => rows[0]?.count ?? 0)
    );

  const inspect = Effect.fn("RunnerStore.inspect")(function*() {
    return RunnerCounts.make({
      runs: yield* count("runner_runs"),
      jobs: yield* count("runner_jobs"),
      attempts: yield* count("runner_attempts")
    });
  })().pipe(Effect.mapError((cause) => storeError("inspect", cause)));

  const readSavedRepositoryRoot = Effect.fn("RunnerStore.readSavedRepositoryRoot")(
    function*(scoreDatabasePath: string) {
      const rows = yield* sql.unsafe(
        `SELECT repository_root AS repositoryRoot
         FROM runner_repository_bindings
         WHERE score_database_path = ?`,
        [scoreDatabasePath]
      ).pipe(
        Effect.flatMap((unknownRows) =>
          Schema.decodeUnknownEffect(Schema.Array(SavedRepositoryRootRow))(unknownRows)
        )
      );
      return rows[0]?.repositoryRoot ?? null;
    }
  );

  const saveRepositoryRoot = Effect.fn("RunnerStore.saveRepositoryRoot")(function*(input: {
    readonly scoreDatabasePath: string;
    readonly repositoryRoot: string;
  }) {
    const now = new Date().toISOString();
    yield* sql.unsafe(
      `INSERT INTO runner_repository_bindings
       (score_database_path, repository_root, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(score_database_path) DO UPDATE SET
         repository_root = excluded.repository_root,
         updated_at = excluded.updated_at`,
      [input.scoreDatabasePath, input.repositoryRoot, now, now]
    );
  });

  const inspectRun = Effect.fn("RunnerStore.inspectRun")(function*(runId: RunId) {
    const runRows = yield* sql.unsafe(
      `SELECT run_id AS runId, approved_pass_id AS passId, state,
              repository_root AS repositoryRoot,
              source_snapshot_id AS sourceSnapshotId,
              source_snapshot_digest AS sourceSnapshotDigest,
              application_state AS applicationState, applied_at AS appliedAt,
              confirmed_targets_json AS confirmedTargetsJson,
              adapter_kind AS adapterKind, provider_id AS providerId,
              model_id AS modelId, variant_id AS variantId,
              sdk_version AS sdkVersion, cli_version AS cliVersion,
              max_concurrency AS maxConcurrency, created_at AS createdAt,
              observation_sequence AS observationSequence,
              observed_phase AS observedPhase, last_observed_at AS lastObservedAt,
              terminal_at AS terminalAt,
              run_failure_category AS runFailureCategory,
              run_failure_message AS runFailureMessage
       FROM runner_runs
       WHERE run_id = ?`,
      [runId]
    ).pipe(Effect.flatMap((rows) => Schema.decodeUnknownEffect(Schema.Array(RunRow))(rows)));
    const run = runRows[0];
    if (!run) {
      return yield* new RunnerStoreError({
        operation: "inspectRun",
        message: `Run ${runId} does not exist`
      });
    }
    const adapter = yield* Effect.try({
      try: () => decodeStoredAdapter(run),
      catch: (cause) =>
        new RunnerStoreError({
          operation: "inspectRun",
          message: `Run ${runId} has an invalid frozen Runtime adapter configuration: ${cause instanceof Error ? cause.message : String(cause)}`
        })
    });
    const jobs = yield* sql.unsafe(
      `SELECT job_id AS jobId, ordinal, target_path AS targetPath,
              operation, state, package_digest AS packageDigest
       FROM runner_jobs
       WHERE run_id = ?
       ORDER BY ordinal`,
      [runId]
    ).pipe(
      Effect.flatMap((rows) => Schema.decodeUnknownEffect(Schema.Array(JobSummaryRow))(rows))
    );
    const attemptHistory = yield* sql.unsafe(
      `SELECT j.job_id AS jobId, a.attempt_id AS attemptId,
              a.attempt_number AS attemptNumber, a.state,
              a.claimed_at AS claimedAt, a.completed_at AS completedAt,
              a.candidate_digest AS candidateDigest,
              a.failure_tag AS failureCategory, a.failure_stage AS failureStage,
              a.terminal_outcome_json AS terminalOutcomeJson,
              a.failure_evidence_json AS failureEvidenceJson
       FROM runner_jobs j
       JOIN runner_attempts a ON a.job_id = j.job_id
       WHERE j.run_id = ?
       ORDER BY j.ordinal, a.attempt_number`,
      [runId]
    ).pipe(
      Effect.flatMap((rows) =>
        Schema.decodeUnknownEffect(Schema.Array(AttemptSummaryRow))(rows)
      )
    );
    const observationJobs = yield* sql.unsafe(
      `SELECT j.job_id AS jobId, j.target_path AS targetPath, j.operation,
              j.agent_input_digest AS agentInputDigest, j.state AS jobState,
              j.created_at AS createdAt,
              a.attempt_id AS attemptId, a.state AS attemptState,
              a.claimed_at AS claimedAt, a.completed_at AS completedAt,
              a.observed_stage AS observedStage,
              a.observation_source AS observationSource,
              a.observed_at AS observedAt,
              a.observation_sequence AS observationSequence,
              a.runtime_session_id AS runtimeSessionId,
              a.failure_tag AS failureCategory,
              a.failure_message AS failureMessage,
              a.failure_stage AS failureStage,
              a.terminal_outcome_json AS terminalOutcomeJson,
              a.failure_evidence_json AS failureEvidenceJson,
              a.target_output_state AS targetOutputState,
              CASE WHEN a.candidate_digest IS NULL THEN 0 ELSE 1 END AS hasCandidate,
              a.rejected_output_digest AS rejectedOutputDigest,
              a.rejected_output_path AS rejectedOutputPath
       FROM runner_jobs j
       LEFT JOIN runner_attempts a ON a.attempt_id = (
         SELECT latest.attempt_id
         FROM runner_attempts latest
         WHERE latest.job_id = j.job_id
         ORDER BY latest.attempt_number DESC
         LIMIT 1
       )
       WHERE j.run_id = ?
       ORDER BY j.ordinal`,
      [runId]
    ).pipe(
      Effect.flatMap((rows) =>
        Schema.decodeUnknownEffect(Schema.Array(ObservationJobRow))(rows)
      )
    );
    const acceptedMissingReplacementPaths = yield* sql.unsafe(
      `SELECT target_path AS targetPath
       FROM runner_accepted_missing_replacements
       WHERE run_id = ?
       ORDER BY target_path`,
      [runId]
    ).pipe(
      Effect.flatMap((rows) =>
        Schema.decodeUnknownEffect(Schema.Array(AcceptedMissingReplacementRow))(rows)
      )
    );
    const confirmedTargets = yield* Effect.try({
      try: () =>
        run.confirmedTargetsJson === null
          ? []
          : Schema.decodeUnknownSync(Schema.Array(ConfirmedTarget))(
              JSON.parse(run.confirmedTargetsJson)
            ),
      catch: (cause) =>
        new RunnerStoreError({
          operation: "inspectRun",
          message: `Run ${runId} confirmed target state is invalid: ${cause instanceof Error ? cause.message : String(cause)}`
        })
    });
    const phase: RunObservationPhaseType =
      run.observedPhase === null
        ? run.applicationState === "applied"
          ? "applied"
          : run.applicationState === "apply_failed"
            ? "application failed"
            : run.applicationState === "applying"
              ? "applying all candidates"
              : run.state === "completed" || run.state === "completed_with_failures"
                ? "not applied"
                : "generating candidates"
        : (run.observedPhase as RunObservationPhaseType);
    const lastObservedAt = run.lastObservedAt ?? run.appliedAt ?? run.createdAt;
    const runFailureCategory =
      run.runFailureCategory === null
        ? null
        : sanitizeFailureCategory(run.runFailureCategory, run.runFailureCategory);
    const observation = yield* Schema.decodeUnknownEffect(RunObservation)({
      runId: run.runId,
      providerId: run.providerId,
      modelId: run.modelId,
      variantId: run.variantId,
      runtimeVersion: observedRuntimeVersion(adapter),
      createdAt: run.createdAt,
      lastObservedAt,
      terminalAt: run.terminalAt,
      sequence: run.observationSequence,
      phase,
      failureCategory: runFailureCategory,
      failureMessage:
        run.runFailureMessage === null || runFailureCategory === null
          ? null
          : safeFailureMessage(runFailureCategory),
      application: {
        state: run.applicationState,
        appliedAt: run.appliedAt,
        filesApplied:
          run.applicationState === "applied"
            ? true
            : run.applicationState === "not_applied"
              ? false
              : null
      },
      files: observationJobs.map((job) => {
        const stage: FileObservationStageType =
          job.attemptState === "succeeded" ||
          (job.attemptId === null && job.jobState === "succeeded")
            ? "succeeded"
            : job.attemptState === "failed" ||
                (job.attemptId === null && job.jobState === "failed")
              ? "failed"
              : job.attemptState === "needs_attention" ||
                  (job.attemptId === null && job.jobState === "needs_attention")
                ? "needs attention"
                : job.attemptId === null
                  ? job.jobState === "pending"
                    ? "waiting"
                    : "starting"
                  : ((job.observedStage ?? "starting") as FileObservationStageType);
        const source: ObservationSourceType =
          job.attemptId === null
            ? job.jobState === "pending"
              ? "runner"
              : "historical"
            : job.observationSource === null
              ? "historical"
              : (job.observationSource as ObservationSourceType);
        const targetOutputState: TargetOutputStateType =
          job.targetOutputState === null
            ? job.hasCandidate === 0
              ? "not observed"
              : job.operation === "create"
                ? "present"
                : "not observed"
            : (job.targetOutputState as TargetOutputStateType);
        const failureEvidence = storedFailureEvidence(job);
        const failureCategory = failureEvidence?.category ?? null;
        const terminalOutcome =
          failureEvidence === null
            ? storedTerminalOutcome(job.terminalOutcomeJson)
            : terminalOutcomeFromEvidence(failureEvidence);
        return {
          runId: run.runId,
          jobId: job.jobId,
          attemptId: job.attemptId,
          targetPath: job.targetPath,
          operation: job.operation,
          agentInputDigest: job.agentInputDigest,
          stage,
          source,
          observedAt: job.observedAt ?? job.completedAt ?? job.claimedAt ?? job.createdAt,
          claimedAt: job.claimedAt,
          terminalAt: job.completedAt,
          sequence: job.observationSequence ?? 0,
          runtimeSessionId:
            job.runtimeSessionId === null
              ? null
              : sanitizeRuntimeSessionId(job.runtimeSessionId),
          failureCategory,
          failureMessage:
            failureCategory === null
              ? null
              : failureEvidence?.reason ?? safeFailureMessage(failureCategory),
          failureStage: failureEvidence?.stage ?? null,
          terminalOutcome,
          targetOutputState,
          rejectedOutputDigest: job.rejectedOutputDigest,
          rejectedOutputPath: null,
          ...(failureEvidence === null ? {} : { failureEvidence })
        };
      })
    });
    return yield* Schema.decodeUnknownEffect(RunSnapshot)({
      runId: run.runId,
      passId: run.passId,
      state: run.state,
      repositoryRoot: run.repositoryRoot,
      sourceSnapshotId: run.sourceSnapshotId,
      sourceSnapshotDigest: run.sourceSnapshotDigest,
      applicationState: run.applicationState,
      appliedAt: run.appliedAt,
      acceptedMissingReplacementPaths: acceptedMissingReplacementPaths.map(
        ({ targetPath }) => targetPath
      ),
      confirmedTargets,
      adapter,
      maxConcurrency: run.maxConcurrency,
      jobs: jobs.map((job) => ({
        ...job,
        attempts: attemptHistory
          .filter((attempt) => attempt.jobId === job.jobId)
          .map((attempt) => ({
            attemptId: attempt.attemptId,
            attemptNumber: attempt.attemptNumber,
            state: attempt.state,
            claimedAt: attempt.claimedAt,
            completedAt: attempt.completedAt,
            candidateDigest: attempt.candidateDigest,
            failureEvidence: storedFailureEvidence(attempt)
          }))
      })),
      observation
    });
  });

  const inspectLatestRun = Effect.fn("RunnerStore.inspectLatestRun")(
    function*(repositoryRoot: string) {
      const rows = yield* sql.unsafe(
        `SELECT run_id AS runId
         FROM runner_runs
         WHERE repository_root = ?
         ORDER BY created_at DESC, rowid DESC
         LIMIT 1`,
        [repositoryRoot]
      ).pipe(
        Effect.flatMap((unknownRows) =>
          Schema.decodeUnknownEffect(Schema.Array(LatestRunRow))(unknownRows)
        )
      );
      const latest = rows[0];
      if (latest === undefined) {
        return yield* new RunnerStoreError({
          operation: "inspectLatestRun",
          message:
            "No Run is available for the current project. Start one with score start or use score status --run <id>."
        });
      }
      return yield* inspectRun(latest.runId);
    }
  );

  const claimNext = Effect.fn("RunnerStore.claimNext")(function*(runId: RunId) {
    return yield* sql.withTransaction(
      Effect.gen(function*() {
        const rows = yield* sql.unsafe(
          `SELECT j.job_id AS jobId, j.run_id AS runId,
                  j.target_path AS targetPath, j.operation,
                  j.control_json AS controlJson, j.agent_input_json AS agentInputJson,
                  j.package_digest AS packageDigest,
                  r.adapter_kind AS adapterKind,
                  r.provider_id AS providerId, r.model_id AS modelId,
                  r.variant_id AS variantId,
                  r.sdk_version AS sdkVersion,
                  r.cli_version AS cliVersion
           FROM runner_jobs j
           JOIN runner_runs r ON r.run_id = j.run_id
           WHERE j.run_id = ? AND j.state = 'pending'
           ORDER BY j.ordinal
           LIMIT 1`,
          [runId]
        ).pipe(
          Effect.flatMap((unknownRows) =>
            Schema.decodeUnknownEffect(Schema.Array(ClaimableJobRow))(unknownRows)
          )
        );
        const row = rows[0];
        if (!row) return null;
        yield* requireSupportedStoredJobProtocol("claimNext", row);
        const adapter = yield* Effect.try({
          try: () => decodeStoredAdapter(row),
          catch: (cause) =>
            new RunnerStoreError({
              operation: "claimNext",
              message: `Job ${row.targetPath} has an invalid frozen Runtime adapter configuration: ${cause instanceof Error ? cause.message : String(cause)}`
            })
        });
        const attemptId = AttemptId.make(randomUUID());
        const claimedAt = new Date().toISOString();
        yield* sql.unsafe(
          `UPDATE runner_jobs
           SET state = 'running'
           WHERE job_id = ? AND state = 'pending'`,
          [row.jobId]
        );
        const attemptNumberRows = yield* sql.unsafe(
          `SELECT COALESCE(MAX(attempt_number), 0) + 1 AS count
           FROM runner_attempts WHERE job_id = ?`,
          [row.jobId]
        ).pipe(
          Effect.flatMap((unknownRows) =>
            Schema.decodeUnknownEffect(Schema.Array(CountRow))(unknownRows)
          )
        );
        const attemptNumber = attemptNumberRows[0]?.count ?? 1;
        yield* sql.unsafe(
          `INSERT INTO runner_attempts
           (attempt_id, job_id, attempt_number, state, claimed_at,
            observed_stage, observation_source, observed_at, observation_sequence,
            target_output_state)
           VALUES (?, ?, ?, 'running', ?, 'starting', 'runner', ?, 1, 'not observed')`,
          [attemptId, row.jobId, attemptNumber, claimedAt, claimedAt]
        );
        yield* sql.unsafe(
          `UPDATE runner_runs
           SET observation_sequence = observation_sequence + 1,
               last_observed_at = ?
           WHERE run_id = ?`,
          [claimedAt, runId]
        );
        return yield* Schema.decodeUnknownEffect(ClaimedJob)({
          jobId: row.jobId,
          runId: row.runId,
          targetPath: row.targetPath,
          operation: row.operation,
          controlJson: row.controlJson,
          agentInputJson: row.agentInputJson,
          packageDigest: row.packageDigest,
          attemptId,
          adapter
        });
      })
    );
  });

  const recordAttemptObservation = Effect.fn("RunnerStore.recordAttemptObservation")(
    function*(input: {
      readonly job: ClaimedJobType;
      readonly stage: FileObservationStageType;
      readonly source: ObservationSourceType;
      readonly runtimeSessionId?: string;
      readonly targetOutputState?: TargetOutputStateType;
      readonly targetOutputDigest?: string;
    }) {
      const stageRank = fileObservationStageRank(input.stage);
      if (
        stageRank < 1 ||
        stageRank > 4 ||
        (input.stage === "starting" && input.runtimeSessionId === undefined)
      ) {
        return yield* new RunnerStoreError({
          operation: "recordAttemptObservation",
          message: `${input.stage} is not an intermediate Runtime Adapter observation`
        });
      }
      const observedAt = new Date().toISOString();
      const runtimeSessionId =
        input.runtimeSessionId === undefined
          ? null
          : sanitizeRuntimeSessionId(input.runtimeSessionId);
      yield* sql.withTransaction(
        Effect.gen(function*() {
          const attemptRows = yield* sql.unsafe(
            `UPDATE runner_attempts
             SET observed_stage = ?, observation_source = ?, observed_at = ?,
                 observation_sequence = observation_sequence + 1,
                 runtime_session_id = COALESCE(?, runtime_session_id),
                 target_output_state = COALESCE(?, target_output_state),
                 target_output_digest = COALESCE(?, target_output_digest)
             WHERE attempt_id = ? AND state = 'running'
               AND (
                 CASE observed_stage
                   WHEN 'starting' THEN 1
                   WHEN 'Agent working' THEN 2
                   WHEN 'checking output' THEN 3
                   WHEN 'candidate ready' THEN 4
                   ELSE 1
                 END < ?
                 OR (
                   ? = 'starting' AND observed_stage = 'starting' AND ? IS NOT NULL
                   AND (runtime_session_id IS NULL OR runtime_session_id <> ?)
                 )
               )
             RETURNING attempt_id AS id`,
            [
              input.stage,
              input.source,
              observedAt,
              runtimeSessionId,
              input.targetOutputState ?? null,
              input.targetOutputDigest ?? null,
              input.job.attemptId,
              stageRank,
              input.stage,
              runtimeSessionId,
              runtimeSessionId
            ]
          ).pipe(
            Effect.flatMap((rows) =>
              Schema.decodeUnknownEffect(Schema.Array(TransitionRow))(rows)
            )
          );
          if (attemptRows.length !== 1) {
            return yield* new RunnerStoreError({
              operation: "recordAttemptObservation",
              message: `Attempt ${input.job.attemptId} is no longer running or already reached ${input.stage}`
            });
          }
          yield* sql.unsafe(
            `UPDATE runner_runs
             SET observation_sequence = observation_sequence + 1,
                 last_observed_at = ?
             WHERE run_id = ?`,
            [observedAt, input.job.runId]
          );
        })
      );
    }
  );

  const recordRunPhase = Effect.fn("RunnerStore.recordRunPhase")(function*(input: {
    readonly runId: RunId;
    readonly phase: RunObservationPhaseType;
  }) {
    const phaseRank = runObservationPhaseRank(input.phase);
    if (phaseRank < 1 || phaseRank > 3) {
      return yield* new RunnerStoreError({
        operation: "recordRunPhase",
        message: `${input.phase} is not a nonterminal Run phase`
      });
    }
    const observedAt = new Date().toISOString();
    const isApplicationRetry = input.phase === "checking current target state";
    const rows = yield* sql.unsafe(
      `UPDATE runner_runs
       SET observed_phase = ?, last_observed_at = ?,
           observation_sequence = observation_sequence + 1,
           terminal_at = CASE WHEN ? = 1 THEN NULL ELSE terminal_at END,
           run_failure_category = CASE
             WHEN ? = 1 THEN NULL ELSE run_failure_category END,
           run_failure_message = CASE
             WHEN ? = 1 THEN NULL ELSE run_failure_message END
       WHERE run_id = ?
         AND (
           (terminal_at IS NULL
             AND CASE observed_phase
               WHEN 'checking current target state' THEN 1
               WHEN 'checking the complete set' THEN 2
               WHEN 'applying all candidates' THEN 3
               WHEN 'applied' THEN 4
               WHEN 'not applied' THEN 4
               WHEN 'application failed' THEN 4
               ELSE 0
             END < ?)
           OR (state = 'completed' AND terminal_at IS NOT NULL
             AND application_state IN ('not_applied', 'apply_failed') AND ? = 1)
         )
       RETURNING run_id AS id`,
      [
        input.phase,
        observedAt,
        isApplicationRetry ? 1 : 0,
        isApplicationRetry ? 1 : 0,
        isApplicationRetry ? 1 : 0,
        input.runId,
        phaseRank,
        isApplicationRetry ? 1 : 0
      ]
    ).pipe(
      Effect.flatMap((unknownRows) =>
        Schema.decodeUnknownEffect(Schema.Array(TransitionRow))(unknownRows)
      )
    );
    if (rows.length !== 1) {
      return yield* new RunnerStoreError({
        operation: "recordRunPhase",
        message: `Run ${input.runId} is terminal or already reached ${input.phase}`
      });
    }
  });

  const recordRunFailure = Effect.fn("RunnerStore.recordRunFailure")(function*(input: {
    readonly runId: RunId;
    readonly phase: "not applied" | "application failed";
    readonly failureCategory: FailureCategoryType;
  }) {
    const terminalAt = new Date().toISOString();
    const failureCategory = sanitizeFailureCategory(input.failureCategory);
    const rows = yield* sql.unsafe(
      `UPDATE runner_runs
       SET observed_phase = ?, last_observed_at = ?, terminal_at = ?,
           observation_sequence = observation_sequence + 1,
           run_failure_category = ?, run_failure_message = ?
       WHERE run_id = ?
         AND (terminal_at IS NULL OR (observed_phase = ? AND run_failure_category IS NULL))
       RETURNING run_id AS id`,
      [
        input.phase,
        terminalAt,
        terminalAt,
        failureCategory,
        safeFailureMessage(failureCategory),
        input.runId,
        input.phase
      ]
    ).pipe(
      Effect.flatMap((unknownRows) =>
        Schema.decodeUnknownEffect(Schema.Array(TransitionRow))(unknownRows)
      )
    );
    if (rows.length !== 1) {
      return yield* new RunnerStoreError({
        operation: "recordRunFailure",
        message: `Run ${input.runId} already has a terminal observation`
      });
    }
  });

  const completeSuccess = Effect.fn("RunnerStore.completeSuccess")(function*(input: {
    readonly job: ClaimedJobType;
    readonly content: string;
    readonly runtimeSessionId: string;
    readonly targetOutputState?: TargetOutputStateType;
    readonly targetOutputDigest?: string;
  }) {
    const completedAt = new Date().toISOString();
    const candidateDigest = sha256Bytes(input.content);
    yield* sql.withTransaction(
      Effect.gen(function*() {
        const attemptRows = yield* sql.unsafe(
          `UPDATE runner_attempts
           SET state = 'succeeded', completed_at = ?, candidate_path = ?,
               candidate_digest = ?, candidate_content = ?, runtime_session_id = ?,
               observed_stage = 'succeeded', observation_source = 'runner',
               observed_at = ?, observation_sequence = observation_sequence + 1,
               target_output_state = ?, target_output_digest = ?
           WHERE attempt_id = ? AND state = 'running'
           RETURNING attempt_id AS id`,
          [
            completedAt,
            input.job.targetPath,
            candidateDigest,
            input.content,
            sanitizeRuntimeSessionId(input.runtimeSessionId),
            completedAt,
            input.targetOutputState ??
              (input.job.operation === "create" ? "present" : "not observed"),
            input.targetOutputDigest ?? candidateDigest,
            input.job.attemptId
          ]
        ).pipe(
          Effect.flatMap((rows) =>
            Schema.decodeUnknownEffect(Schema.Array(TransitionRow))(rows)
          )
        );
        if (attemptRows.length !== 1) {
          return yield* new RunnerStoreError({
            operation: "completeSuccess",
            message: `Attempt ${input.job.attemptId} is no longer running`
          });
        }
        const jobRows = yield* sql.unsafe(
          `UPDATE runner_jobs SET state = 'succeeded'
           WHERE job_id = ? AND state = 'running'
           RETURNING job_id AS id`,
          [input.job.jobId]
        ).pipe(
          Effect.flatMap((rows) =>
            Schema.decodeUnknownEffect(Schema.Array(TransitionRow))(rows)
          )
        );
        if (jobRows.length !== 1) {
          return yield* new RunnerStoreError({
            operation: "completeSuccess",
            message: `Job ${input.job.jobId} is no longer running`
          });
        }
        yield* sql.unsafe(
          `UPDATE runner_runs
           SET observation_sequence = observation_sequence + 1,
               last_observed_at = ?
           WHERE run_id = ?`,
          [completedAt, input.job.runId]
        );
      })
    );
  });

  const completeFailure = Effect.fn("RunnerStore.completeFailure")(function*(input: {
    readonly job: ClaimedJobType;
    readonly failureEvidence: FailureEvidenceType;
    readonly runtimeSessionId?: string;
    readonly targetOutputState?: TargetOutputStateType;
    readonly targetOutputDigest?: string;
    readonly diagnosticContent?: string;
  }) {
    const completedAt = new Date().toISOString();
    const diagnosticContent = input.diagnosticContent;
    const diagnosticDigest =
      diagnosticContent === undefined ? null : sha256Bytes(diagnosticContent);
    yield* sql.withTransaction(
      Effect.gen(function*() {
        const stageRows = yield* sql.unsafe(
          `SELECT attempt_id AS attemptId, observed_stage AS observedStage
           FROM runner_attempts
           WHERE attempt_id = ? AND state = 'running'`,
          [input.job.attemptId]
        ).pipe(
          Effect.flatMap((rows) =>
            Schema.decodeUnknownEffect(Schema.Array(StoredAttemptStageRow))(rows)
          )
        );
        const observedStage = stageRows[0]?.observedStage;
        const failureStage =
          observedStage === "starting" ||
          observedStage === "Agent working" ||
          observedStage === "checking output" ||
          observedStage === "candidate ready"
            ? observedStage
            : null;
        const failureEvidence = sanitizeFailureEvidence(
          input.failureEvidence,
          failureStage
        );
        const failureMessage =
          failureEvidence.reason ?? safeFailureMessage(failureEvidence.category);
        const terminalOutcome = terminalOutcomeFromEvidence(failureEvidence);
        const attemptRows = yield* sql.unsafe(
          `UPDATE runner_attempts
           SET state = 'failed', completed_at = ?, failure_tag = ?, failure_message = ?,
               runtime_session_id = COALESCE(?, runtime_session_id),
               failure_stage = ?,
               observed_stage = 'failed', observation_source = 'runner', observed_at = ?,
               observation_sequence = observation_sequence + 1,
               terminal_outcome_json = ?, target_output_state = ?, target_output_digest = ?,
               rejected_output_digest = ?, rejected_output_path = ?,
               failure_evidence_json = ?
           WHERE attempt_id = ? AND state = 'running'
           RETURNING attempt_id AS id`,
          [
            completedAt,
            failureEvidence.category,
            failureMessage,
            input.runtimeSessionId === undefined
              ? null
              : sanitizeRuntimeSessionId(input.runtimeSessionId),
            failureStage,
            completedAt,
            canonicalJson(terminalOutcome),
            input.targetOutputState ??
              (diagnosticContent !== undefined && input.job.operation === "create"
                ? "present"
                : "not observed"),
            diagnosticDigest ?? input.targetOutputDigest ?? null,
            diagnosticDigest ?? input.targetOutputDigest ?? null,
            null,
            canonicalJson(failureEvidence),
            input.job.attemptId
          ]
        ).pipe(
          Effect.flatMap((rows) =>
            Schema.decodeUnknownEffect(Schema.Array(TransitionRow))(rows)
          )
        );
        if (attemptRows.length !== 1) {
          return yield* new RunnerStoreError({
            operation: "completeFailure",
            message: `Attempt ${input.job.attemptId} is no longer running`
          });
        }
        const jobRows = yield* sql.unsafe(
          `UPDATE runner_jobs SET state = 'failed'
           WHERE job_id = ? AND state = 'running'
           RETURNING job_id AS id`,
          [input.job.jobId]
        ).pipe(
          Effect.flatMap((rows) =>
            Schema.decodeUnknownEffect(Schema.Array(TransitionRow))(rows)
          )
        );
        if (jobRows.length !== 1) {
          return yield* new RunnerStoreError({
            operation: "completeFailure",
            message: `Job ${input.job.jobId} is no longer running`
          });
        }
        yield* sql.unsafe(
          `UPDATE runner_runs
           SET observation_sequence = observation_sequence + 1,
               last_observed_at = ?
           WHERE run_id = ?`,
          [completedAt, input.job.runId]
        );
      })
    );
  });

  const finalizeRun = Effect.fn("RunnerStore.finalizeRun")(function*(runId: RunId) {
    const activeRows = yield* sql.unsafe(
      `SELECT COUNT(*) AS count FROM runner_jobs
       WHERE run_id = ? AND state IN ('pending', 'running')`,
      [runId]
    ).pipe(
      Effect.flatMap((rows) => Schema.decodeUnknownEffect(Schema.Array(CountRow))(rows))
    );
    if ((activeRows[0]?.count ?? 0) > 0) {
      return yield* new RunnerStoreError({
        operation: "finalizeRun",
        message: `Run ${runId} still has active Jobs`
      });
    }
    const failedRows = yield* sql.unsafe(
      `SELECT COUNT(*) AS count FROM runner_jobs
       WHERE run_id = ? AND state IN ('failed', 'needs_attention')`,
      [runId]
    ).pipe(
      Effect.flatMap((rows) => Schema.decodeUnknownEffect(Schema.Array(CountRow))(rows))
    );
    const state = (failedRows[0]?.count ?? 0) > 0 ? "completed_with_failures" : "completed";
    const observedAt = new Date().toISOString();
    yield* sql.unsafe(
      `UPDATE runner_runs
       SET state = ?,
           observed_phase = CASE WHEN ? = 'completed' THEN observed_phase ELSE 'not applied' END,
           last_observed_at = ?,
           terminal_at = ?, observation_sequence = observation_sequence + 1
       WHERE run_id = ?`,
      [
        state,
        state,
        observedAt,
        state === "completed" ? null : observedAt,
        runId
      ]
    );
  });

  const runningAttemptCount = (runId: RunId) =>
    sql.unsafe(
      `SELECT COUNT(*) AS count
       FROM runner_attempts a
       JOIN runner_jobs j ON j.job_id = a.job_id
       WHERE j.run_id = ? AND a.state = 'running'`,
      [runId]
    ).pipe(
      Effect.flatMap((rows) => Schema.decodeUnknownEffect(Schema.Array(CountRow))(rows)),
      Effect.map((rows) => rows[0]?.count ?? 0)
    );

  const requireNoRunningAttempts = Effect.fn(
    "RunnerStore.requireNoRunningAttempts"
  )(function*(runId: RunId) {
    const runningAttempts = yield* runningAttemptCount(runId);
    if (runningAttempts > 0) {
      return yield* new RunRecoveryRequired({
        runId,
        runningAttempts,
        message: `Run ${runId} has ${runningAttempts} ambiguous in-flight Attempt(s); recover it explicitly before continuing`
      });
    }
  });

  const recoverRun = Effect.fn("RunnerStore.recoverRun")(function*(runId: RunId) {
    return yield* sql.withTransaction(
      Effect.gen(function*() {
        const count = yield* runningAttemptCount(runId);
        const recoveredAt = new Date().toISOString();
        if (count > 0) {
          yield* sql.unsafe(
            `UPDATE runner_attempts
             SET state = 'needs_attention', completed_at = ?,
                 failure_tag = 'AmbiguousExternalAttempt',
                 failure_message = ?,
                 failure_stage = CASE observed_stage
                   WHEN 'starting' THEN observed_stage
                   WHEN 'Agent working' THEN observed_stage
                   WHEN 'checking output' THEN observed_stage
                   WHEN 'candidate ready' THEN observed_stage
                   ELSE NULL
                 END,
                 observed_stage = 'needs attention', observation_source = 'recovery',
                 observed_at = ?, observation_sequence = observation_sequence + 1,
                 target_output_state = COALESCE(target_output_state, 'not observed')
             WHERE attempt_id IN (
               SELECT a.attempt_id
               FROM runner_attempts a
               JOIN runner_jobs j ON j.job_id = a.job_id
               WHERE j.run_id = ? AND a.state = 'running'
             )`,
            [
              recoveredAt,
              safeFailureMessage("ambiguous recovery"),
              recoveredAt,
              runId
            ]
          );
          yield* sql.unsafe(
            `UPDATE runner_jobs
             SET state = 'needs_attention'
             WHERE run_id = ? AND state = 'running'`,
            [runId]
          );
        }
        yield* sql.unsafe(
          `UPDATE runner_runs
           SET state = 'pending', observed_phase = 'generating candidates',
               last_observed_at = ?, terminal_at = NULL,
               observation_sequence = observation_sequence + ?
           WHERE run_id = ? AND state = 'running'`,
          [recoveredAt, count + 1, runId]
        );
        return count;
      })
    );
  });

  const prepareRetry = Effect.fn("RunnerStore.prepareRetry")(function*(input: {
    readonly runId: RunId;
    readonly targetPaths: ReadonlyArray<string>;
  }) {
    const runId = input.runId;
    return yield* sql.withTransaction(
      Effect.gen(function*() {
        const runRows = yield* sql.unsafe(
          `SELECT state, application_state AS applicationState
           FROM runner_runs WHERE run_id = ?`,
          [runId]
        ).pipe(
          Effect.flatMap((rows) =>
            Schema.decodeUnknownEffect(Schema.Array(RetryableRunRow))(rows)
          )
        );
        const run = runRows[0];
        if (
          run?.state !== "completed_with_failures" ||
          run.applicationState !== "not_applied"
        ) {
          return yield* new RunnerStoreError({
            operation: "prepareRetry",
            message: `Run ${runId} is not an unapplied Run with failed Jobs`
          });
        }
        const ambiguousAttempts = yield* runningAttemptCount(runId);
        if (ambiguousAttempts > 0) {
          return yield* new RunnerStoreError({
            operation: "prepareRetry",
            message:
              `Run ${runId} has ${ambiguousAttempts} ambiguous running ` +
              `${ambiguousAttempts === 1 ? "Attempt" : "Attempts"}; explicit recovery is required before retry`
          });
        }
        const attentionRows = yield* sql.unsafe(
          `SELECT COUNT(*) AS count FROM runner_jobs
           WHERE run_id = ? AND state = 'needs_attention'`,
          [runId]
        ).pipe(
          Effect.flatMap((rows) => Schema.decodeUnknownEffect(Schema.Array(CountRow))(rows))
        );
        if ((attentionRows[0]?.count ?? 0) > 0) {
          return yield* new RunnerStoreError({
            operation: "prepareRetry",
            message:
              `Run ${runId} has ambiguous needs_attention Jobs; use explicit recovery ` +
              "before retrying any failed Job"
          });
        }
        const failedRows = yield* sql.unsafe(
          `SELECT target_path AS targetPath FROM runner_jobs
           WHERE run_id = ? AND state = 'failed'`,
          [runId]
        ).pipe(
          Effect.flatMap((rows) =>
            Schema.decodeUnknownEffect(Schema.Array(TargetPathRow))(rows)
          )
        );
        const selectedTargets = [...new Set(input.targetPaths)];
        if (selectedTargets.length === 0) {
          return yield* new RunnerStoreError({
            operation: "prepareRetry",
            message: `Run ${runId} has no explicitly selected failed Jobs to retry`
          });
        }
        if (selectedTargets.length !== input.targetPaths.length) {
          return yield* new RunnerStoreError({
            operation: "prepareRetry",
            message: `Run ${runId} retry selection contains duplicate targets`
          });
        }
        const failedTargets = new Set(failedRows.map((row) => row.targetPath));
        const invalidTarget = selectedTargets.find(
          (targetPath) => !failedTargets.has(targetPath)
        );
        if (invalidTarget !== undefined) {
          return yield* new RunnerStoreError({
            operation: "prepareRetry",
            message: `${invalidTarget} is not an unambiguous failed Job in Run ${runId}`
          });
        }
        const reopenedAt = new Date().toISOString();
        yield* sql.unsafe(
          `UPDATE runner_jobs SET state = 'pending'
           WHERE run_id = ? AND state = 'failed'
             AND target_path IN (${selectedTargets.map(() => "?").join(", ")})`,
          [runId, ...selectedTargets]
        );
        const reopened = yield* sql.unsafe(
          `UPDATE runner_runs
           SET state = 'pending', observed_phase = 'generating candidates',
               last_observed_at = ?, terminal_at = NULL,
               observation_sequence = observation_sequence + 1,
               run_failure_category = NULL, run_failure_message = NULL
           WHERE run_id = ? AND state = 'completed_with_failures'
             AND application_state = 'not_applied'
           RETURNING run_id AS id`,
          [reopenedAt, runId]
        ).pipe(
          Effect.flatMap((rows) =>
            Schema.decodeUnknownEffect(Schema.Array(TransitionRow))(rows)
          )
        );
        if (reopened.length !== 1) {
          return yield* new RunnerStoreError({
            operation: "prepareRetry",
            message: `Run ${runId} changed while preparing its failed Jobs for retry`
          });
        }
        return selectedTargets.length;
      })
    );
  });

  const beginWork = Effect.fn("RunnerStore.beginWork")(function*(runId: RunId) {
    yield* sql.withTransaction(
      Effect.gen(function*() {
        const jobs = yield* sql.unsafe(
          `SELECT target_path AS targetPath, control_json AS controlJson
           FROM runner_jobs
           WHERE run_id = ?
           ORDER BY ordinal`,
          [runId]
        ).pipe(
          Effect.flatMap((unknownRows) =>
            Schema.decodeUnknownEffect(Schema.Array(StoredJobProtocolRow))(unknownRows)
          )
        );
        yield* Effect.forEach(
          jobs,
          (job) => requireSupportedStoredJobProtocol("beginWork", job),
          { discard: true }
        );
        const rows = yield* sql.unsafe(
          `UPDATE runner_runs
           SET state = 'running',
               observation_sequence = observation_sequence + 1,
               last_observed_at = ?
           WHERE run_id = ? AND state = 'pending'
           RETURNING run_id AS runId`,
          [new Date().toISOString(), runId]
        ).pipe(
          Effect.flatMap((unknownRows) =>
            Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ runId: RunId })))(
              unknownRows
            )
          )
        );
        if (rows.length !== 1) {
          return yield* new RunnerStoreError({
            operation: "beginWork",
            message: `Run ${runId} is not pending; another worker may already own it`
          });
        }
      })
    );
  });

  const readCandidates = Effect.fn("RunnerStore.readCandidates")(function*(runId: RunId) {
    const runRows = yield* sql.unsafe(
      "SELECT run_id FROM runner_runs WHERE run_id = ?",
      [runId]
    );
    if (runRows.length !== 1) {
      return yield* new RunnerStoreError({
        operation: "readCandidates",
        message: `Run ${runId} does not exist`
      });
    }
    return yield* sql.unsafe(
      `SELECT j.target_path AS targetPath,
              j.operation,
              j.agent_input_json AS agentInputJson,
              j.agent_input_digest AS agentInputDigest,
              j.package_json AS packageJson,
              j.package_digest AS packageDigest,
              a.candidate_digest AS candidateDigest,
              a.candidate_content AS content
       FROM runner_jobs j
       JOIN runner_attempts a ON a.job_id = j.job_id
       WHERE j.run_id = ? AND j.state = 'succeeded' AND a.state = 'succeeded'
       ORDER BY j.ordinal`,
      [runId]
    ).pipe(
      Effect.flatMap((rows) =>
        Schema.decodeUnknownEffect(Schema.Array(CandidateFile))(rows)
      )
    );
  });

  const readRepositoryBinding = Effect.fn("RunnerStore.readRepositoryBinding")(function*(
    runId: RunId
  ) {
    const rows = (yield* sql.unsafe(
      `SELECT repository_root AS repositoryRoot,
              source_snapshot_id AS sourceSnapshotId,
              source_snapshot_digest AS sourceSnapshotDigest,
              source_snapshot_json AS sourceSnapshotJson,
              confirmed_targets_json AS confirmedTargetsJson
       FROM runner_runs WHERE run_id = ?`,
      [runId]
    )) as Array<{
      repositoryRoot?: unknown;
      sourceSnapshotId?: unknown;
      sourceSnapshotDigest?: unknown;
      sourceSnapshotJson?: unknown;
      confirmedTargetsJson?: unknown;
    }>;
    const row = rows[0];
    if (
      !row ||
      typeof row.repositoryRoot !== "string" ||
      typeof row.sourceSnapshotId !== "string" ||
      typeof row.sourceSnapshotDigest !== "string" ||
      typeof row.sourceSnapshotJson !== "string"
    ) {
      return yield* new RunnerStoreError({
        operation: "readRepositoryBinding",
        message: `Run ${runId} has no frozen repository binding`
      });
    }
    const repositoryRoot = row.repositoryRoot;
    const sourceSnapshotId = row.sourceSnapshotId;
    const sourceSnapshotDigest = row.sourceSnapshotDigest;
    const sourceSnapshotJson = row.sourceSnapshotJson;
    const confirmedTargetsJson = row.confirmedTargetsJson;
    const sourceSnapshot = yield* Effect.try({
      try: () => {
        const snapshot = JSON.parse(sourceSnapshotJson) as RepositorySourceSnapshot;
        if (
          snapshot.revision_id !== sourceSnapshotId ||
          snapshot.content_digest !== sourceSnapshotDigest ||
          !Array.isArray(snapshot.files) ||
          repositoryRevisionContentDigest({
            orderedManifest: snapshot.files
          }) !== snapshot.content_digest
        ) {
          throw new Error("binding does not reproduce");
        }
        return snapshot;
      },
      catch: (cause) =>
        new RunnerStoreError({
          operation: "readRepositoryBinding",
          message: `Run ${runId} repository binding is invalid: ${cause instanceof Error ? cause.message : String(cause)}`
        })
    });
    const confirmedTargets = yield* Effect.try({
      try: () =>
        confirmedTargetsJson === null || confirmedTargetsJson === undefined
          ? []
          : Schema.decodeUnknownSync(Schema.Array(ConfirmedTarget))(
              JSON.parse(String(confirmedTargetsJson))
            ),
      catch: (cause) =>
        new RunnerStoreError({
          operation: "readRepositoryBinding",
          message: `Run ${runId} confirmed target state is invalid: ${cause instanceof Error ? cause.message : String(cause)}`
        })
    });
    return {
      repositoryRoot,
      sourceSnapshot,
      confirmedTargets
    } satisfies RepositoryBinding;
  });

  const beginApplication = Effect.fn("RunnerStore.beginApplication")(function*(runId: RunId) {
    const observedAt = new Date().toISOString();
    const rows = yield* sql.unsafe(
      `UPDATE runner_runs
       SET application_state = 'applying', observed_phase = 'applying all candidates',
           last_observed_at = ?, terminal_at = NULL,
           observation_sequence = observation_sequence + 1,
           run_failure_category = NULL, run_failure_message = NULL
       WHERE run_id = ? AND state = 'completed'
         AND application_state IN ('not_applied', 'apply_failed')
       RETURNING run_id AS id`,
      [observedAt, runId]
    ).pipe(
      Effect.flatMap((unknownRows) =>
        Schema.decodeUnknownEffect(Schema.Array(TransitionRow))(unknownRows)
      )
    );
    if (rows.length !== 1) {
      return yield* new RunnerStoreError({
        operation: "beginApplication",
        message: `Run ${runId} is not a complete unapplied Run`
      });
    }
  });

  const completeApplication = Effect.fn("RunnerStore.completeApplication")(function*(
    runId: RunId
  ) {
    const appliedAt = new Date().toISOString();
    const rows = yield* sql.unsafe(
      `UPDATE runner_runs
       SET application_state = 'applied', applied_at = ?, observed_phase = 'applied',
           last_observed_at = ?, terminal_at = ?,
           observation_sequence = observation_sequence + 1
       WHERE run_id = ? AND application_state = 'applying'
       RETURNING run_id AS id`,
      [appliedAt, appliedAt, appliedAt, runId]
    ).pipe(
      Effect.flatMap((unknownRows) =>
        Schema.decodeUnknownEffect(Schema.Array(TransitionRow))(unknownRows)
      )
    );
    if (rows.length !== 1) {
      return yield* new RunnerStoreError({
        operation: "completeApplication",
        message: `Run ${runId} is not applying`
      });
    }
  });

  const failApplication = Effect.fn("RunnerStore.failApplication")(function*(input: {
    readonly runId: RunId;
    readonly failureCategory: FailureCategoryType;
  }) {
    const failedAt = new Date().toISOString();
    const failureCategory = sanitizeFailureCategory(input.failureCategory);
    const rows = yield* sql.unsafe(
      `UPDATE runner_runs
       SET application_state = 'apply_failed', observed_phase = 'application failed',
           last_observed_at = ?, terminal_at = ?,
           observation_sequence = observation_sequence + 1,
           run_failure_category = ?, run_failure_message = ?
       WHERE run_id = ? AND application_state = 'applying'
       RETURNING run_id AS id`,
      [
        failedAt,
        failedAt,
        failureCategory,
        safeFailureMessage(failureCategory),
        input.runId
      ]
    ).pipe(
      Effect.flatMap((unknownRows) =>
        Schema.decodeUnknownEffect(Schema.Array(TransitionRow))(unknownRows)
      )
    );
    if (rows.length !== 1) {
      return yield* new RunnerStoreError({
        operation: "failApplication",
        message: `Run ${input.runId} is not applying`
      });
    }
  });

  return RunnerStore.of({
    initialize,
    enqueue,
    inspect,
    readSavedRepositoryRoot: (scoreDatabasePath) =>
      readSavedRepositoryRoot(scoreDatabasePath).pipe(
        Effect.mapError((cause) => storeError("readSavedRepositoryRoot", cause))
      ),
    saveRepositoryRoot: (input) =>
      saveRepositoryRoot(input).pipe(
        Effect.mapError((cause) => storeError("saveRepositoryRoot", cause))
      ),
    inspectLatestRun: (repositoryRoot) =>
      inspectLatestRun(repositoryRoot).pipe(
        Effect.mapError((cause) => storeError("inspectLatestRun", cause))
      ),
    inspectRun: (runId) =>
      inspectRun(runId).pipe(Effect.mapError((cause) => storeError("inspectRun", cause))),
    claimNext: (runId) =>
      claimNext(runId).pipe(Effect.mapError((cause) => storeError("claimNext", cause))),
    recordAttemptObservation: (input) =>
      recordAttemptObservation(input).pipe(
        Effect.mapError((cause) => storeError("recordAttemptObservation", cause))
      ),
    recordRunPhase: (input) =>
      recordRunPhase(input).pipe(
        Effect.mapError((cause) => storeError("recordRunPhase", cause))
      ),
    recordRunFailure: (input) =>
      recordRunFailure(input).pipe(
        Effect.mapError((cause) => storeError("recordRunFailure", cause))
      ),
    completeSuccess: (input) =>
      completeSuccess(input).pipe(
        Effect.mapError((cause) => storeError("completeSuccess", cause))
      ),
    completeFailure: (input) =>
      completeFailure(input).pipe(
        Effect.mapError((cause) => storeError("completeFailure", cause))
      ),
    finalizeRun: (runId) =>
      finalizeRun(runId).pipe(Effect.mapError((cause) => storeError("finalizeRun", cause))),
    requireNoRunningAttempts: (runId) =>
      requireNoRunningAttempts(runId).pipe(
        Effect.mapError((cause) =>
          cause instanceof RunRecoveryRequired
            ? cause
            : storeError("requireNoRunningAttempts", cause)
        )
      ),
    recoverRun: (runId) =>
      recoverRun(runId).pipe(Effect.mapError((cause) => storeError("recoverRun", cause))),
    prepareRetry: (input) =>
      prepareRetry(input).pipe(
        Effect.mapError((cause) => storeError("prepareRetry", cause))
      ),
    beginWork: (runId) =>
      beginWork(runId).pipe(Effect.mapError((cause) => storeError("beginWork", cause))),
    readCandidates: (runId) =>
      readCandidates(runId).pipe(
        Effect.mapError((cause) => storeError("readCandidates", cause))
      ),
    readRepositoryBinding: (runId) =>
      readRepositoryBinding(runId).pipe(
        Effect.mapError((cause) => storeError("readRepositoryBinding", cause))
      ),
    beginApplication: (runId) =>
      beginApplication(runId).pipe(
        Effect.mapError((cause) => storeError("beginApplication", cause))
      ),
    completeApplication: (runId) =>
      completeApplication(runId).pipe(
        Effect.mapError((cause) => storeError("completeApplication", cause))
      ),
    failApplication: (runId) =>
      failApplication(runId).pipe(
        Effect.mapError((cause) => storeError("failApplication", cause))
      )
  });
});

export const RunnerStoreLive = (databasePath: string) => {
  if (databasePath === ":memory:") {
    return Layer.effect(RunnerStore, makeRunnerStore(databasePath)).pipe(
      Layer.provide(SqliteClient.layer({ filename: databasePath, disableWAL: true }))
    );
  }
  return Layer.unwrap(
    Effect.try({
      try: () => {
        const state = prepareRunnerDatabaseState({
          databasePath,
          tightenExistingParent: false,
          createDatabase: true
        });
        if (state.database === undefined) {
          throw new Error("Runner database could not be created safely");
        }
        return state.database;
      },
      catch: (cause) =>
        new RunnerStoreError({
          operation: "initialize",
          message: cause instanceof Error ? cause.message : String(cause)
        })
    }).pipe(
      Effect.map((databaseIdentity) =>
        Layer.effect(
          RunnerStore,
          makeRunnerStore(databaseIdentity.path, databaseIdentity)
        ).pipe(
          Layer.provide(
            SqliteClient.layer({ filename: databaseIdentity.path, disableWAL: true })
          )
        )
      )
    )
  );
};
