import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  assertSecureDirectoryIdentity,
  securePublishedFile,
  type SecureDirectoryIdentity
} from "./private-state-filesystem.js";
import type { SliceFinding } from "./slice-draft.js";

function hasGitMetadataAncestor(projectRoot: string): boolean {
  let current = projectRoot;
  while (true) {
    try {
      lstatSync(join(current, ".git"));
      return true;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") return true;
    }
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

function gitExcludeFinding(cause: unknown): SliceFinding {
  return {
    code: "GIT_EXCLUDE_UNAVAILABLE",
    location: "/projectRoot/.git/info/exclude",
    message: "SCORE could not install the local .score exclusion for this Git-backed project",
    detail: { cause: cause instanceof Error ? cause.message : String(cause) },
    machineRepairable: false
  };
}

function appendGitExcludePatterns(
  excludePath: string,
  patterns: ReadonlyArray<string>
): void {
  const existing = existsSync(excludePath) ? readFileSync(excludePath, "utf8") : "";
  const lines = new Set(existing.split(/\r?\n/u));
  const missing = patterns.filter((pattern) => !lines.has(pattern));
  if (missing.length === 0) return;
  mkdirSync(dirname(excludePath), { recursive: true });
  const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  writeFileSync(excludePath, `${existing}${separator}${missing.join("\n")}\n`, "utf8");
}

function gitExcludePath(projectRoot: string): {
  readonly gitRoot: string;
  readonly excludePath: string;
} {
  const gitRootText = execFileSync(
    "git",
    ["-C", projectRoot, "rev-parse", "--show-toplevel"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  ).trim();
  const gitRoot = realpathSync(gitRootText);
  const gitPath = execFileSync(
    "git",
    ["-C", projectRoot, "rev-parse", "--git-path", "info/exclude"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  ).trim();
  return {
    gitRoot,
    excludePath: isAbsolute(gitPath) ? gitPath : resolve(projectRoot, gitPath)
  };
}

export function installGitLocalExclude(projectRoot: string): SliceFinding | undefined {
  let context: ReturnType<typeof gitExcludePath>;
  try {
    context = gitExcludePath(projectRoot);
  } catch (cause) {
    return hasGitMetadataAncestor(projectRoot) ? gitExcludeFinding(cause) : undefined;
  }
  try {
    const relativeRoot = relative(context.gitRoot, projectRoot).split(sep).join("/");
    const pattern = relativeRoot.length === 0 ? "/.score/" : `/${relativeRoot}/.score/`;
    appendGitExcludePatterns(context.excludePath, [pattern]);
    return undefined;
  } catch (cause) {
    return gitExcludeFinding(cause);
  }
}

function escapeGitExcludePath(path: string): string {
  return path.replace(/[\\*?\[\]#! ]/gu, "\\$&");
}

export function installRunnerDatabaseGitExclude(
  invokingDirectory: string,
  databasePath: string
): void {
  let context: ReturnType<typeof gitExcludePath>;
  try {
    context = gitExcludePath(invokingDirectory);
  } catch (cause) {
    if (!hasGitMetadataAncestor(invokingDirectory)) return;
    throw new Error("SCORE could not install the local Runner database exclusion", {
      cause
    });
  }
  const relativeDatabasePath = relative(context.gitRoot, databasePath);
  if (
    relativeDatabasePath === "" ||
    relativeDatabasePath === ".." ||
    relativeDatabasePath.startsWith(`..${sep}`) ||
    isAbsolute(relativeDatabasePath)
  ) {
    return;
  }
  if (/[\u0000-\u001f\u007f]/u.test(relativeDatabasePath)) {
    throw new Error("Runner database path must not contain control characters");
  }
  const normalized = escapeGitExcludePath(
    relativeDatabasePath.split(sep).join("/")
  );
  try {
    appendGitExcludePatterns(
      context.excludePath,
      ["", "-journal", "-shm", "-wal"].map((suffix) => `/${normalized}${suffix}`)
    );
  } catch (cause) {
    throw new Error("SCORE could not install the local Runner database exclusion", {
      cause
    });
  }
}

export class ReviewArtifactConflictError extends Error {
  constructor(path: string) {
    super(`Refusing to overwrite immutable review artifact ${path}`);
    this.name = "ReviewArtifactConflictError";
  }
}

export class ReviewArtifactPublishError extends Error {
  readonly rollbackFailures: ReadonlyArray<string>;

  constructor(cause: unknown, rollbackFailures: ReadonlyArray<string> = []) {
    super(
      `Could not publish the immutable review artifact pair: ${cause instanceof Error ? cause.message : String(cause)}${rollbackFailures.length === 0 ? "" : `; rollback needs attention: ${rollbackFailures.join("; ")}`}`,
      { cause }
    );
    this.name = "ReviewArtifactPublishError";
    this.rollbackFailures = rollbackFailures;
  }
}

interface ReviewArtifact {
  readonly path: string;
  readonly content: string;
}

function artifactAlreadyPublished(
  artifact: ReviewArtifact,
  directory: SecureDirectoryIdentity
): boolean {
  try {
    assertSecureDirectoryIdentity(directory, "SCORE reviews directory");
    const status = lstatSync(artifact.path);
    if (
      status.isSymbolicLink() ||
      !status.isFile() ||
      readFileSync(artifact.path, "utf8") !== artifact.content
    ) {
      throw new ReviewArtifactConflictError(artifact.path);
    }
    securePublishedFile(artifact.path, directory, "SCORE review artifact");
    assertSecureDirectoryIdentity(directory, "SCORE reviews directory");
    return true;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw cause;
  }
}

export function publishReviewArtifacts(
  artifacts: ReadonlyArray<ReviewArtifact>,
  directory: SecureDirectoryIdentity
): void {
  if (artifacts.length === 0) return;
  assertSecureDirectoryIdentity(directory, "SCORE reviews directory");
  if (artifacts.some((artifact) => dirname(artifact.path) !== directory.path)) {
    throw new ReviewArtifactPublishError(
      new Error("Review artifacts must remain inside the canonical SCORE reviews directory")
    );
  }
  const missing = artifacts.filter(
    (artifact) => !artifactAlreadyPublished(artifact, directory)
  );
  if (missing.length === 0) return;
  const staged: Array<{
    readonly artifact: ReviewArtifact;
    readonly temporaryPath: string;
    readonly readyPath: string;
  }> = [];
  const installed: typeof staged = [];
  try {
    for (const artifact of missing) {
      const temporaryPath = `${artifact.path}.tmp-${process.pid}-${randomUUID()}`;
      const readyPath = `${artifact.path}.ready-${process.pid}-${randomUUID()}`;
      assertSecureDirectoryIdentity(directory, "SCORE reviews directory");
      writeFileSync(temporaryPath, artifact.content, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600
      });
      securePublishedFile(temporaryPath, directory, "Staged SCORE review artifact");
      staged.push({ artifact, temporaryPath, readyPath });
      assertSecureDirectoryIdentity(directory, "SCORE reviews directory");
      renameSync(temporaryPath, readyPath);
      securePublishedFile(readyPath, directory, "Staged SCORE review artifact");
    }
    for (const item of staged) {
      try {
        assertSecureDirectoryIdentity(directory, "SCORE reviews directory");
        linkSync(item.readyPath, item.artifact.path);
        installed.push(item);
        assertSecureDirectoryIdentity(directory, "SCORE reviews directory");
      } catch (cause) {
        if (
          (cause as NodeJS.ErrnoException).code === "EEXIST" &&
          artifactAlreadyPublished(item.artifact, directory)
        ) {
          continue;
        }
        throw cause;
      }
    }
  } catch (cause) {
    const rollbackFailures: string[] = [];
    for (const item of installed.toReversed()) {
      try {
        if (lstatSync(item.artifact.path).ino !== lstatSync(item.readyPath).ino) {
          throw new Error("published path no longer identifies SCORE's staged artifact");
        }
        unlinkSync(item.artifact.path);
      } catch (rollbackCause) {
        rollbackFailures.push(
          `${item.artifact.path}: ${rollbackCause instanceof Error ? rollbackCause.message : String(rollbackCause)}`
        );
      }
    }
    if (cause instanceof ReviewArtifactConflictError && rollbackFailures.length === 0) {
      throw cause;
    }
    throw new ReviewArtifactPublishError(cause, rollbackFailures);
  } finally {
    for (const item of staged) {
      for (const stagedPath of [item.temporaryPath, item.readyPath]) {
        try {
          unlinkSync(stagedPath);
        } catch (cause) {
          if ((cause as NodeJS.ErrnoException).code !== "ENOENT") {
            process.emitWarning(
              `Could not remove staged review artifact ${stagedPath}: ${cause instanceof Error ? cause.message : String(cause)}`
            );
          }
        }
      }
    }
  }
  for (const artifact of missing) {
    securePublishedFile(artifact.path, directory, "SCORE review artifact");
  }
  assertSecureDirectoryIdentity(directory, "SCORE reviews directory");
}
