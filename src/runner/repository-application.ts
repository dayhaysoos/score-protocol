import {
  chmodSync,
  existsSync,
  lstatSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { dirname, posix, resolve } from "node:path";

import { sha256Bytes } from "../canonical.js";
import { normalizeProjectRelativePath } from "../project-path.js";
import type { RepositorySourceSnapshot } from "../repository-source-state.js";
import { sanitizeDiagnosticMessage } from "./diagnostic-sanitization.js";
import type { ConfirmedTarget } from "./domain.js";
import { terminalSafeLine } from "./terminal-safe-line.js";

export type { RepositorySourceSnapshot } from "../repository-source-state.js";

export class RepositoryRootError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepositoryRootError";
  }
}

export type RepositoryDriftFinding =
  | { readonly kind: "unsafe_snapshot_path"; readonly path: string }
  | { readonly kind: "duplicate_snapshot_paths" }
  | { readonly kind: "missing"; readonly path: string }
  | { readonly kind: "not_regular"; readonly path: string }
  | { readonly kind: "changed"; readonly path: string }
  | { readonly kind: "unexpected"; readonly path: string }
  | { readonly kind: "occupied"; readonly path: string }
  | { readonly kind: "reappeared"; readonly path: string };

export function formatRepositoryDriftFinding(finding: RepositoryDriftFinding): string {
  switch (finding.kind) {
    case "unsafe_snapshot_path":
      return `unsafe Source Snapshot path ${finding.path}`;
    case "duplicate_snapshot_paths":
      return "Source Snapshot contains duplicate file paths";
    case "missing":
      return `${finding.path} is missing`;
    case "not_regular":
      return `${finding.path} is not a regular file`;
    case "changed":
      return `${finding.path} content changed`;
    case "unexpected":
      return `${finding.path} is not part of the approved Source Snapshot`;
    case "occupied":
      return `${finding.path} should be absent`;
    case "reappeared":
      return `${finding.path} reappeared after its absence was accepted`;
  }
}

export function formatRepositoryDriftFindingForTerminal(
  finding: RepositoryDriftFinding
): string {
  const projected = terminalSafeLine(formatRepositoryDriftFinding(finding), 2_000);
  return (
    terminalSafeLine(sanitizeDiagnosticMessage(projected, 240), 240) ||
    "[unprintable repository difference]"
  );
}

export class RepositoryDriftError extends Error {
  readonly findings: ReadonlyArray<RepositoryDriftFinding>;
  readonly repositoryRoot: string | undefined;

  constructor(findings: ReadonlyArray<RepositoryDriftFinding>, repositoryRoot?: string) {
    super(
      `Repository does not match the approved Source Snapshot: ${findings.map(formatRepositoryDriftFinding).join("; ")}`
    );
    this.name = "RepositoryDriftError";
    this.findings = findings;
    this.repositoryRoot = repositoryRoot;
  }
}

export class RepositoryApplicationConflictError extends RepositoryDriftError {
  readonly applicationPhase = true;
  readonly applicationOutcome: "not_written" | "rolled_back" | "recovery_required";

  constructor(
    conflict: RepositoryDriftError,
    applicationOutcome: "not_written" | "rolled_back" | "recovery_required"
  ) {
    super(conflict.findings, conflict.repositoryRoot);
    this.name = "RepositoryApplicationConflictError";
    this.applicationOutcome = applicationOutcome;
  }
}

export class RepositoryConflictRecoveryError extends RepositoryApplicationConflictError {
  readonly recoveryPath: string;
  readonly rollbackFailures: ReadonlyArray<string>;

  constructor(
    conflict: RepositoryDriftError,
    recoveryPath: string,
    rollbackFailures: ReadonlyArray<string>
  ) {
    super(conflict, "recovery_required");
    this.name = "RepositoryConflictRecoveryError";
    this.recoveryPath = recoveryPath;
    this.rollbackFailures = rollbackFailures;
    this.message = `${conflict.message}; rollback needs attention at ${recoveryPath}: ${rollbackFailures.join("; ")}`;
  }
}

function pathSummary(
  singularLabel: string,
  pluralLabel: string,
  paths: ReadonlyArray<string>
): string | undefined {
  if (paths.length === 0) return undefined;
  if (paths.length === 1) {
    const projected = terminalSafeLine(paths[0]!, 2_000);
    const path =
      terminalSafeLine(sanitizeDiagnosticMessage(projected, 240), 240) ||
      "[unprintable repository path]";
    return `${singularLabel}: ${path}`;
  }
  return `${pluralLabel}: ${paths.length}`;
}

