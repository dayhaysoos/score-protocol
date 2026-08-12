import { isUtf8 } from "node:buffer";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, posix, relative } from "node:path";

import {
  Cause,
  Context,
  Effect,
  Exit,
  Layer,
  Result,
  Schema,
  SynchronizedRef
} from "effect";

import { sha256Bytes } from "../canonical.js";
import { sanitizeDiagnosticMessage as sanitizedMessage } from "./diagnostic-sanitization.js";
import { JobId, type ClaimedJob } from "./domain.js";
import {
  isolatedOpenCodeEnvironment,
  prepareOpenCodeIsolation
} from "./open-code-isolation.js";
import {
  makeOpenCodeV2Client,
  waitForOpenCodeV2Integrations,
  waitForOpenCodeV2Model,
  type OpenCodeV2AssistantMessage,
  type OpenCodeV2AssistantTool,
  type OpenCodeV2Client,
  type OpenCodeV2Message,
  type OpenCodeV2StructuredError
} from "./open-code-v2-client.js";
import {
  assertOpenCodeVersion,
  startOpenCodeServer,
  type StartedOpenCodeProcess
} from "./open-code-process.js";
import type {
  RuntimeAttemptFact,
  RuntimeAttemptReporter
} from "./runtime-attempt-observation.js";

export class AdapterInvocationError extends Schema.TaggedError<AdapterInvocationError>()(
  "AdapterInvocationError",
  {
    jobId: JobId,
    message: Schema.String,
    failureCategory: Schema.Literals([
        "runtime_startup",
        "provider",
        "tool",
        "timeout",
        "interruption",
        "missing_output",
      "workspace_integrity",
      "runtime_protocol",
      "runtime_cleanup"
    ]),
    runtimeSessionId: Schema.optional(Schema.String),
    terminalOutcome: Schema.optional(
      Schema.Struct({
        kind: Schema.Literals(["provider", "tool", "assistant", "runtime", "transport"]),
        name: Schema.optional(Schema.String),
        status: Schema.optional(
          Schema.Literals(["completed", "error", "running", "streaming", "unknown", "aborted"])
        ),
        statusCode: Schema.optional(Schema.Number)
      })
    ),
    targetOutputState: Schema.Literals([
      "not observed",
      "missing",
      "present",
      "unchanged",
      "different"
    ]),
    targetOutputDigest: Schema.optional(Schema.String),
    diagnosticContent: Schema.optional(Schema.String)
  }
) {}

export class AdapterBoundaryError extends Schema.TaggedError<AdapterBoundaryError>()(
  "AdapterBoundaryError",
  {
    jobId: JobId,
    message: Schema.String,
    failureCategory: Schema.Literals([
        "runtime_startup",
        "provider",
        "tool",
        "timeout",
        "interruption",
        "missing_output",
      "workspace_integrity",
      "runtime_protocol",
      "runtime_cleanup"
    ]),
    runtimeSessionId: Schema.optional(Schema.String),
    terminalOutcome: Schema.optional(
      Schema.Struct({
        kind: Schema.Literals(["provider", "tool", "assistant", "runtime", "transport"]),
        name: Schema.optional(Schema.String),
        status: Schema.optional(
          Schema.Literals(["completed", "error", "running", "streaming", "unknown", "aborted"])
        ),
        statusCode: Schema.optional(Schema.Number)
      })
    ),
    targetOutputState: Schema.Literals([
      "not observed",
      "missing",
      "present",
      "unchanged",
      "different"
    ]),
    targetOutputDigest: Schema.optional(Schema.String),
    diagnosticContent: Schema.optional(Schema.String)
  }
) {}

export type AdapterFailureCategory =
  | "runtime_startup"
  | "provider"
  | "tool"
  | "timeout"
  | "interruption"
  | "missing_output"
  | "workspace_integrity"
  | "runtime_protocol"
  | "runtime_cleanup";

export type TargetOutputState =
  | "not observed"
  | "missing"
  | "present"
  | "unchanged"
  | "different";

export interface SanitizedTerminalOutcome {
  readonly kind: "provider" | "tool" | "assistant" | "runtime" | "transport";
  readonly name?: string | undefined;
  readonly status?:
    | "completed"
    | "error"
    | "running"
    | "streaming"
    | "unknown"
    | "aborted"
    | undefined;
  readonly statusCode?: number | undefined;
}

export interface AdapterCandidate {
  readonly content: string;
  readonly runtimeSessionId: string;
  readonly targetOutputState?: TargetOutputState;
  readonly targetOutputDigest?: string;
}

export type OpenCodeAdapterError = AdapterInvocationError | AdapterBoundaryError;

export interface OpenCodeGatewayInput {
  readonly jobId: JobId;
  readonly workspacePath: string;
  readonly targetPath: string;
  readonly agentInputJson: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly variantId?: string;
  readonly cliVersion: string;
  readonly reporter?: RuntimeAttemptReporter;
}

interface RuntimeAttemptAccumulator {
  runtimeSessionId?: string;
  agentInputAdmitted: boolean;
}

function reportBestEffort(
  reporter: RuntimeAttemptReporter | undefined,
  fact: RuntimeAttemptFact
): Effect.Effect<void> {
  if (reporter === undefined) return Effect.void;
  return Effect.sync(() => reporter.report(fact)).pipe(
    Effect.flatMap((reported) =>
      reported.pipe(
        Effect.exit,
        Effect.asVoid,
        Effect.forkChild({ startImmediately: true }),
        Effect.asVoid
      )
    ),
    Effect.catchCause(() => Effect.void)
  );
}

function accumulatingReporter(
  accumulator: RuntimeAttemptAccumulator,
  downstream: RuntimeAttemptReporter | undefined
): RuntimeAttemptReporter {
  return {
    report: (fact) => {
      if (fact.runtimeSessionId !== undefined) {
        accumulator.runtimeSessionId = fact.runtimeSessionId;
      }
      if (fact.kind === "agent_input_admitted") {
        accumulator.agentInputAdmitted = true;
      }
      return reportBestEffort(downstream, fact);
    }
  };
}

