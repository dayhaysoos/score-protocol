import type {
  FailureEvidence,
  FailureEvidenceStatus,
  FailureCategory,
  FailureObservationStage,
  SanitizedTerminalOutcome,
  TerminalOutcomeKind,
  CandidateDeclarationFailureEvidence,
  CandidateDeclarationFinding
} from "./domain.js";
import { terminalSafeLine } from "./terminal-safe-line.js";

const failureCategories = new Set<FailureCategory>([
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

const terminalOutcomeKinds = new Set<TerminalOutcomeKind>([
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
const terminalOutcomeStatuses = new Set<FailureEvidenceStatus>([
  "completed",
  "error",
  "running",
  "streaming",
  "unknown",
  "aborted"
]);
const failureObservationStages = new Set<FailureObservationStage>([
  "starting",
  "Agent working",
  "checking output",
  "candidate ready"
]);

export const FAILURE_EVIDENCE_NAME_MAX_LENGTH = 120;
export const FAILURE_REASON_MAX_LENGTH = 320;
export const DECLARATION_FINDINGS_MAX_LENGTH = 32;
export const DECLARATION_FINDING_CODE_MAX_LENGTH = 96;
export const DECLARATION_NAME_MAX_LENGTH = 120;

const failureMessages = {
  provider: "Provider failure.",
  tool: "Runtime tool failure.",
  timeout: "Runtime deadline exceeded.",
  runtime: "Runtime failure.",
  "workspace integrity": "Workspace integrity failure.",
  "missing output": "Assigned target output was missing.",
  interruption: "Execution was interrupted.",
  "ambiguous recovery": "Prior Attempt completion is ambiguous; explicit recovery is required.",
  "candidate integrity": "Candidate-set integrity failure.",
  "target drift": "Confirmed target state changed.",
  application: "Atomic application failure; repository recovery may be required.",
  persistence: "Runner persistence failure.",
  unknown: "Runner failure."
} as const satisfies Record<FailureCategory, string>;

const secretAssignment =
  /\b(?:[A-Za-z0-9]+[-_])*(?:authorization|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|client[-_ ]?secret|password|secret|credential|token)\b\s*[:=]\s*(?:(?:bearer|basic)\s+)?(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu;
const bearerToken = /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]+/giu;
const metadataAssignment =
  /\b(?:raw|private)[-_ ]?metadata\b\s*[:=]\s*(?:\{[^}\r\n]*\}|\[[^\]\r\n]*\]|"[^"]*"|'[^']*'|[^;\r\n]*)/giu;
const rawPayloadAssignment =
  /\b(?:arguments?|args|input|output|stdout|stderr|tool[-_ ]?(?:arguments?|output))\b\s*[:=]\s*(?:\{[^}\r\n]*\}|\[[^\]\r\n]*\]|"[^"]*"|'[^']*'|[^;\r\n]*)/giu;
const commonApiToken = /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b/gu;
const standaloneCredential =
  /\b(?:(?:AKIA|ASIA|AIDA|AROA|AIPA|ANPA|ANVA|ASCA)[A-Z0-9]{16}|gh[pousr]_[A-Za-z0-9]{20,255}|github_pat_[A-Za-z0-9_]{20,255}|(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{12,255}|whsec_[A-Za-z0-9]{12,255}|xox[baprs]-[A-Za-z0-9-]{10,255}|AIza[A-Za-z0-9_-]{20,255})\b/gu;
const fileUrl = /\bfile:\/\/[^\s,;)}\]]+/giu;
const windowsLocalPath = /\b[A-Za-z]:\\[^\s,;)}\]]+/gu;
const posixLocalPath =
  /\/(?:Users|home|tmp|private|var|opt|etc|Volumes|workspace|workspaces|root|mnt|srv|Library)\/[^\s,;)}\]]+/gu;
const pathLikeContent = /(?:\bfile:|[\\/])/iu;
const runnerCliFallback =
  "Runner command failed. Inspect score status for retained diagnostics.";

