import type {
  FailureCategory,
  SanitizedTerminalOutcome,
  TerminalOutcomeKind
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
type TerminalOutcomeStatus = Exclude<SanitizedTerminalOutcome["status"], null>;
const terminalOutcomeStatuses = new Set<TerminalOutcomeStatus>([
  "completed",
  "error",
  "running",
  "streaming",
  "unknown",
  "aborted"
]);
const terminalOutcomeNames = new Set([
  "APIError",
  "AbortError",
  "RateLimitError",
  "apply_patch",
  "edit",
  "read",
  "write"
]);

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
  /\b(?:authorization|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|client[-_ ]?secret|password|secret|credential|token)\b\s*[:=]\s*(?:(?:bearer|basic)\s+)?(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu;
const bearerToken = /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]+/giu;
const metadataAssignment =
  /\b(?:raw|private)[-_ ]?metadata\b\s*[:=]\s*(?:\{[^}\r\n]*\}|\[[^\]\r\n]*\]|"[^"]*"|'[^']*'|[^;\r\n]*)/giu;
const commonApiToken = /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b/gu;
const standaloneCredential =
  /\b(?:(?:AKIA|ASIA|AIDA|AROA|AIPA|ANPA|ANVA|ASCA)[A-Z0-9]{16}|gh[pousr]_[A-Za-z0-9]{20,255}|github_pat_[A-Za-z0-9_]{20,255}|(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{12,255}|whsec_[A-Za-z0-9]{12,255}|xox[baprs]-[A-Za-z0-9-]{10,255}|AIza[A-Za-z0-9_-]{20,255})\b/gu;
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
    .replace(secretAssignment, "[REDACTED CREDENTIAL]")
    .replace(bearerToken, "[REDACTED CREDENTIAL]")
    .replace(commonApiToken, "[REDACTED CREDENTIAL]")
    .replace(standaloneCredential, "[REDACTED CREDENTIAL]");
  return redacted.length <= maxLength ? redacted : `${redacted.slice(0, maxLength)}…`;
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
    terminalOutcomeStatuses.has(input.status as TerminalOutcomeStatus)
      ? (input.status as TerminalOutcomeStatus)
      : null;
  const statusCode =
    typeof input.statusCode === "number" &&
    Number.isSafeInteger(input.statusCode) &&
    input.statusCode >= 0 &&
    input.statusCode <= 999
      ? input.statusCode
      : null;
  const nameCandidate = typeof input.name === "string" ? input.name.trim() : undefined;
  const name =
    nameCandidate !== undefined && terminalOutcomeNames.has(nameCandidate)
      ? nameCandidate
      : null;
  return { kind, status, statusCode, name };
}
