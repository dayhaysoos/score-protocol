import { Schema } from "effect";

import type { RepositorySourceSnapshot } from "../repository-source-state.js";

export const RunId = Schema.String.pipe(Schema.brand("RunId"));
export type RunId = typeof RunId.Type;

export const JobId = Schema.String.pipe(Schema.brand("JobId"));
export type JobId = typeof JobId.Type;

export const AttemptId = Schema.String.pipe(Schema.brand("AttemptId"));
export type AttemptId = typeof AttemptId.Type;

export const FileOperation = Schema.Literals(["create", "replace", "delete"]);
export type FileOperation = typeof FileOperation.Type;

export const MAX_RUNNER_CONCURRENCY = 32;

export const OpenCodeAdapterConfiguration = Schema.Struct({
  kind: Schema.Literal("opencode"),
  providerId: Schema.String,
  modelId: Schema.String,
  variantId: Schema.NullOr(Schema.String),
  sdkVersion: Schema.String,
  cliVersion: Schema.String
});
export type OpenCodeAdapterConfiguration = typeof OpenCodeAdapterConfiguration.Type;

export const PiAdapterConfiguration = Schema.Struct({
  kind: Schema.Literal("pi"),
  providerId: Schema.String,
  modelId: Schema.String,
  variantId: Schema.NullOr(Schema.String),
  sdkVersion: Schema.String,
  workerProtocolVersion: Schema.String
});
export type PiAdapterConfiguration = typeof PiAdapterConfiguration.Type;

export const AdapterConfiguration = Schema.Union([
  OpenCodeAdapterConfiguration,
  PiAdapterConfiguration
]);
export type AdapterConfiguration = typeof AdapterConfiguration.Type;

export const RunnerCounts = Schema.Struct({
  runs: Schema.Number,
  jobs: Schema.Number,
  attempts: Schema.Number
});
export type RunnerCounts = typeof RunnerCounts.Type;

export const RunState = Schema.Literals([
  "pending",
  "running",
  "completed",
  "completed_with_failures"
]);
export type RunState = typeof RunState.Type;

export const ApplicationState = Schema.Literals([
  "not_applied",
  "applying",
  "applied",
  "apply_failed"
]);
export type ApplicationState = typeof ApplicationState.Type;

export const ConfirmedTarget = Schema.Union([
  Schema.Struct({
    targetPath: Schema.String,
    state: Schema.Literal("absent")
  }),
  Schema.Struct({
    targetPath: Schema.String,
    state: Schema.Literal("file"),
    contentDigest: Schema.String
  })
]);
export type ConfirmedTarget = typeof ConfirmedTarget.Type;

export const JobState = Schema.Literals([
  "pending",
  "running",
  "succeeded",
  "failed",
  "needs_attention"
]);
export type JobState = typeof JobState.Type;

export const AttemptState = Schema.Literals([
  "running",
  "succeeded",
  "failed",
  "needs_attention"
]);
export type AttemptState = typeof AttemptState.Type;

export const RunObservationPhase = Schema.Literals([
  "generating candidates",
  "checking current target state",
  "checking the complete set",
  "applying all candidates",
  "applied",
  "not applied",
  "application failed"
]);
export type RunObservationPhase = typeof RunObservationPhase.Type;

export const FileObservationStage = Schema.Literals([
  "waiting",
  "starting",
  "Agent working",
  "checking output",
  "candidate ready",
  "succeeded",
  "failed",
  "needs attention"
]);
export type FileObservationStage = typeof FileObservationStage.Type;

export const FailureObservationStage = Schema.Literals([
  "starting",
  "Agent working",
  "checking output",
  "candidate ready"
]);
export type FailureObservationStage = typeof FailureObservationStage.Type;

export const ObservationSource = Schema.Literals([
  "runner",
  "runtime adapter",
  "recovery",
  "historical"
]);
export type ObservationSource = typeof ObservationSource.Type;

export const TargetOutputState = Schema.Literals([
  "not observed",
  "missing",
  "present",
  "unchanged",
  "different"
]);
export type TargetOutputState = typeof TargetOutputState.Type;

export const FailureCategory = Schema.Literals([
  "provider",
  "tool",
  "timeout",
  "runtime",
  "workspace integrity",
  "missing output",
  "interruption",
  "ambiguous recovery",
  "candidate integrity",
  "target drift",
  "application",
  "persistence",
  "unknown"
]);
export type FailureCategory = typeof FailureCategory.Type;

export const FailureEvidenceStatus = Schema.Literals([
  "completed",
  "error",
  "running",
  "streaming",
  "unknown",
  "aborted"
]);
export type FailureEvidenceStatus = typeof FailureEvidenceStatus.Type;

const Sha256Digest = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^sha256:[0-9a-f]{64}$/))
);