export function safeFailureMessage(category: FailureCategory): string {
  return failureMessages[category];
}
export function sanitizeDiagnosticMessage(value: unknown, maxLength = 2_000): string {
  const raw = value instanceof Error ? value.message : String(value);
  const withoutControls = raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "");
  const redacted = withoutControls
    .replace(metadataAssignment, "[REDACTED METADATA]")
    .replace(rawPayloadAssignment, "[REDACTED DATA]")
    .replace(secretAssignment, "[REDACTED CREDENTIAL]")
    .replace(bearerToken, "[REDACTED CREDENTIAL]")
    .replace(commonApiToken, "[REDACTED CREDENTIAL]")
    .replace(standaloneCredential, "[REDACTED CREDENTIAL]");
  return redacted.length <= maxLength ? redacted : `${redacted.slice(0, maxLength)}…`;
}

export function sanitizeFailureReason(value: unknown): string | null {
  const raw = value instanceof Error ? value.message : String(value);
  const sanitized = terminalSafeLine(
    sanitizeDiagnosticMessage(
      terminalSafeLine(raw, FAILURE_REASON_MAX_LENGTH * 4),
      FAILURE_REASON_MAX_LENGTH * 4
    )
      .replace(fileUrl, "[REDACTED PATH]")
      .replace(windowsLocalPath, "[REDACTED PATH]")
      .replace(posixLocalPath, "[REDACTED PATH]"),
    FAILURE_REASON_MAX_LENGTH
  ).trim();
  return sanitized.length === 0 ? null : sanitized;
}

export function sanitizeFailureEvidence(
  value: unknown,
  stageOverride?: FailureObservationStage | null
): FailureEvidence {
  const input = record(value);
  const category = sanitizeFailureCategory(input?.category);
  const storedStage = input?.stage;
  const stage =
    stageOverride !== undefined
      ? stageOverride
      : typeof storedStage === "string" &&
          failureObservationStages.has(storedStage as FailureObservationStage)
        ? (storedStage as FailureObservationStage)
        : null;
  const status =
    typeof input?.status === "string" &&
    terminalOutcomeStatuses.has(input.status as FailureEvidenceStatus)
      ? (input.status as FailureEvidenceStatus)
      : null;
  const statusCode =
    typeof input?.statusCode === "number" &&
    Number.isSafeInteger(input.statusCode) &&
    input.statusCode >= 0 &&
    input.statusCode <= 999
      ? input.statusCode
      : null;
  return {
    category,
    stage,
    name: sanitizeEvidenceName(input?.name),
    status,
    statusCode,
    reason:
      typeof input?.reason === "string" || input?.reason instanceof Error
        ? sanitizeFailureReason(input.reason)
        : null,
    ...declarationVerification(input?.declarationVerification)
  };
}

function declarationVerification(
  value: unknown
): { readonly declarationVerification?: CandidateDeclarationFailureEvidence } {
  const input = record(value);
  const candidateDigest = sanitizeDeclarationDigest(input?.candidateDigest);
  if (input === undefined || candidateDigest === null) return {};

  return {
    declarationVerification: {
      findings: sanitizeDeclarationFindings(input.findings),
      bindingDigest: sanitizeDeclarationDigest(input.bindingDigest),
      candidateDigest,
      verdictDigest: sanitizeDeclarationDigest(input.verdictDigest)
    }
  };
}

function sanitizeDeclarationFindings(
  value: unknown
): ReadonlyArray<CandidateDeclarationFinding> {
  if (!Array.isArray(value)) return [];
  const findings: CandidateDeclarationFinding[] = [];
  for (const entry of value) {
    if (findings.length >= DECLARATION_FINDINGS_MAX_LENGTH) break;
    const finding = sanitizeDeclarationFinding(entry);
    if (finding !== null) findings.push(finding);
  }
  return findings;
}