export function formatRepositoryDriftForHuman(error: RepositoryDriftError): string {
  const pathsFor = (kind: RepositoryDriftFinding["kind"]): string[] =>
    error.findings.flatMap((finding) =>
      finding.kind === kind && "path" in finding ? [finding.path] : []
    );
  const missing = pathsFor("missing");
  const changed = pathsFor("changed");
  const unexpected = pathsFor("unexpected");
  const occupied = pathsFor("occupied");
  const reappeared = pathsFor("reappeared");
  const classified =
    missing.length + changed.length + unexpected.length + occupied.length + reappeared.length;
  const otherCount = error.findings.length - classified;
  const applicationConflict = error instanceof RepositoryApplicationConflictError;
  const lines = [
    applicationConflict
      ? "Repository changed during candidate application."
      : "Repository does not match the reviewed work."
  ];
  const summaries = [
    pathSummary("Missing expected file", "Missing expected files", missing),
    pathSummary("Changed expected file", "Changed expected files", changed),
    pathSummary(
      "Create target is already occupied",
      "Create targets already occupied",
      occupied
    ),
    pathSummary(
      "Accepted missing file reappeared",
      "Accepted missing files reappeared",
      reappeared
    )
  ];
  lines.push(...summaries.filter((summary): summary is string => summary !== undefined));
  if (unexpected.length > 0) {
    lines.push(
      `${unexpected.length} ${unexpected.length === 1 ? "file is" : "files are"} outside the approved Source Snapshot.`
    );
  }
  if (otherCount > 0) {
    lines.push(
      `${otherCount} other repository ${otherCount === 1 ? "difference needs" : "differences need"} attention.`
    );
  }
  if (error instanceof RepositoryConflictRecoveryError) {
    lines.push("Automatic rollback did not complete. Do not rerun until recovery is complete.");
    const projectedRecoveryPath = terminalSafeLine(error.recoveryPath, 2_000);
    const recoveryPath =
      terminalSafeLine(sanitizeDiagnosticMessage(projectedRecoveryPath, 240), 240) ||
      "[unprintable recovery path]";
    lines.push(`Recovery files: ${recoveryPath}`);
    lines.push(
      ...error.rollbackFailures.map((failure) => {
        const projectedFailure = terminalSafeLine(failure, 2_000);
        const issue =
          terminalSafeLine(sanitizeDiagnosticMessage(projectedFailure, 240), 240) ||
          "[unprintable recovery issue]";
        return `Recovery issue: ${issue}`;
      })
    );
  } else if (applicationConflict) {
    lines.push(
      error.applicationOutcome === "rolled_back"
        ? "All SCORE candidate writes were rolled back; no candidate files remain applied."
        : "No candidate files were written; generated candidates remain unapplied."
    );
    lines.push("Prepare a new revision if a declared target changed.");
  } else {
    lines.push("No work was started. Run again with --verbose to see every mismatch.");
  }
  return lines.join("\n");
}

export class RepositoryApplicationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepositoryApplicationError";
  }
}

export interface RepositoryApplicationDependencies {
  readonly beforeCandidateStaging: (targetPath: string) => void;
  readonly beforeFinalSnapshotCheck: () => void;
  readonly beforeTargetMutation: (targetPath: string) => void;
  readonly verifyHardLinkSupport: (stagingRoot: string) => void;
  readonly moveOriginalToBackup: (source: string, backup: string) => void;
  readonly commitStagedFile: (source: string, target: string) => void;
  readonly cleanupStaging: (stagingRoot: string) => void;
}

const defaultApplicationDependencies: RepositoryApplicationDependencies = {
  beforeCandidateStaging: () => undefined,
  beforeFinalSnapshotCheck: () => undefined,
  beforeTargetMutation: () => undefined,
  verifyHardLinkSupport: (stagingRoot) => {
    const source = resolve(stagingRoot, "hard-link-probe-source");
    const target = resolve(stagingRoot, "hard-link-probe-target");
    writeFileSync(source, "", { flag: "wx" });
    linkSync(source, target);
    unlinkSync(target);
    unlinkSync(source);
  },
  moveOriginalToBackup: renameSync,
  commitStagedFile: linkSync,
  cleanupStaging: (stagingRoot) => rmSync(stagingRoot, { recursive: true, force: true })
};

function pathEntryExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw cause;
  }
}

function validatedRelativePath(path: string): string {
  const normalized = normalizeProjectRelativePath(path);
  if (normalized === undefined) {
    throw new RepositoryDriftError([{ kind: "unsafe_snapshot_path", path }]);
  }
  return normalized;
}

export function resolveRepositoryRoot(startPath: string): string {
  const candidate = resolve(startPath);
  try {
    if (!statSync(candidate).isDirectory()) {
      throw new Error("path is not a directory");
    }
    return realpathSync(candidate);
  } catch (cause) {
    if (cause instanceof RepositoryRootError) throw cause;
    throw new RepositoryRootError(
      `Cannot resolve a project directory from ${candidate}: ${cause instanceof Error ? cause.message : String(cause)}`
    );
  }
}