export interface CandidateDeclarationFinding {
  readonly code: string;
  readonly declaration: string | null;
  readonly message: string;
}

const CandidateDeclarationFindingSchema = Schema.Struct({
  code: Schema.String,
  declaration: Schema.NullOr(Schema.String),
  message: Schema.String
});

export interface CandidateDeclarationFailureEvidence {
  readonly findings: ReadonlyArray<CandidateDeclarationFinding>;
  readonly bindingDigest: string | null;
  readonly candidateDigest: string;
  readonly verdictDigest: string | null;
}

/**
 * Bounded declaration-gate facts for a rejected final candidate. This records
 * only safe findings and content digests, never candidate or prompt bytes.
 */
const CandidateDeclarationFailureEvidenceSchema = Schema.Struct({
  findings: Schema.Array(CandidateDeclarationFindingSchema),
  bindingDigest: Schema.NullOr(Sha256Digest),
  candidateDigest: Sha256Digest,
  verdictDigest: Schema.NullOr(Sha256Digest)
});

/**
 * Adapter-neutral, bounded evidence explaining one failed File Job.
 * Runtime adapters populate every field they can know and use null for the rest;
 * RunnerStore adds the observed Runner stage before durable persistence.
 */
export const FailureEvidence = Schema.Struct({
  category: FailureCategory,
  stage: Schema.NullOr(FailureObservationStage),
  name: Schema.NullOr(Schema.String),
  status: Schema.NullOr(FailureEvidenceStatus),
  statusCode: Schema.NullOr(Schema.Number),
  reason: Schema.NullOr(Schema.String),
  declarationVerification: Schema.optionalKey(CandidateDeclarationFailureEvidenceSchema)
});
export type FailureEvidence = typeof FailureEvidence.Type;

export const TerminalOutcomeKind = Schema.Literals([
  "provider",
  "tool",
  "timeout",
  "runtime",
  "workspace",
  "interruption",
  "integrity",
  "application",
  "unknown"
]);
export type TerminalOutcomeKind = typeof TerminalOutcomeKind.Type;

export const SanitizedTerminalOutcome = Schema.Struct({
  kind: TerminalOutcomeKind,
  status: Schema.NullOr(
    Schema.Literals([
      "completed",
      "error",
      "running",
      "streaming",
      "unknown",
      "aborted"
    ])
  ),
  statusCode: Schema.NullOr(Schema.Number),
  name: Schema.NullOr(Schema.String)
});
export type SanitizedTerminalOutcome = typeof SanitizedTerminalOutcome.Type;

export const RunFileObservation = Schema.Struct({
  runId: RunId,
  jobId: JobId,
  attemptId: Schema.NullOr(AttemptId),
  targetPath: Schema.String,
  operation: FileOperation,
  agentInputDigest: Schema.String,
  stage: FileObservationStage,
  source: ObservationSource,
  observedAt: Schema.NullOr(Schema.String),
  claimedAt: Schema.NullOr(Schema.String),
  terminalAt: Schema.NullOr(Schema.String),
  sequence: Schema.Number,
  runtimeSessionId: Schema.NullOr(Schema.String),
  failureCategory: Schema.NullOr(FailureCategory),
  failureMessage: Schema.NullOr(Schema.String),
  failureStage: Schema.NullOr(FailureObservationStage),
  terminalOutcome: Schema.NullOr(SanitizedTerminalOutcome),
  targetOutputState: TargetOutputState,
  rejectedOutputDigest: Schema.NullOr(Schema.String),
  rejectedOutputPath: Schema.NullOr(Schema.String),
  failureEvidence: Schema.optionalKey(FailureEvidence)
});
export type RunFileObservation = typeof RunFileObservation.Type;

export const OpenCodeRunRuntimeVersion = Schema.Struct({
  sdkVersion: Schema.String,
  cliVersion: Schema.String
});
export type OpenCodeRunRuntimeVersion = typeof OpenCodeRunRuntimeVersion.Type;

export const PiRunRuntimeVersion = Schema.Struct({
  sdkVersion: Schema.String,
  workerProtocolVersion: Schema.String
});
export type PiRunRuntimeVersion = typeof PiRunRuntimeVersion.Type;

// runtimeVersion predates adapter-specific discriminators in the public status
// JSON. Keep OpenCode's exact encoded shape while naming Pi's worker protocol
// truthfully through the mutually exclusive version field.
export const RunRuntimeVersion = Schema.Union([
  OpenCodeRunRuntimeVersion,
  PiRunRuntimeVersion
]);
export type RunRuntimeVersion = typeof RunRuntimeVersion.Type;