export type OpenCodeGatewayInvoke = (
  input: OpenCodeGatewayInput
) => Effect.Effect<{ readonly runtimeSessionId: string }, AdapterInvocationError>;

export class OpenCodeGateway extends Context.Service<OpenCodeGateway, {
  readonly invoke: OpenCodeGatewayInvoke;
  readonly withRun: <A, E, R>(
    use: (invoke: OpenCodeGatewayInvoke) => Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | AdapterInvocationError, R>;
}>()("score/OpenCodeGateway") {}

export type OpenCodeJobInvoke = (
  job: ClaimedJob,
  reporter?: RuntimeAttemptReporter
) => Effect.Effect<AdapterCandidate, OpenCodeAdapterError>;

export class OpenCodeAdapter extends Context.Service<OpenCodeAdapter, {
  readonly invoke: OpenCodeJobInvoke;
  readonly withRun: <A, E, R>(
    use: (invoke: OpenCodeJobInvoke) => Effect.Effect<A, E, R>
  ) => Effect.Effect<A, E | OpenCodeAdapterError, R>;
}>()("score/OpenCodeAdapter") {}

const AgentTarget = Schema.Struct({
  path: Schema.String,
  operation: Schema.String,
  state_at_base_revision: Schema.String
});
const AgentInputRouting = Schema.Struct({
  target: AgentTarget,
  input_bindings: Schema.Array(
    Schema.Struct({
      kind: Schema.String,
      content: Schema.Unknown
    })
  )
});
const TargetStateContent = Schema.Struct({
  path: Schema.String,
  state_at_base_revision: Schema.String,
  content: Schema.optional(Schema.String)
});

interface TargetEvidence {
  readonly targetOutputState: TargetOutputState;
  readonly targetOutputDigest?: string;
  readonly diagnosticContent?: string;
}

class WorkspaceInspectionFailure extends Error {
  readonly failureCategory: "missing_output" | "workspace_integrity";
  readonly evidence: TargetEvidence;

  constructor(
    message: string,
    failureCategory: "missing_output" | "workspace_integrity",
    evidence: TargetEvidence
  ) {
    super(message);
    this.name = "WorkspaceInspectionFailure";
    this.failureCategory = failureCategory;
    this.evidence = evidence;
  }
}

function optionalEvidence(evidence: TargetEvidence) {
  return {
    targetOutputState: evidence.targetOutputState,
    ...(evidence.targetOutputDigest === undefined
      ? {}
      : { targetOutputDigest: evidence.targetOutputDigest }),
    ...(evidence.diagnosticContent === undefined
      ? {}
      : { diagnosticContent: evidence.diagnosticContent })
  };
}

function optionalTerminalOutcome(terminalOutcome: SanitizedTerminalOutcome | undefined) {
  return terminalOutcome === undefined ? {} : { terminalOutcome };
}

function boundaryError(
  job: ClaimedJob,
  cause: unknown,
  runtimeSessionId?: string
): AdapterBoundaryError {
  const inspection = cause instanceof WorkspaceInspectionFailure ? cause : undefined;
  const evidence = inspection?.evidence ?? { targetOutputState: "not observed" as const };
  return new AdapterBoundaryError({
    jobId: job.jobId,
    message: sanitizedMessage(cause instanceof Error ? cause.message : String(cause)),
    failureCategory: inspection?.failureCategory ?? "workspace_integrity",
    ...(runtimeSessionId === undefined ? {} : { runtimeSessionId }),
    ...optionalEvidence(evidence)
  });
}

function validatedTargetPath(job: ClaimedJob): string {
  const normalized = posix.normalize(job.targetPath);
  if (
    job.targetPath.length === 0 ||
    isAbsolute(job.targetPath) ||
    job.targetPath.includes("\\") ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized !== job.targetPath
  ) {
    throw new Error(`Unsafe Agent Package target path: ${job.targetPath}`);
  }
  return normalized;
}

function targetAncestors(targetPath: string): ReadonlySet<string> {
  const allowed = new Set<string>([targetPath]);
  let current = posix.dirname(targetPath);
  while (current !== ".") {
    allowed.add(current);
    current = posix.dirname(current);
  }
  return allowed;
}

interface WorkspaceEntry {
  readonly path: string;
  readonly isSymbolicLink: boolean;
}

function listWorkspaceEntries(
  workspacePath: string,
  currentPath = workspacePath
): WorkspaceEntry[] {
  const entries: WorkspaceEntry[] = [];
  for (const entry of readdirSync(currentPath, { withFileTypes: true })) {
    const absolutePath = join(currentPath, entry.name);
    const relativePath = relative(workspacePath, absolutePath).split("\\").join("/");
    entries.push({ path: relativePath, isSymbolicLink: entry.isSymbolicLink() });
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      entries.push(...listWorkspaceEntries(workspacePath, absolutePath));
    }
  }
  return entries.toSorted((left, right) => left.path.localeCompare(right.path));
}

function prepareWorkspace(
  job: ClaimedJob,
  workspacePath: string,
  targetPath: string
): string | undefined {
  const parsed = Schema.decodeUnknownSync(AgentInputRouting)(JSON.parse(job.agentInputJson));
  if (parsed.target.path !== targetPath || parsed.target.operation !== job.operation) {
    throw new Error("Agent Input target does not match the approved Run Rules");
  }
  const absoluteTarget = join(workspacePath, targetPath);
  mkdirSync(dirname(absoluteTarget), { recursive: true });

  if (job.operation === "create") return undefined;
  if (job.operation === "delete") {
    throw new Error("The first OpenCode adapter does not support delete operations");
  }
  const binding = parsed.input_bindings.find((input) => input.kind === "target_state");
  if (!binding) throw new Error("Replace operation is missing its target-state input");
  const targetState = Schema.decodeUnknownSync(TargetStateContent)(binding.content);
  if (
    targetState.path !== targetPath ||
    targetState.state_at_base_revision !== "present" ||
    targetState.content === undefined
  ) {
    throw new Error("Replace operation has an invalid target-state input");
  }
  writeFileSync(absoluteTarget, targetState.content, "utf8");
  return targetState.content;
}