function frozenRepositorySnapshotContext(
  repositoryRoot: string,
  snapshot: RepositorySourceSnapshot
): {
  readonly repositoryRoot: string;
  readonly expected: ReadonlyMap<string, RepositorySourceSnapshot["files"][number]>;
} {
  const resolvedRoot = resolve(repositoryRoot);
  const currentRepositoryRoot = resolveRepositoryRoot(resolvedRoot);
  if (currentRepositoryRoot !== resolvedRoot) {
    throw new RepositoryRootError(
      `Frozen repository root ${resolvedRoot} now resolves to ${currentRepositoryRoot}`
    );
  }
  const expected = new Map(
    snapshot.files.map((file) => [validatedRelativePath(file.path), file] as const)
  );
  if (expected.size !== snapshot.files.length) {
    throw new RepositoryDriftError([{ kind: "duplicate_snapshot_paths" }]);
  }
  return { repositoryRoot: resolvedRoot, expected };
}

export function findMissingRepositoryTargets(input: {
  readonly repositoryRoot: string;
  readonly snapshot: RepositorySourceSnapshot;
  readonly targetPaths: ReadonlyArray<string>;
}): ReadonlyArray<string> {
  const { repositoryRoot, expected } = frozenRepositorySnapshotContext(
    input.repositoryRoot,
    input.snapshot
  );
  return input.targetPaths
    .map(validatedRelativePath)
    .filter((path) => expected.has(path) && !pathEntryExists(resolve(repositoryRoot, path)))
    .toSorted();
}

export function verifyRepositoryMatchesSnapshot(input: {
  readonly repositoryRoot: string;
  readonly snapshot: RepositorySourceSnapshot;
  readonly targetPaths?: ReadonlyArray<string>;
  readonly absentPaths?: ReadonlyArray<string>;
  readonly acceptedMissingPaths?: ReadonlyArray<string>;
}): void {
  const { repositoryRoot, expected } = frozenRepositorySnapshotContext(
    input.repositoryRoot,
    input.snapshot
  );

  const targetPaths = new Set(
    (input.targetPaths ?? input.snapshot.files.map((file) => file.path)).map(
      validatedRelativePath
    )
  );
  const acceptedMissingPaths = new Set(
    (input.acceptedMissingPaths ?? []).map(validatedRelativePath)
  );
  const findings: RepositoryDriftFinding[] = [];

  for (const [path, file] of [...expected].toSorted(([left], [right]) => left.localeCompare(right))) {
    if (!targetPaths.has(path)) continue;
    const absolutePath = resolve(repositoryRoot, path);
    if (acceptedMissingPaths.has(path)) {
      if (pathEntryExists(absolutePath)) findings.push({ kind: "reappeared", path });
      continue;
    }
    if (!pathEntryExists(absolutePath)) {
      findings.push({ kind: "missing", path });
      continue;
    }
    const status = lstatSync(absolutePath);
    if (!status.isFile() || status.isSymbolicLink()) {
      findings.push({ kind: "not_regular", path });
      continue;
    }
    if (sha256Bytes(readFileSync(absolutePath)) !== file.content_digest) {
      findings.push({ kind: "changed", path });
    }
  }

  for (const path of input.absentPaths ?? []) {
    const normalized = validatedRelativePath(path);
    try {
      lstatSync(resolve(repositoryRoot, normalized));
      findings.push({ kind: "occupied", path: normalized });
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw cause;
    }
  }

  if (findings.length > 0) throw new RepositoryDriftError(findings, repositoryRoot);
}

export function captureRepositoryTargets(input: {
  readonly repositoryRoot: string;
  readonly targetPaths: ReadonlyArray<string>;
}): ReadonlyArray<ConfirmedTarget> {
  const repositoryRoot = resolve(input.repositoryRoot);
  const currentRepositoryRoot = resolveRepositoryRoot(repositoryRoot);
  if (currentRepositoryRoot !== repositoryRoot) {
    throw new RepositoryRootError(
      `Confirmed repository root ${repositoryRoot} now resolves to ${currentRepositoryRoot}`
    );
  }
  const targetPaths = input.targetPaths.map(validatedRelativePath);
  if (new Set(targetPaths).size !== targetPaths.length) {
    throw new RepositoryDriftError([{ kind: "duplicate_snapshot_paths" }], repositoryRoot);
  }
  return targetPaths
    .map((targetPath): ConfirmedTarget => {
      try {
        assertSafeTargetAncestors(repositoryRoot, targetPath);
      } catch (cause) {
        if (cause instanceof RepositoryApplicationError) {
          throw new RepositoryDriftError(
            [{ kind: "not_regular", path: targetPath }],
            repositoryRoot
          );
        }
        throw cause;
      }
      const target = resolve(repositoryRoot, targetPath);
      if (!pathEntryExists(target)) return { targetPath, state: "absent" };
      const status = lstatSync(target);
      if (!status.isFile() || status.isSymbolicLink()) {
        throw new RepositoryDriftError(
          [{ kind: "not_regular", path: targetPath }],
          repositoryRoot
        );
      }
      return {
        targetPath,
        state: "file",
        contentDigest: sha256Bytes(readFileSync(target))
      };
    })
    .toSorted((left, right) => left.targetPath.localeCompare(right.targetPath));
}