function sanitizeDeclarationFinding(value: unknown): CandidateDeclarationFinding | null {
  const input = record(value);
  if (input === undefined || !isDeclarationFindingCode(input.code)) return null;
  const message =
    typeof input.message === "string" || input.message instanceof Error
      ? sanitizeFailureReason(input.message)
      : null;
  if (message === null) return null;
  return {
    code: input.code,
    declaration: sanitizeDeclarationName(input.declaration),
    message
  };
}

function isDeclarationFindingCode(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= DECLARATION_FINDING_CODE_MAX_LENGTH &&
    /^[A-Z]+(?:_[A-Z]+)*$/u.test(value)
  );
}

function sanitizeDeclarationName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const sanitized = terminalSafeLine(
    sanitizeFailureReason(value) ?? "",
    DECLARATION_NAME_MAX_LENGTH
  );
  return sanitized.length === 0 ? null : sanitized;
}

function sanitizeDeclarationDigest(value: unknown): string | null {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value)
    ? value
    : null;
}

export function safeRunnerCliErrorMessage(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value);
  const sanitized = terminalSafeLine(
    sanitizeDiagnosticMessage(terminalSafeLine(raw, 2_000), 500),
    500
  );
  if (sanitized.length === 0 || pathLikeContent.test(sanitized)) {
    return runnerCliFallback;
  }
  return sanitized;
}

export function sanitizeRuntimeSessionId(value: unknown): string | null {
  const candidate = String(value).trim();
  if (
    candidate.length === 0 ||
    candidate.length > 256 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/u.test(candidate) ||
    /authorization|bearer|api[-_ ]?key|secret|password|credential|token/iu.test(
      candidate
    )
  ) {
    return null;
  }
  const sanitized = sanitizeDiagnosticMessage(candidate, 256);
  return sanitized === candidate ? candidate : null;
}

export function sanitizeEvidenceName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (
    candidate.length === 0 ||
    candidate.length > FAILURE_EVIDENCE_NAME_MAX_LENGTH ||
    candidate !== terminalSafeLine(candidate, FAILURE_EVIDENCE_NAME_MAX_LENGTH) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/ -]*$/u.test(candidate) ||
    /authorization|bearer|api[-_ ]?key|secret|password|credential|token/iu.test(
      candidate
    ) ||
    sanitizeDiagnosticMessage(candidate, FAILURE_EVIDENCE_NAME_MAX_LENGTH) !== candidate
  ) {
    return null;
  }
  return candidate;
}

export function sanitizeFailureCategory(
  requested: unknown,
  legacyTag?: string
): FailureCategory {
  if (typeof requested === "string" && failureCategories.has(requested as FailureCategory)) {
    return requested as FailureCategory;
  }
  switch (legacyTag) {
    case "AdapterInvocationError":
      return "runtime";
    case "AdapterBoundaryError":
      return "workspace integrity";
    case "AmbiguousExternalAttempt":
      return "ambiguous recovery";
    default:
      return "unknown";
  }
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

export function sanitizeTerminalOutcome(value: unknown): SanitizedTerminalOutcome | null {
  const input = record(value);
  if (input === undefined) return null;
  const kind =
    typeof input.kind === "string" &&
    terminalOutcomeKinds.has(input.kind as TerminalOutcomeKind)
      ? (input.kind as TerminalOutcomeKind)
      : "unknown";
  const status =
    typeof input.status === "string" &&
    terminalOutcomeStatuses.has(input.status as FailureEvidenceStatus)
      ? (input.status as FailureEvidenceStatus)
      : null;
  const statusCode =
    typeof input.statusCode === "number" &&
    Number.isSafeInteger(input.statusCode) &&
    input.statusCode >= 0 &&
    input.statusCode <= 999
      ? input.statusCode
      : null;
  const name = sanitizeEvidenceName(input.name);
  return { kind, status, statusCode, name };
}