function inspectAssignedTarget(
  job: ClaimedJob,
  workspacePath: string,
  targetPath: string,
  startingContent: string | undefined
): TargetEvidence {
  const absoluteTarget = join(workspacePath, targetPath);
  const targetSegments = targetPath.split("/");
  let status;
  for (const index of targetSegments.keys()) {
    const inspectedPath = join(workspacePath, ...targetSegments.slice(0, index + 1));
    try {
      status = lstatSync(inspectedPath);
    } catch (cause) {
      const code = record(cause)?.code;
      return { targetOutputState: code === "ENOENT" ? "missing" : "not observed" };
    }
    if (status.isSymbolicLink()) return { targetOutputState: "not observed" };
    if (index < targetSegments.length - 1 && !status.isDirectory()) {
      return { targetOutputState: "not observed" };
    }
  }
  if (status === undefined || !status.isFile()) {
    return { targetOutputState: "not observed" };
  }

  let bytes: Buffer;
  try {
    bytes = readFileSync(absoluteTarget);
  } catch {
    return { targetOutputState: "not observed" };
  }

  const targetOutputState =
    job.operation === "create"
      ? "present"
      : Buffer.from(startingContent ?? "", "utf8").equals(bytes)
        ? "unchanged"
        : "different";
  return {
    targetOutputState,
    targetOutputDigest: sha256Bytes(bytes),
    ...(isUtf8(bytes) ? { diagnosticContent: bytes.toString("utf8") } : {})
  };
}

function readCandidate(
  job: ClaimedJob,
  workspacePath: string,
  targetPath: string,
  startingContent: string | undefined
): {
  readonly content: string;
  readonly targetOutputState: "present" | "unchanged" | "different";
  readonly targetOutputDigest: string;
} {
  const diagnosticEvidence = inspectAssignedTarget(
    job,
    workspacePath,
    targetPath,
    startingContent
  );
  const allowed = targetAncestors(targetPath);
  let entries: ReadonlyArray<WorkspaceEntry>;
  try {
    entries = listWorkspaceEntries(workspacePath);
  } catch (cause) {
    throw new WorkspaceInspectionFailure(
      `OpenCode workspace could not be inspected: ${nestedErrorMessage(cause)}`,
      "workspace_integrity",
      diagnosticEvidence
    );
  }
  const symbolicLinks = entries.filter((entry) => entry.isSymbolicLink);
  if (symbolicLinks.length > 0) {
    throw new WorkspaceInspectionFailure(
      `OpenCode produced symbolic link(s): ${symbolicLinks.map((entry) => entry.path).join(", ")}`,
      "workspace_integrity",
      diagnosticEvidence
    );
  }
  const forbidden = entries.filter((entry) => !allowed.has(entry.path));
  if (forbidden.length > 0) {
    throw new WorkspaceInspectionFailure(
      `OpenCode changed undeclared path(s): ${forbidden.map((entry) => entry.path).join(", ")}`,
      "workspace_integrity",
      diagnosticEvidence
    );
  }
  const evidence = inspectAssignedTarget(job, workspacePath, targetPath, startingContent);
  if (evidence.targetOutputState === "missing") {
    throw new WorkspaceInspectionFailure(
      `OpenCode did not produce the assigned target file: ${targetPath}`,
      "missing_output",
      evidence
    );
  }
  if (evidence.targetOutputState === "not observed") {
    throw new WorkspaceInspectionFailure(
      `OpenCode did not produce a readable regular target file: ${targetPath}`,
      "workspace_integrity",
      evidence
    );
  }
  if (evidence.diagnosticContent === undefined) {
    throw new WorkspaceInspectionFailure(
      `OpenCode target is not valid UTF-8: ${targetPath}`,
      "workspace_integrity",
      evidence
    );
  }
  if (evidence.targetOutputDigest === undefined) {
    throw new WorkspaceInspectionFailure(
      `OpenCode target digest could not be computed: ${targetPath}`,
      "workspace_integrity",
      { targetOutputState: "not observed" }
    );
  }
  return {
    content: evidence.diagnosticContent,
    targetOutputState: evidence.targetOutputState,
    targetOutputDigest: evidence.targetOutputDigest
  };
}

export interface OpenCodeAdapterLiveOptions {
  readonly workspaceParent?: string;
}