export function repositoryDifferencesFromSnapshot(input: {
  readonly snapshot: RepositorySourceSnapshot;
  readonly approvedTargets: ReadonlyArray<CandidateTarget>;
  readonly confirmedTargets: ReadonlyArray<ConfirmedTarget>;
}): ReadonlyArray<RepositoryDriftFinding> {
  const sourceFiles = new Map(input.snapshot.files.map((file) => [file.path, file] as const));
  const confirmedTargets = new Map(
    input.confirmedTargets.map((target) => [target.targetPath, target] as const)
  );
  return input.approvedTargets.flatMap((approved): ReadonlyArray<RepositoryDriftFinding> => {
    const targetPath = validatedRelativePath(approved.targetPath);
    const current = confirmedTargets.get(targetPath);
    if (current === undefined) {
      throw new RepositoryApplicationError(
        `Confirmed target state is missing ${targetPath}`
      );
    }
    if (approved.operation === "create") {
      return current.state === "file" ? [{ kind: "occupied", path: targetPath }] : [];
    }
    const source = sourceFiles.get(targetPath);
    if (source === undefined) {
      throw new RepositoryApplicationError(
        `Replace target ${targetPath} is not present at the approved Source Snapshot`
      );
    }
    if (current.state === "absent") return [{ kind: "missing", path: targetPath }];
    return current.contentDigest === source.content_digest
      ? []
      : [{ kind: "changed", path: targetPath }];
  });
}

export function verifyRepositoryTargetsMatch(input: {
  readonly repositoryRoot: string;
  readonly confirmedTargets: ReadonlyArray<ConfirmedTarget>;
}): void {
  const current = captureRepositoryTargets({
    repositoryRoot: input.repositoryRoot,
    targetPaths: input.confirmedTargets.map((target) => target.targetPath)
  });
  const expected = new Map(
    input.confirmedTargets.map((target) => [target.targetPath, target] as const)
  );
  const findings = current.flatMap((target): ReadonlyArray<RepositoryDriftFinding> => {
    const prior = expected.get(target.targetPath);
    if (prior === undefined) return [{ kind: "unexpected", path: target.targetPath }];
    if (prior.state === "absent") {
      return target.state === "file" ? [{ kind: "occupied", path: target.targetPath }] : [];
    }
    if (target.state === "absent") return [{ kind: "missing", path: target.targetPath }];
    return target.contentDigest === prior.contentDigest
      ? []
      : [{ kind: "changed", path: target.targetPath }];
  });
  if (current.length !== expected.size) {
    for (const targetPath of expected.keys()) {
      if (!current.some((target) => target.targetPath === targetPath)) {
        findings.push({ kind: "missing", path: targetPath });
      }
    }
  }
  if (findings.length > 0) {
    throw new RepositoryDriftError(findings, resolve(input.repositoryRoot));
  }
}

type SupportedOperation = "create" | "replace";

interface CandidateTarget {
  readonly targetPath: string;
  readonly operation: SupportedOperation;
}

interface CandidateFile extends CandidateTarget {
  readonly content: string;
  readonly candidateDigest: string;
}

function sortedTargetIdentity(targets: ReadonlyArray<CandidateTarget>): string {
  return JSON.stringify(
    targets
      .map(({ targetPath, operation }) => ({
        targetPath: validatedRelativePath(targetPath),
        operation
      }))
      .toSorted((left, right) => left.targetPath.localeCompare(right.targetPath))
  );
}

function verifyAppliedCandidateState(input: {
  readonly repositoryRoot: string;
  readonly candidates: ReadonlyArray<CandidateFile>;
}): void {
  const findings: RepositoryDriftFinding[] = [];
  for (const candidate of input.candidates) {
    const target = resolve(input.repositoryRoot, candidate.targetPath);
    if (!pathEntryExists(target)) {
      findings.push({ kind: "missing", path: candidate.targetPath });
      continue;
    }
    const status = lstatSync(target);
    if (!status.isFile() || status.isSymbolicLink()) {
      findings.push({ kind: "not_regular", path: candidate.targetPath });
    } else if (sha256Bytes(readFileSync(target)) !== candidate.candidateDigest) {
      findings.push({ kind: "changed", path: candidate.targetPath });
    }
  }
  if (findings.length > 0) {
    throw new RepositoryDriftError(findings, input.repositoryRoot);
  }
}