export const RunObservation = Schema.Struct({
  runId: RunId,
  providerId: Schema.String,
  modelId: Schema.String,
  variantId: Schema.NullOr(Schema.String),
  runtimeVersion: RunRuntimeVersion,
  createdAt: Schema.String,
  lastObservedAt: Schema.String,
  terminalAt: Schema.NullOr(Schema.String),
  sequence: Schema.Number,
  phase: RunObservationPhase,
  failureCategory: Schema.NullOr(FailureCategory),
  failureMessage: Schema.NullOr(Schema.String),
  application: Schema.Struct({
    state: ApplicationState,
    appliedAt: Schema.NullOr(Schema.String),
    filesApplied: Schema.NullOr(Schema.Boolean)
  }),
  files: Schema.Array(RunFileObservation)
});
export type RunObservation = typeof RunObservation.Type;

export const RunAttemptSummary = Schema.Struct({
  attemptId: AttemptId,
  attemptNumber: Schema.Number,
  state: AttemptState,
  claimedAt: Schema.String,
  completedAt: Schema.NullOr(Schema.String),
  candidateDigest: Schema.NullOr(Schema.String),
  failureEvidence: Schema.NullOr(FailureEvidence)
});
export type RunAttemptSummary = typeof RunAttemptSummary.Type;

export const RunJobSummary = Schema.Struct({
  jobId: JobId,
  ordinal: Schema.Number,
  targetPath: Schema.String,
  operation: FileOperation,
  state: JobState,
  packageDigest: Schema.String,
  attempts: Schema.optionalKey(Schema.Array(RunAttemptSummary))
});
export type RunJobSummary = typeof RunJobSummary.Type;

export const RunSnapshot = Schema.Struct({
  runId: RunId,
  passId: Schema.String,
  state: RunState,
  repositoryRoot: Schema.NullOr(Schema.String),
  sourceSnapshotId: Schema.NullOr(Schema.String),
  sourceSnapshotDigest: Schema.NullOr(Schema.String),
  applicationState: ApplicationState,
  appliedAt: Schema.NullOr(Schema.String),
  acceptedMissingReplacementPaths: Schema.Array(Schema.String),
  confirmedTargets: Schema.Array(ConfirmedTarget),
  adapter: AdapterConfiguration,
  maxConcurrency: Schema.Number,
  jobs: Schema.Array(RunJobSummary),
  observation: RunObservation
});
export type RunSnapshot = typeof RunSnapshot.Type;

export const ClaimedJob = Schema.Struct({
  jobId: JobId,
  attemptId: AttemptId,
  runId: RunId,
  targetPath: Schema.String,
  operation: FileOperation,
  controlJson: Schema.String,
  agentInputJson: Schema.String,
  packageDigest: Schema.String,
  adapter: AdapterConfiguration
});
export type ClaimedJob = typeof ClaimedJob.Type;

export class PlanNotApproved extends Schema.TaggedError<PlanNotApproved>()(
  "PlanNotApproved",
  {
    passId: Schema.String,
    message: Schema.String
  }
) {}

export class ApprovedPackageIntegrityError extends Schema.TaggedError<ApprovedPackageIntegrityError>()(
  "ApprovedPackageIntegrityError",
  {
    payloadId: Schema.String,
    message: Schema.String
  }
) {}

export class AdapterCompatibilityError extends Schema.TaggedError<AdapterCompatibilityError>()(
  "AdapterCompatibilityError",
  {
    payloadId: Schema.String,
    message: Schema.String
  }
) {}

export class RunnerStoreError extends Schema.TaggedError<RunnerStoreError>()(
  "RunnerStoreError",
  {
    operation: Schema.String,
    message: Schema.String
  }
) {}

export class RunRecoveryRequired extends Schema.TaggedError<RunRecoveryRequired>()(
  "RunRecoveryRequired",
  {
    runId: RunId,
    runningAttempts: Schema.Number,
    message: Schema.String
  }
) {}

export interface EnqueueApprovedPlanInput {
  readonly scoreDatabasePath: string;
  readonly runnerDatabasePath: string;
  readonly passId: string;
  readonly repositoryRoot?: string;
  readonly acceptedMissingReplacementPaths?: ReadonlyArray<string>;
  readonly confirmedTargets?: ReadonlyArray<ConfirmedTarget>;
  readonly adapter: AdapterConfiguration;
  readonly maxConcurrency: number;
}

export interface EnqueuedRun {
  readonly runId: RunId;
  readonly passId: string;
  readonly jobCount: number;
}

export const CandidateFile = Schema.Struct({
  targetPath: Schema.String,
  operation: FileOperation,
  candidateDigest: Schema.String,
  content: Schema.String,
  agentInputJson: Schema.String,
  agentInputDigest: Schema.String,
  packageJson: Schema.String,
  packageDigest: Schema.String
});
export type CandidateFile = typeof CandidateFile.Type;

export interface RepositoryBinding {
  readonly repositoryRoot: string;
  readonly sourceSnapshot: RepositorySourceSnapshot;
  readonly confirmedTargets: ReadonlyArray<ConfirmedTarget>;
}