const makeOpenCodeAdapter = (options: OpenCodeAdapterLiveOptions) =>
  Effect.gen(function*() {
    const gateway = yield* OpenCodeGateway;
    const invokeWith = (gatewayInvoke: OpenCodeGatewayInvoke) =>
      Effect.fn("OpenCodeAdapter.invoke")((
        job: ClaimedJob,
        reporter?: RuntimeAttemptReporter
      ) => {
        const workspaceParent = options.workspaceParent ?? tmpdir();
        const accumulator: RuntimeAttemptAccumulator = {
          agentInputAdmitted: false
        };
        const attemptReporter = accumulatingReporter(accumulator, reporter);
        return Effect.acquireUseRelease(
          Effect.try({
            try: () => {
              mkdirSync(workspaceParent, { recursive: true });
              return mkdtempSync(join(workspaceParent, "score-opencode-"));
            },
            catch: (cause) => boundaryError(job, cause)
          }),
          (jobDirectory) =>
            Effect.gen(function*() {
              const workspacePath = join(jobDirectory, "workspace");
              const prepared = yield* Effect.try({
                try: () => {
                  const path = validatedTargetPath(job);
                  mkdirSync(workspacePath, { recursive: true });
                  const startingContent = prepareWorkspace(job, workspacePath, path);
                  return { targetPath: path, startingContent };
                },
                catch: (cause) => boundaryError(job, cause)
              });
              const result = yield* gatewayInvoke({
                jobId: job.jobId,
                workspacePath,
                targetPath: prepared.targetPath,
                agentInputJson: job.agentInputJson,
                providerId: job.providerId,
                modelId: job.modelId,
                ...(job.variantId === null ? {} : { variantId: job.variantId }),
                cliVersion: job.cliVersion,
                reporter: attemptReporter
              }).pipe(
                Effect.matchEffect({
                  onFailure: (error) => {
                    if (!accumulator.agentInputAdmitted) {
                      return Effect.fail(
                        enrichInvocationError(error, accumulator, {
                          targetOutputState: "not observed"
                        })
                      );
                    }
                    return reportBestEffort(attemptReporter, {
                      kind: "workspace_inspection_started",
                      ...(accumulator.runtimeSessionId === undefined
                        ? {}
                        : { runtimeSessionId: accumulator.runtimeSessionId })
                    }).pipe(
                      Effect.andThen(
                        Effect.sync(() =>
                          inspectAssignedTarget(
                            job,
                            workspacePath,
                            prepared.targetPath,
                            prepared.startingContent
                          )
                        )
                      ),
                      Effect.flatMap((evidence) =>
                        Effect.fail(enrichInvocationError(error, accumulator, evidence))
                      )
                    );
                  },
                  onSuccess: Effect.succeed
                })
              );
              accumulator.runtimeSessionId = result.runtimeSessionId;
              yield* reportBestEffort(attemptReporter, {
                kind: "workspace_inspection_started",
                runtimeSessionId: result.runtimeSessionId
              });
              const candidate = yield* Effect.try({
                try: () =>
                  readCandidate(
                    job,
                    workspacePath,
                    prepared.targetPath,
                    prepared.startingContent
                  ),
                catch: (cause) => boundaryError(job, cause, result.runtimeSessionId)
              });
              return {
                ...candidate,
                runtimeSessionId: result.runtimeSessionId
              } satisfies AdapterCandidate;
            }),
          (path) => Effect.sync(() => rmSync(path, { recursive: true, force: true }))
        );
      });
    const withRun = <A, E, R>(
      use: (invoke: OpenCodeJobInvoke) => Effect.Effect<A, E, R>
    ): Effect.Effect<A, E | OpenCodeAdapterError, R> =>
      gateway.withRun((gatewayInvoke) => use(invokeWith(gatewayInvoke)));
    const invoke: OpenCodeJobInvoke = (job, reporter) =>
      withRun((runInvoke) => runInvoke(job, reporter));
    return OpenCodeAdapter.of({ invoke, withRun });
  });

export const OpenCodeAdapterLive = (options: OpenCodeAdapterLiveOptions = {}) =>
  Layer.effect(OpenCodeAdapter, makeOpenCodeAdapter(options));

export const OPENCODE_V2_CLIENT_VERSION = "0.0.0-next-17111";
export const OPENCODE_CLI_VERSION = "0.0.0-next-17111";

export interface OpenCodeGatewayLiveOptions {
  readonly command?: string;
  readonly startTimeoutMs?: number;
  readonly executionTimeoutMs?: number;
  readonly cleanupTimeoutMs?: number;
  readonly authPath?: string;
  readonly providerConfigPath?: string;
  readonly workspaceParent?: string;
}

type StartedOpenCodeServer = Pick<
  StartedOpenCodeProcess,
  "process" | "url" | "headers" | "close"
>;

function gatewaySignal(signal: AbortSignal, timeoutMs: number): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, Math.ceil(timeoutMs)))]);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

class ClassifiedRuntimeFailure extends Error {
  readonly failureCategory: AdapterFailureCategory;
  readonly terminalOutcome: SanitizedTerminalOutcome | undefined;

  constructor(
    message: string,
    failureCategory: AdapterFailureCategory,
    terminalOutcome?: SanitizedTerminalOutcome
  ) {
    super(message);
    this.name = "ClassifiedRuntimeFailure";
    this.failureCategory = failureCategory;
    this.terminalOutcome = terminalOutcome;
  }
}

function safeOutcomeName(value: string): string | undefined {
  const candidate = value.trim();
  if (!/^[a-z0-9][a-z0-9._:/ -]{0,119}$/iu.test(candidate)) return undefined;
  if (/authorization|bearer|api[-_ ]?key|secret|password|credential|token/iu.test(candidate)) {
    return undefined;
  }
  return candidate;
}