function assertSafeTargetAncestors(repositoryRoot: string, targetPath: string): void {
  const segments = validatedRelativePath(targetPath).split("/");
  let current = repositoryRoot;
  for (const segment of segments.slice(0, -1)) {
    current = resolve(current, segment);
    if (!pathEntryExists(current)) continue;
    const status = lstatSync(current);
    if (!status.isDirectory() || status.isSymbolicLink()) {
      throw new RepositoryApplicationError(
        `Candidate target ${targetPath} traverses a non-directory or symbolic link`
      );
    }
  }
}

function createTargetParents(
  repositoryRoot: string,
  targetPath: string,
  createdDirectories: string[]
): void {
  const segments = posix.dirname(targetPath).split("/").filter((segment) => segment !== ".");
  let current = repositoryRoot;
  for (const segment of segments) {
    current = resolve(current, segment);
    if (pathEntryExists(current)) continue;
    mkdirSync(current);
    createdDirectories.push(current);
  }
}

function removeCreatedDirectories(createdDirectories: ReadonlyArray<string>): string[] {
  const failures: string[] = [];
  for (const current of [...new Set(createdDirectories)].toReversed()) {
    try {
      rmdirSync(current);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") {
        failures.push(
          `${current}: ${cause instanceof Error ? cause.message : String(cause)}`
        );
      }
    }
  }
  return failures;
}

