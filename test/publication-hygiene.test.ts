import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const PRIVATE_CONTENT_PATTERNS = [
  { label: "macOS home path", pattern: /\/Users\/[A-Za-z0-9._-]+\//u },
  { label: "Linux home path", pattern: /\/home\/[A-Za-z0-9._-]+\//u },
  { label: "Windows home path", pattern: /[A-Za-z]:\\Users\\[^\\\r\n]+\\/u },
  { label: "personal Gmail address", pattern: /\b[A-Za-z0-9._%+-]+@gmail\.com\b/iu },
  { label: "runtime session identifier", pattern: /\bses_[A-Za-z0-9_-]{16,}\b/u }
] as const;

const PRIVATE_FILE_PATTERN =
  /(?:^|\/)(?:\.env(?:\.[^/]*)?|auth\.json|credentials?\.json|\.npmrc|[^/]+\.(?:pem|key|p12|pfx|db|sqlite|sqlite3)(?:-(?:journal|wal|shm))?)$/iu;
const OPERATIONAL_EVIDENCE_ID =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/iu;
const OPERATIONAL_EVIDENCE_DOCUMENTS = new Set([
  "docs/product-validation-report.md",
  "docs/research/documented-declaration-routing-validation-2026-08-11.md",
  "docs/research/text-context-model-matrix-2026-08-11.md"
]);

function isOperationalEvidence(path: string): boolean {
  return (
    OPERATIONAL_EVIDENCE_DOCUMENTS.has(path) ||
    (path.startsWith("examples/product-validation/") &&
      (path.endsWith("/VALIDATION.md") || path.includes("/evidence/")))
  );
}

function repositoryFiles(): string[] {
  const result = spawnSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { encoding: "buffer" }
  );
  assert.equal(result.status, 0, result.stderr.toString("utf8"));
  return result.stdout
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
}

test("publishable repository contains no machine-local or runtime-private evidence", () => {
  const files = repositoryFiles();
  const privateFiles = files.filter((path) => PRIVATE_FILE_PATTERN.test(path));
  assert.deepEqual(privateFiles, []);

  const findings: string[] = [];
  for (const path of files) {
    if (path.startsWith("test/")) continue;
    const content = readFileSync(path, "utf8");
    for (const { label, pattern } of PRIVATE_CONTENT_PATTERNS) {
      if (pattern.test(content)) findings.push(`${path}: ${label}`);
    }
    if (isOperationalEvidence(path) && OPERATIONAL_EVIDENCE_ID.test(content)) {
      findings.push(`${path}: operational evidence identifier`);
    }
  }
  assert.deepEqual(findings, []);
});

test("repository ignore policy covers SQLite databases and every sidecar", () => {
  for (const extension of ["db", "sqlite", "sqlite3"] as const) {
    for (const suffix of ["", "-journal", "-shm", "-wal"] as const) {
      const path = `private-state.${extension}${suffix}`;
      const result = spawnSync("git", ["check-ignore", "-q", "--no-index", path]);
      assert.equal(result.status, 0, `${path} must be ignored`);
    }
  }
});