function terminalOutcome(input: SanitizedTerminalOutcome): SanitizedTerminalOutcome {
  const name = input.name === undefined ? undefined : safeOutcomeName(input.name);
  const statusCode =
    input.statusCode !== undefined &&
    Number.isSafeInteger(input.statusCode) &&
    input.statusCode >= 0 &&
    input.statusCode <= 999
      ? input.statusCode
      : undefined;
  return {
    kind: input.kind,
    ...(name === undefined ? {} : { name }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(statusCode === undefined ? {} : { statusCode })
  };
}

function providerErrorMessage(error: OpenCodeV2StructuredError): string {
  const qualifiers = [error.type, error.status === undefined ? undefined : `status ${error.status}`]
    .filter((value): value is string => value !== undefined)
    .join(", ");
  if (
    /auth(?:entication|orization)? (?:failed|failure)|invalid (?:api )?key|credential (?:invalid|missing)/iu.test(
      `${error.type} ${error.message}`
    )
  ) {
    return `OpenCode provider authentication failure (${qualifiers}): ${error.message}`;
  }
  if (/abort|interrupt/iu.test(error.type)) {
    return `OpenCode provider response was aborted: ${error.message}`;
  }
  return `OpenCode provider API failure (${qualifiers}): ${error.message}`;
}

function nestedErrorMessage(cause: unknown): string {
  if (!(cause instanceof Error)) {
    const value = record(cause);
    if (typeof value?.message === "string") {
      const tag = typeof value._tag === "string" ? `${value._tag}: ` : "";
      return sanitizedMessage(`${tag}${value.message}`);
    }
    return sanitizedMessage(String(cause));
  }
  const messages: string[] = [];
  let current: unknown = cause;
  while (current instanceof Error && messages.length < 4) {
    if (!messages.includes(current.message)) messages.push(current.message);
    current = current.cause;
  }
  const structuredCause = record(current);
  if (typeof structuredCause?.status === "number") {
    messages.push(`status ${structuredCause.status}`);
  }
  return sanitizedMessage(messages.join("; caused by: "));
}

function invocationError(
  input: OpenCodeGatewayInput,
  cause: unknown,
  options: {
    readonly failureCategory?: AdapterFailureCategory;
    readonly runtimeSessionId?: string;
    readonly terminalOutcome?: SanitizedTerminalOutcome;
  } = {}
): AdapterInvocationError {
  const classified = cause instanceof ClassifiedRuntimeFailure ? cause : undefined;
  const outcome = classified?.terminalOutcome ?? options.terminalOutcome;
  return new AdapterInvocationError({
    jobId: input.jobId,
    message: nestedErrorMessage(cause),
    failureCategory: classified?.failureCategory ?? options.failureCategory ?? "runtime_startup",
    ...(options.runtimeSessionId === undefined
      ? {}
      : { runtimeSessionId: options.runtimeSessionId }),
    ...optionalTerminalOutcome(outcome),
    targetOutputState: "not observed"
  });
}

function enrichInvocationError(
  error: AdapterInvocationError,
  accumulator: RuntimeAttemptAccumulator,
  evidence: TargetEvidence
): AdapterInvocationError {
  const runtimeSessionId = error.runtimeSessionId ?? accumulator.runtimeSessionId;
  return new AdapterInvocationError({
    jobId: error.jobId,
    message: sanitizedMessage(error.message),
    failureCategory: error.failureCategory,
    ...(runtimeSessionId === undefined ? {} : { runtimeSessionId }),
    ...optionalTerminalOutcome(error.terminalOutcome),
    ...optionalEvidence(evidence)
  });
}

function executionError(
  input: OpenCodeGatewayInput,
  server: StartedOpenCodeServer,
  runtimeSessionId: string,
  cause: unknown
): AdapterInvocationError {
  const detail = nestedErrorMessage(cause);
  if (cause instanceof ClassifiedRuntimeFailure) {
    return invocationError(input, cause, {
      runtimeSessionId,
      failureCategory: cause.failureCategory,
      ...(cause.terminalOutcome === undefined
        ? {}
        : { terminalOutcome: cause.terminalOutcome })
    });
  }
  if (
    server.process.exitCode !== null ||
    server.process.signalCode !== null ||
    /ECONNREFUSED|ECONNRESET|socket closed|other side closed/iu.test(detail)
  ) {
    const processState =
      server.process.exitCode === null && server.process.signalCode === null
        ? "exit state not yet observed"
        : `code ${String(server.process.exitCode)}, signal ${String(server.process.signalCode)}`;
    return new AdapterInvocationError({
      jobId: input.jobId,
      message:
        `OpenCode server process became unavailable during model execution ` +
        `(${processState}): ${detail}`,
      failureCategory: "runtime_protocol",
      runtimeSessionId,
      terminalOutcome: { kind: "transport", status: "error" },
      targetOutputState: "not observed"
    });
  }
  return new AdapterInvocationError({
    jobId: input.jobId,
    message: sanitizedMessage(`OpenCode model execution request failed: ${detail}`),
    failureCategory: "runtime_protocol",
    runtimeSessionId,
    terminalOutcome: { kind: "runtime", status: "error" },
    targetOutputState: "not observed"
  });
}

function selectedProviderConfig(
  configPath: string | undefined,
  providerId: string
): Record<string, unknown> | undefined {
  if (configPath === undefined) return undefined;
  const document = record(JSON.parse(readFileSync(configPath, "utf8")));
  const providers = record(document?.providers) ?? record(document?.provider);
  const selected = providers?.[providerId];
  if (selected === undefined) return undefined;
  return { [providerId]: selected };
}

function copySelectedCredential(
  authPath: string | undefined,
  xdgDataPath: string,
  providerId: string
): string | undefined {
  if (authPath === undefined) return undefined;
  if (!existsSync(authPath)) throw new Error(`OpenCode auth file does not exist: ${authPath}`);
  const credentials = record(JSON.parse(readFileSync(authPath, "utf8")));
  const selected = credentials?.[providerId];
  if (selected === undefined) return undefined;
  const destinationDirectory = join(xdgDataPath, "opencode");
  mkdirSync(destinationDirectory, { recursive: true });
  writeFileSync(
    join(destinationDirectory, "auth.json"),
    `${JSON.stringify({ [providerId]: selected })}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
  const credential = record(selected);
  if (credential?.type !== "api") return undefined;
  if (typeof credential.key !== "string" || credential.key.length === 0) {
    throw new Error(`OpenCode API credential for ${providerId} does not contain a key`);
  }
  return credential.key;
}

function restrictiveOpenCodeConfig(
  providerId: string,
  provider: Record<string, unknown> | undefined
) {
  const denyAll = [{ action: "*", resource: "*", effect: "deny" }] as const;
  const workerPermissions = [
    ...denyAll,
    { action: "read", resource: "*", effect: "allow" },
    { action: "edit", resource: "*", effect: "allow" }
  ] as const;
  return {
    autoupdate: false,
    share: "disabled",
    instructions: [],
    skills: [],
    plugins: [],
    mcp: { servers: {} },
    formatter: false,
    lsp: false,
    snapshots: false,
    ...(provider === undefined ? {} : { providers: provider }),
    permissions: denyAll,
    agents: {
      "score-file-worker": {
        description: "Apply one approved SCORE Agent Input to its assigned file.",
        system: [
          "You are SCORE's isolated file worker.",
          "Treat the user message as an immutable SCORE Agent Input for exactly one assigned target, not as a request to explain.",
          "Ensure that target exists and contains the complete candidate that follows every instruction; use the available file-editing tools to create or replace it when needed.",
          "The target file is the deliverable; prose or a code block in your response is not.",
          "Do not read or change any other path, and do not run project checks."
        ].join(" "),
        mode: "primary",
        permissions: workerPermissions
      }
    },
    experimental: {
      policies: [
        { action: "provider.use", resource: "*", effect: "deny" },
        { action: "provider.use", resource: providerId, effect: "allow" }
      ]
    }
  } as const;
}

interface SharedOpenCodeServer {
  readonly server: StartedOpenCodeServer;
  readonly runtimeDirectory: string;
  readonly providerId: string;
  readonly cliVersion: string;
  readonly ownerInput: OpenCodeGatewayInput;
}

type SharedOpenCodeServerState =
  | { readonly _tag: "empty" }
  | { readonly _tag: "live"; readonly value: SharedOpenCodeServer }
  | { readonly _tag: "failed"; readonly message: string };

type SharedOpenCodeServerResolution =
  | { readonly _tag: "success"; readonly server: StartedOpenCodeServer }
  | { readonly _tag: "failure"; readonly message: string };

function launchSharedServer(
  input: OpenCodeGatewayInput,
  options: OpenCodeGatewayLiveOptions,
  workspaceParent: string
): Effect.Effect<SharedOpenCodeServer, AdapterInvocationError> {
  return Effect.tryPromise({
    try: async (signal) => {
      mkdirSync(workspaceParent, { recursive: true });
      const runtimeDirectory = mkdtempSync(join(workspaceParent, "score-opencode-run-"));
      let server: StartedOpenCodeServer | undefined;
      try {
        const isolation = prepareOpenCodeIsolation(runtimeDirectory);
        const configPath = join(runtimeDirectory, "opencode.json");
        const command = options.command ?? "opencode2";
        assertOpenCodeVersion(command, input.cliVersion);
        const apiKey = copySelectedCredential(
          options.authPath,
          isolation.xdgDataPath,
          input.providerId
        );
        const config = restrictiveOpenCodeConfig(
          input.providerId,
          selectedProviderConfig(options.providerConfigPath, input.providerId)
        );
        writeFileSync(configPath, `${JSON.stringify(config)}\n`, "utf8");
        server = await startOpenCodeServer({
          command,
          cwd: runtimeDirectory,
          environment: isolatedOpenCodeEnvironment(isolation, configPath, config),
          startTimeoutMs: options.startTimeoutMs ?? 10_000,
          signal
        });
        const client = makeOpenCodeV2Client({
          baseUrl: server.url,
          headers: server.headers
        });
        const startupTimeoutMs = options.startTimeoutMs ?? 10_000;
        const startupSignal = gatewaySignal(signal, startupTimeoutMs);
        if (apiKey !== undefined) {
          await waitForOpenCodeV2Integrations(
            client,
            runtimeDirectory,
            [input.providerId],
            startupTimeoutMs,
            startupSignal
          );
          await client.connectKey(input.providerId, runtimeDirectory, apiKey, startupSignal);
        }
        await waitForOpenCodeV2Model(
          client,
          runtimeDirectory,
          input.providerId,
          input.modelId,
          startupTimeoutMs,
          startupSignal
        );
        return {
          server,
          runtimeDirectory,
          providerId: input.providerId,
          cliVersion: input.cliVersion,
          ownerInput: input
        };
      } catch (cause) {
        const cleanupFailures: string[] = [];
        if (server !== undefined) {
          try {
            await server.close();
          } catch (cleanupCause) {
            cleanupFailures.push(`server shutdown failed: ${nestedErrorMessage(cleanupCause)}`);
          }
        }
        try {
          rmSync(runtimeDirectory, { recursive: true, force: true });
        } catch (cleanupCause) {
          cleanupFailures.push(`runtime cleanup failed: ${nestedErrorMessage(cleanupCause)}`);
        }
        if (cleanupFailures.length > 0) {
          throw new Error(
            `${nestedErrorMessage(cause)}; cleanup also failed: ${cleanupFailures.join("; ")}`,
            { cause }
          );
        }
        throw cause;
      }
    },
    catch: (cause) => invocationError(input, cause)
  });
}

function resolveSharedServer(
  input: OpenCodeGatewayInput,
  options: OpenCodeGatewayLiveOptions,
  workspaceParent: string,
  state: SynchronizedRef.SynchronizedRef<SharedOpenCodeServerState>
): Effect.Effect<StartedOpenCodeServer, AdapterInvocationError> {
  return SynchronizedRef.modifyEffect(
    state,
    (
      current
    ): Effect.Effect<
      readonly [SharedOpenCodeServerResolution, SharedOpenCodeServerState]
    > => {
      if (current._tag === "failed") {
        return Effect.succeed([
          {
            _tag: "failure",
            message: current.message
          } satisfies SharedOpenCodeServerResolution,
          current
        ] as const);
      }
      if (current._tag === "live") {
        const mismatch =
          current.value.providerId !== input.providerId
            ? `OpenCode Run server provider mismatch: expected ${current.value.providerId}, received ${input.providerId}`
            : current.value.cliVersion !== input.cliVersion
              ? `OpenCode Run server CLI version mismatch: expected ${current.value.cliVersion}, received ${input.cliVersion}`
              : undefined;
        return Effect.succeed([
          mismatch === undefined
            ? ({
                _tag: "success",
                server: current.value.server
              } satisfies SharedOpenCodeServerResolution)
            : ({
                _tag: "failure",
                message: mismatch
              } satisfies SharedOpenCodeServerResolution),
          current
        ] as const);
      }
      return Effect.exit(launchSharedServer(input, options, workspaceParent)).pipe(
        Effect.map((exit) => {
          if (Exit.isSuccess(exit)) {
            return [
              {
                _tag: "success",
                server: exit.value.server
              } satisfies SharedOpenCodeServerResolution,
              { _tag: "live", value: exit.value } satisfies SharedOpenCodeServerState
            ] as const;
          }
          const error = Cause.findError(exit.cause);
          const message = Result.isSuccess(error)
            ? (error.success as { readonly message: string }).message
            : "OpenCode Run server startup failed";
          return [
            { _tag: "failure", message } satisfies SharedOpenCodeServerResolution,
            { _tag: "failed", message } satisfies SharedOpenCodeServerState
          ] as const;
        })
      );
    }
  ).pipe(
    Effect.flatMap((resolution) =>
      resolution._tag === "success"
        ? Effect.succeed(resolution.server)
        : Effect.fail(
            new AdapterInvocationError({
              jobId: input.jobId,
              message: sanitizedMessage(resolution.message),
              failureCategory: "runtime_startup",
              targetOutputState: "not observed"
            })
          )
    )
  );
}

function releaseSharedServer(
  state: SynchronizedRef.SynchronizedRef<SharedOpenCodeServerState>
): Effect.Effect<void, AdapterInvocationError> {
  return SynchronizedRef.get(state).pipe(
    Effect.flatMap((current) => {
      if (current._tag !== "live") return Effect.void;
      return Effect.tryPromise({
        try: async () => {
          try {
            await current.value.server.close();
          } finally {
            rmSync(current.value.runtimeDirectory, { recursive: true, force: true });
          }
        },
        catch: (cause) =>
          invocationError(current.value.ownerInput, cause, {
            failureCategory: "runtime_cleanup"
          })
      });
    })
  );
}

export const DEFAULT_OPENCODE_EXECUTION_TIMEOUT_MS = 30 * 60 * 1_000;
export const DEFAULT_OPENCODE_CLEANUP_TIMEOUT_MS = 5_000;

interface OpenCodeSessionResource {
  readonly client: OpenCodeV2Client;
  readonly sessionId: string;
  abortForDeadline: boolean;
}

function acquireOpenCodeSession(
  input: OpenCodeGatewayInput,
  server: StartedOpenCodeServer
): Effect.Effect<OpenCodeSessionResource, AdapterInvocationError> {
  return Effect.tryPromise({
    try: async (signal) => {
      const client = makeOpenCodeV2Client({
        baseUrl: server.url,
        headers: server.headers
      });
      const health = await client.health(signal);
      if (!health.healthy) throw new Error("OpenCode server health check failed");
      const session = await client.createSession(
        {
          title: `SCORE ${input.targetPath}`,
          agent: "score-file-worker",
          model: {
            id: input.modelId,
            providerID: input.providerId,
            ...(input.variantId === undefined ? {} : { variant: input.variantId })
          },
          location: { directory: input.workspacePath }
        },
        signal
      );
      return { client, sessionId: session.id, abortForDeadline: false };
    },
    catch: (cause) => invocationError(input, cause)
  }).pipe(
    Effect.tap((resource) =>
      reportBestEffort(input.reporter, {
        kind: "runtime_session_created",
        runtimeSessionId: resource.sessionId
      })
    )
  );
}

function assistantMessages(
  messages: ReadonlyArray<OpenCodeV2Message>
): ReadonlyArray<OpenCodeV2AssistantMessage> {
  return messages.filter(
    (message): message is OpenCodeV2AssistantMessage => message.type === "assistant"
  );
}

function assistantTools(
  messages: ReadonlyArray<OpenCodeV2AssistantMessage>
): ReadonlyArray<OpenCodeV2AssistantTool> {
  return messages.flatMap((message) =>
    message.content.filter(
      (content): content is OpenCodeV2AssistantTool => content.type === "tool"
    )
  );
}

function monitorOpenCodeSession(
  input: OpenCodeGatewayInput,
  resource: OpenCodeSessionResource,
  server: StartedOpenCodeServer
): Effect.Effect<{ readonly runtimeSessionId: string }, AdapterInvocationError> {
  const executionRequest = <A>(tryRequest: (signal: AbortSignal) => Promise<A>) =>
    Effect.tryPromise({
      try: tryRequest,
      catch: (cause) => executionError(input, server, resource.sessionId, cause)
    });

  return Effect.gen(function*() {
    yield* executionRequest(async (signal) => {
      const promptInputId = `msg_${randomUUID().replaceAll("-", "")}`;
      const admitted = await resource.client.prompt(
        resource.sessionId,
        {
          id: promptInputId,
          text: input.agentInputJson,
          resume: true
        },
        signal
      );
      if (admitted.id !== promptInputId || admitted.sessionID !== resource.sessionId) {
        throw new ClassifiedRuntimeFailure(
          "OpenCode returned a mismatched prompt admission receipt",
          "runtime_protocol",
          { kind: "transport", status: "error" }
        );
      }
    });
    yield* reportBestEffort(input.reporter, {
      kind: "agent_input_admitted",
      runtimeSessionId: resource.sessionId
    });

    return yield* executionRequest(async (signal) => {
      await resource.client.wait(resource.sessionId, signal);

      const messages = await resource.client.messages(resource.sessionId, signal);

      const assistants = assistantMessages(messages);
      const providerFailure = assistants.find((message) => message.error !== undefined);
      if (providerFailure?.error) {
        const providerError = providerFailure.error;
        const interrupted = /abort|interrupt/iu.test(providerError.type);
        throw new ClassifiedRuntimeFailure(
          providerErrorMessage(providerError),
          interrupted ? "interruption" : "provider",
          terminalOutcome({
            kind: "provider",
            name: providerError.type,
            status: interrupted ? "aborted" : "error",
            ...(providerError.status === undefined ? {} : { statusCode: providerError.status })
          })
        );
      }
      if (assistants.some((message) => message.finish === "error")) {
        throw new ClassifiedRuntimeFailure(
          "OpenCode assistant turn finished with an error",
          "runtime_protocol",
          { kind: "assistant", status: "error" }
        );
      }

      const tools = assistantTools(assistants);
      const failedTool = tools.find((tool) => tool.state.status === "error");
      if (failedTool?.state.status === "error") {
        throw new ClassifiedRuntimeFailure(
          `OpenCode tool failure: ${failedTool.state.error.message}`,
          "tool",
          terminalOutcome({
            kind: "tool",
            name: failedTool.name,
            status: "error",
            ...(failedTool.state.error.status === undefined
              ? {}
              : { statusCode: failedTool.state.error.status })
          })
        );
      }
      const incompleteTool = tools.find((tool) => tool.state.status !== "completed");
      if (incompleteTool) {
        const status: string = incompleteTool.state.status;
        if (status === "streaming" || status === "running") {
          throw new ClassifiedRuntimeFailure(
            `OpenCode left tool ${incompleteTool.name} unsettled after session wait`,
            "tool",
            terminalOutcome({ kind: "tool", name: incompleteTool.name, status })
          );
        }
        throw new ClassifiedRuntimeFailure(
          `OpenCode tool ${incompleteTool.name} has status ${status}; only completed tools are accepted`,
          "tool",
          terminalOutcome({ kind: "tool", name: incompleteTool.name, status: "unknown" })
        );
      }

      if (!assistants.some((message) => message.time.completed !== undefined)) {
        throw new ClassifiedRuntimeFailure(
          "OpenCode became idle without a completed assistant turn",
          "runtime_protocol",
          { kind: "assistant", status: "unknown" }
        );
      }

      return { runtimeSessionId: resource.sessionId };
    });
  });
}

function releaseOpenCodeSession(
  input: OpenCodeGatewayInput,
  resource: OpenCodeSessionResource,
  exit: Exit.Exit<unknown, AdapterInvocationError>,
  cleanupTimeoutMs: number
): Effect.Effect<void, AdapterInvocationError> {
  const interrupted = Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause);
  return Effect.tryPromise({
    try: async () => {
      const failures: string[] = [];
      if (resource.abortForDeadline || interrupted) {
        try {
          await resource.client.interrupt(
            resource.sessionId,
            AbortSignal.timeout(Math.max(1, cleanupTimeoutMs))
          );
        } catch (cause) {
          failures.push(`OpenCode session interrupt failed: ${nestedErrorMessage(cause)}`);
        }
      }
      try {
        await resource.client.remove(
          resource.sessionId,
          AbortSignal.timeout(Math.max(1, cleanupTimeoutMs))
        );
      } catch (cause) {
        failures.push(`OpenCode session deletion failed: ${nestedErrorMessage(cause)}`);
      }
      if (failures.length > 0) {
        if (Exit.isSuccess(exit)) throw new Error(failures.join("; "));
        const primary = Cause.findError(exit.cause);
        if (Result.isSuccess(primary)) {
          const error = primary.success as { message: string };
          error.message = `${error.message}; cleanup also failed: ${failures.join("; ")}`;
        }
      }
    },
    catch: (cause) =>
      invocationError(input, cause, {
        failureCategory: "runtime_cleanup",
        runtimeSessionId: resource.sessionId
      })
  });
}

const invokeV2Runtime = (
  input: OpenCodeGatewayInput,
  server: StartedOpenCodeServer,
  options: OpenCodeGatewayLiveOptions
): Effect.Effect<{ readonly runtimeSessionId: string }, AdapterInvocationError> =>
  Effect.acquireUseRelease(
    acquireOpenCodeSession(input, server).pipe(
      Effect.timeoutOrElse({
        duration: options.startTimeoutMs ?? 10_000,
        orElse: () =>
          Effect.fail(
            new AdapterInvocationError({
              jobId: input.jobId,
              message: `OpenCode session startup deadline exceeded after ${options.startTimeoutMs ?? 10_000}ms`,
              failureCategory: "runtime_startup",
              targetOutputState: "not observed"
            })
          )
      })
    ),
    (resource) =>
      monitorOpenCodeSession(input, resource, server).pipe(
        Effect.timeoutOrElse({
          duration: options.executionTimeoutMs ?? DEFAULT_OPENCODE_EXECUTION_TIMEOUT_MS,
          orElse: () => {
            resource.abortForDeadline = true;
            const timeoutMs =
              options.executionTimeoutMs ?? DEFAULT_OPENCODE_EXECUTION_TIMEOUT_MS;
            return Effect.fail(
              new AdapterInvocationError({
                jobId: input.jobId,
                message: `OpenCode model execution deadline exceeded after ${timeoutMs}ms`,
                failureCategory: "timeout",
                runtimeSessionId: resource.sessionId,
                terminalOutcome: { kind: "runtime", status: "aborted" },
                targetOutputState: "not observed"
              })
            );
          }
        })
      ),
    (resource, exit) =>
      releaseOpenCodeSession(
        input,
        resource,
        exit,
        options.cleanupTimeoutMs ?? DEFAULT_OPENCODE_CLEANUP_TIMEOUT_MS
      )
  );

const makeOpenCodeGateway = (options: OpenCodeGatewayLiveOptions) => {
  const withRun = <A, E, R>(
    use: (invoke: OpenCodeGatewayInvoke) => Effect.Effect<A, E, R>
  ): Effect.Effect<A, E | AdapterInvocationError, R> =>
    Effect.acquireUseRelease(
      SynchronizedRef.make<SharedOpenCodeServerState>({ _tag: "empty" }),
      (state) => {
        const workspaceParent = options.workspaceParent ?? tmpdir();
        return use(
          Effect.fn("OpenCodeGateway.invoke")((input: OpenCodeGatewayInput) =>
            resolveSharedServer(input, options, workspaceParent, state).pipe(
              Effect.flatMap((server) => invokeV2Runtime(input, server, options))
            )
          )
        );
      },
      (state) => releaseSharedServer(state)
    );
  const invoke: OpenCodeGatewayInvoke = (input) =>
    withRun((runInvoke) => runInvoke(input));
  return OpenCodeGateway.of({ invoke, withRun });
};

export const OpenCodeGatewayLive = (options: OpenCodeGatewayLiveOptions = {}) =>
  Layer.succeed(OpenCodeGateway, makeOpenCodeGateway(options));

export type OpenCodeRuntimeLiveOptions = OpenCodeGatewayLiveOptions;

export const OpenCodeRuntimeLive = (options: OpenCodeRuntimeLiveOptions = {}) =>
  OpenCodeAdapterLive(
    options.workspaceParent === undefined ? {} : { workspaceParent: options.workspaceParent }
  ).pipe(
    Layer.provide(OpenCodeGatewayLive(options))
  );