export function applyCandidateSet(
  input: {
    readonly repositoryRoot: string;
    readonly snapshot: RepositorySourceSnapshot;
    readonly acceptedMissingReplacementPaths?: ReadonlyArray<string>;
    readonly confirmedTargets?: ReadonlyArray<ConfirmedTarget>;
    readonly approvedTargets: ReadonlyArray<CandidateTarget>;
    readonly candidates: ReadonlyArray<CandidateFile>;
  },
  dependencyOverrides: Partial<RepositoryApplicationDependencies> = {}
): {
  readonly appliedPaths: ReadonlyArray<string>;
  readonly cleanupWarning?: string;
} {
  const dependencies = {
    ...defaultApplicationDependencies,
    ...dependencyOverrides
  };
  const repositoryRoot = resolve(input.repositoryRoot);
  const confirmedTargets =
    input.confirmedTargets === undefined
      ? undefined
      : new Map(
          input.confirmedTargets.map((target) => {
            const targetPath = validatedRelativePath(target.targetPath);
            return [targetPath, { ...target, targetPath }] as const;
          })
        );
  if (
    confirmedTargets !== undefined &&
    confirmedTargets.size !== input.confirmedTargets?.length
  ) {
    throw new RepositoryApplicationError(
      "Confirmed target state contains duplicate paths"
    );
  }
  const acceptedMissingReplacementPaths = new Set(
    (input.acceptedMissingReplacementPaths ?? []).map(validatedRelativePath)
  );
  if (
    acceptedMissingReplacementPaths.size !==
    (input.acceptedMissingReplacementPaths ?? []).length
  ) {
    throw new RepositoryApplicationError(
      "Accepted missing replacement paths contain duplicates"
    );
  }
  const approvedMissingReplacements = new Set(
    input.approvedTargets
      .filter((target) => target.operation === "replace")
      .map((target) => validatedRelativePath(target.targetPath))
  );
  for (const path of acceptedMissingReplacementPaths) {
    if (!approvedMissingReplacements.has(path)) {
      throw new RepositoryApplicationError(
        `Accepted missing path ${path} is not an approved replace target`
      );
    }
  }
  try {
    if (confirmedTargets === undefined) {
      verifyRepositoryMatchesSnapshot({
        repositoryRoot,
        snapshot: input.snapshot,
        targetPaths: input.approvedTargets.map((target) => target.targetPath),
        acceptedMissingPaths: [...acceptedMissingReplacementPaths],
        absentPaths: input.approvedTargets
          .filter((target) => target.operation === "create")
          .map((target) => target.targetPath)
      });
    } else {
      const approvedPaths = input.approvedTargets
        .map((target) => validatedRelativePath(target.targetPath))
        .toSorted();
      if (
        JSON.stringify([...confirmedTargets.keys()].toSorted()) !==
        JSON.stringify(approvedPaths)
      ) {
        throw new RepositoryApplicationError(
          "Confirmed target state does not contain every approved target exactly once"
        );
      }
      verifyRepositoryTargetsMatch({
        repositoryRoot,
        confirmedTargets: [...confirmedTargets.values()]
      });
    }
  } catch (cause) {
    if (cause instanceof RepositoryDriftError) {
      throw new RepositoryApplicationConflictError(cause, "not_written");
    }
    throw cause;
  }

  if (sortedTargetIdentity(input.approvedTargets) !== sortedTargetIdentity(input.candidates)) {
    throw new RepositoryApplicationError(
      "Candidate set does not contain every approved target exactly once"
    );
  }
  const candidates = input.candidates
    .map((candidate) => {
      const targetPath = validatedRelativePath(candidate.targetPath);
      const confirmedTarget = confirmedTargets?.get(targetPath);
      const expectedTargetState: "absent" | "frozen_file" =
        confirmedTarget !== undefined
          ? confirmedTarget.state === "absent"
            ? "absent"
            : "frozen_file"
          : candidate.operation === "create" ||
              acceptedMissingReplacementPaths.has(targetPath)
          ? "absent"
          : "frozen_file";
      const expectedContentDigest =
        confirmedTarget?.state === "file"
          ? confirmedTarget.contentDigest
          : input.snapshot.files.find((file) => file.path === targetPath)?.content_digest;
      return {
        ...candidate,
        targetPath,
        expectedTargetState,
        expectedContentDigest
      };
    })
    .toSorted((left, right) => left.targetPath.localeCompare(right.targetPath));
  if (new Set(candidates.map((candidate) => candidate.targetPath)).size !== candidates.length) {
    throw new RepositoryApplicationError("Candidate set contains duplicate target paths");
  }

  const sourceFiles = new Map(input.snapshot.files.map((file) => [file.path, file] as const));
  for (const candidate of candidates) {
    if (sha256Bytes(candidate.content) !== candidate.candidateDigest) {
      throw new RepositoryApplicationError(
        `Candidate digest mismatch for ${candidate.targetPath}`
      );
    }
    assertSafeTargetAncestors(repositoryRoot, candidate.targetPath);
    const target = resolve(repositoryRoot, candidate.targetPath);
    if (confirmedTargets !== undefined) {
      if (candidate.expectedTargetState === "absent") {
        if (pathEntryExists(target)) {
          throw new RepositoryApplicationConflictError(
            new RepositoryDriftError(
              [{ kind: "occupied", path: candidate.targetPath }],
              repositoryRoot
            ),
            "not_written"
          );
        }
        continue;
      }
      if (!pathEntryExists(target)) {
        throw new RepositoryApplicationConflictError(
          new RepositoryDriftError(
            [{ kind: "missing", path: candidate.targetPath }],
            repositoryRoot
          ),
          "not_written"
        );
      }
      const status = lstatSync(target);
      if (!status.isFile() || status.isSymbolicLink()) {
        throw new RepositoryApplicationConflictError(
          new RepositoryDriftError(
            [{ kind: "not_regular", path: candidate.targetPath }],
            repositoryRoot
          ),
          "not_written"
        );
      }
      if (
        sha256Bytes(readFileSync(target)) !== candidate.expectedContentDigest
      ) {
        throw new RepositoryApplicationConflictError(
          new RepositoryDriftError(
            [{ kind: "changed", path: candidate.targetPath }],
            repositoryRoot
          ),
          "not_written"
        );
      }
    } else if (candidate.operation === "create") {
      if (sourceFiles.has(candidate.targetPath)) {
        throw new RepositoryApplicationError(
          `Create target ${candidate.targetPath} is not absent at the approved Source Snapshot`
        );
      }
      if (pathEntryExists(target)) {
        throw new RepositoryApplicationConflictError(
          new RepositoryDriftError(
            [{ kind: "occupied", path: candidate.targetPath }],
            repositoryRoot
          ),
          "not_written"
        );
      }
    } else {
      if (!sourceFiles.has(candidate.targetPath)) {
        throw new RepositoryApplicationError(
          `Replace target ${candidate.targetPath} is not present at the approved Source Snapshot`
        );
      }
      if (candidate.expectedTargetState === "absent") {
        if (pathEntryExists(target)) {
          throw new RepositoryApplicationConflictError(
            new RepositoryDriftError(
              [{ kind: "reappeared", path: candidate.targetPath }],
              repositoryRoot
            ),
            "not_written"
          );
        }
        continue;
      }
      if (!pathEntryExists(target)) {
        throw new RepositoryApplicationConflictError(
          new RepositoryDriftError(
            [{ kind: "missing", path: candidate.targetPath }],
            repositoryRoot
          ),
          "not_written"
        );
      }
      const status = lstatSync(target);
      if (!status.isFile() || status.isSymbolicLink()) {
        throw new RepositoryApplicationConflictError(
          new RepositoryDriftError(
            [{ kind: "not_regular", path: candidate.targetPath }],
            repositoryRoot
          ),
          "not_written"
        );
      }
      if (
        sha256Bytes(readFileSync(target)) !==
        sourceFiles.get(candidate.targetPath)?.content_digest
      ) {
        throw new RepositoryApplicationConflictError(
          new RepositoryDriftError(
            [{ kind: "changed", path: candidate.targetPath }],
            repositoryRoot
          ),
          "not_written"
        );
      }
    }
  }

  const stagingRoot = mkdtempSync(resolve(repositoryRoot, ".score-apply-"));
  const createdDirectories: string[] = [];
  let cleanupStaging = true;
  const mutations: Array<{
    readonly candidate: (typeof candidates)[number];
    readonly target: string;
    readonly backup: string;
    backupMoved: boolean;
    candidateMoved: boolean;
  }> = [];
  try {
    for (const candidate of candidates) {
      const staged = resolve(stagingRoot, "candidates", candidate.targetPath);
      mkdirSync(dirname(staged), { recursive: true });
      writeFileSync(staged, candidate.content, { encoding: "utf8", flag: "wx" });
      if (candidate.expectedTargetState === "frozen_file") {
        dependencies.beforeCandidateStaging(candidate.targetPath);
        const target = resolve(repositoryRoot, candidate.targetPath);
        let targetMode: number;
        try {
          const status = lstatSync(target);
          if (!status.isFile() || status.isSymbolicLink()) {
            throw new RepositoryApplicationConflictError(
              new RepositoryDriftError(
                [{ kind: "not_regular", path: candidate.targetPath }],
                repositoryRoot
              ),
              "not_written"
            );
          }
          if (
            sha256Bytes(readFileSync(target)) !==
            candidate.expectedContentDigest
          ) {
            throw new RepositoryApplicationConflictError(
              new RepositoryDriftError(
                [{ kind: "changed", path: candidate.targetPath }],
                repositoryRoot
              ),
              "not_written"
            );
          }
          targetMode = status.mode;
        } catch (cause) {
          if (cause instanceof RepositoryApplicationConflictError) throw cause;
          if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
            throw new RepositoryApplicationConflictError(
              new RepositoryDriftError(
                [{ kind: "missing", path: candidate.targetPath }],
                repositoryRoot
              ),
              "not_written"
            );
          }
          throw cause;
        }
        chmodSync(staged, targetMode);
      }
    }

    dependencies.verifyHardLinkSupport(stagingRoot);

    dependencies.beforeFinalSnapshotCheck();
    try {
      if (confirmedTargets === undefined) {
        verifyRepositoryMatchesSnapshot({
          repositoryRoot,
          snapshot: input.snapshot,
          targetPaths: candidates.map((candidate) => candidate.targetPath),
          acceptedMissingPaths: [...acceptedMissingReplacementPaths],
          absentPaths: candidates
            .filter((candidate) => candidate.operation === "create")
            .map((candidate) => candidate.targetPath)
        });
      } else {
        verifyRepositoryTargetsMatch({
          repositoryRoot,
          confirmedTargets: [...confirmedTargets.values()]
        });
      }
    } catch (cause) {
      if (cause instanceof RepositoryDriftError) {
        throw new RepositoryApplicationConflictError(cause, "not_written");
      }
      throw cause;
    }

    try {
      for (const candidate of candidates) {
        const target = resolve(repositoryRoot, candidate.targetPath);
        const staged = resolve(stagingRoot, "candidates", candidate.targetPath);
        const backup = resolve(stagingRoot, "backups", candidate.targetPath);
        const mutation = {
          candidate,
          target,
          backup,
          backupMoved: false,
          candidateMoved: false
        };
        mutations.push(mutation);
        dependencies.beforeTargetMutation(candidate.targetPath);
        assertSafeTargetAncestors(repositoryRoot, candidate.targetPath);
        createTargetParents(repositoryRoot, candidate.targetPath, createdDirectories);
        assertSafeTargetAncestors(repositoryRoot, candidate.targetPath);
        if (realpathSync(dirname(target)) !== dirname(target)) {
          throw new RepositoryApplicationError(
            `Candidate target ${candidate.targetPath} parent changed during application`
          );
        }
        if (candidate.expectedTargetState === "frozen_file") {
          mkdirSync(dirname(backup), { recursive: true });
          dependencies.moveOriginalToBackup(target, backup);
          mutation.backupMoved = true;
          const backupStatus = lstatSync(backup);
          if (
            !backupStatus.isFile() ||
            backupStatus.isSymbolicLink() ||
            sha256Bytes(readFileSync(backup)) !==
              candidate.expectedContentDigest
          ) {
            throw new RepositoryDriftError(
              [{ kind: "changed", path: candidate.targetPath }],
              repositoryRoot
            );
          }
        }
        dependencies.commitStagedFile(staged, target);
        mutation.candidateMoved = true;
      }
      verifyAppliedCandidateState({
        repositoryRoot,
        candidates
      });
    } catch (cause) {
      let conflict = cause instanceof RepositoryDriftError ? cause : undefined;
      const currentMutation = mutations.at(-1);
      if (conflict === undefined && currentMutation && !currentMutation.candidateMoved) {
        if (
          currentMutation.candidate.expectedTargetState === "absent" &&
          pathEntryExists(currentMutation.target)
        ) {
          conflict = new RepositoryDriftError(
            [
              {
                kind:
                  currentMutation.candidate.operation === "create"
                    ? "occupied"
                    : "reappeared",
                path: currentMutation.candidate.targetPath
              }
            ],
            repositoryRoot
          );
        } else if (
          currentMutation.candidate.expectedTargetState === "frozen_file" &&
          !currentMutation.backupMoved
        ) {
          if (!pathEntryExists(currentMutation.target)) {
            conflict = new RepositoryDriftError(
              [{ kind: "missing", path: currentMutation.candidate.targetPath }],
              repositoryRoot
            );
          } else {
            const targetStatus = lstatSync(currentMutation.target);
            if (!targetStatus.isFile() || targetStatus.isSymbolicLink()) {
              conflict = new RepositoryDriftError(
                [{ kind: "not_regular", path: currentMutation.candidate.targetPath }],
                repositoryRoot
              );
            } else if (
              sha256Bytes(readFileSync(currentMutation.target)) !==
              currentMutation.candidate.expectedContentDigest
            ) {
              conflict = new RepositoryDriftError(
                [{ kind: "changed", path: currentMutation.candidate.targetPath }],
                repositoryRoot
              );
            }
          }
        } else if (
          currentMutation.candidate.expectedTargetState === "frozen_file" &&
          currentMutation.backupMoved &&
          pathEntryExists(currentMutation.target)
        ) {
          conflict = new RepositoryDriftError(
            [{ kind: "changed", path: currentMutation.candidate.targetPath }],
            repositoryRoot
          );
        }
      }
      const rollbackFailures: string[] = [];
      for (const mutation of mutations.toReversed()) {
        try {
          if (mutation.candidateMoved && pathEntryExists(mutation.target)) {
            const staged = resolve(
              stagingRoot,
              "candidates",
              mutation.candidate.targetPath
            );
            const targetStatus = lstatSync(mutation.target);
            const stagedStatus = lstatSync(staged);
            if (
              targetStatus.dev !== stagedStatus.dev ||
              targetStatus.ino !== stagedStatus.ino ||
              sha256Bytes(readFileSync(mutation.target)) !==
                mutation.candidate.candidateDigest
            ) {
              throw new Error("target changed after candidate installation");
            }
            unlinkSync(mutation.target);
          }
          if (mutation.backupMoved) {
            linkSync(mutation.backup, mutation.target);
          }
        } catch (rollbackCause) {
          rollbackFailures.push(
            `${mutation.candidate.targetPath}: ${rollbackCause instanceof Error ? rollbackCause.message : String(rollbackCause)}`
          );
        }
      }
      rollbackFailures.push(...removeCreatedDirectories(createdDirectories));
      const message = cause instanceof Error ? cause.message : String(cause);
      if (rollbackFailures.length > 0) cleanupStaging = false;
      if (conflict !== undefined) {
        if (rollbackFailures.length === 0) {
          throw new RepositoryApplicationConflictError(conflict, "rolled_back");
        }
        throw new RepositoryConflictRecoveryError(
          conflict,
          stagingRoot,
          rollbackFailures
        );
      }
      throw new RepositoryApplicationError(
        rollbackFailures.length === 0
          ? `Repository application failed and all targets were restored: ${message}`
          : `Repository application failed and rollback needs attention at ${stagingRoot}: ${message}; ${rollbackFailures.join("; ")}`
      );
    }

    const appliedPaths = candidates.map((candidate) => candidate.targetPath);
    try {
      dependencies.cleanupStaging(stagingRoot);
      cleanupStaging = false;
      return { appliedPaths };
    } catch (cause) {
      cleanupStaging = false;
      return {
        appliedPaths,
        cleanupWarning: `Applied files, but could not remove temporary staging at ${stagingRoot}: ${cause instanceof Error ? cause.message : String(cause)}`
      };
    }
  } finally {
    if (cleanupStaging) dependencies.cleanupStaging(stagingRoot);
  }
}
