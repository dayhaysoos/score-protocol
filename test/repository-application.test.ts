import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { sha256Bytes } from "../src/canonical.js";
import {
  RepositoryApplicationConflictError,
  RepositoryConflictRecoveryError,
  RepositoryDriftError,
  RepositoryRootError,
  applyCandidateSet,
  captureRepositoryTargets,
  formatRepositoryDriftFindingForTerminal,
  formatRepositoryDriftForHuman,
  resolveRepositoryRoot,
  verifyRepositoryMatchesSnapshot,
  type RepositorySourceSnapshot
} from "../src/runner/repository-application.js";

const schemaContent = "export interface Account { id: string; name: string; }\n";

function initializeRepository(root: string): void {
  execFileSync("git", ["init", "--quiet", root]);
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "schema.ts"), schemaContent, "utf8");
}

function sourceSnapshot(): RepositorySourceSnapshot {
  return {
    revision_id: "source-snapshot-a",
    content_digest: "sha256:source-snapshot-a",
    files: [
      {
        path: "src/schema.ts",
        media_type: "text/typescript; charset=utf-8",
        content_digest: sha256Bytes(schemaContent)
      }
    ]
  };
}

describe("repository application", () => {
  it("formats application conflicts without hiding execution or recovery state", () => {
    const conflict = new RepositoryDriftError(
      [{ kind: "changed", path: "src/schema.ts" }],
      "/workspace/score-protocol"
    );
    const rolledBack = formatRepositoryDriftForHuman(
      new RepositoryApplicationConflictError(conflict, "rolled_back")
    );
    assert.match(rolledBack, /changed during candidate application/);
    assert.match(rolledBack, /candidate writes were rolled back/);
    assert.doesNotMatch(rolledBack, /No work was started/);

    const recovery = formatRepositoryDriftForHuman(
      new RepositoryConflictRecoveryError(conflict, "/tmp/score-recovery", [
        "src/schema.ts: target changed"
      ])
    );
    assert.match(recovery, /Recovery files: \/tmp\/score-recovery/);
    assert.match(recovery, /Recovery issue: src\/schema.ts: target changed/);
    assert.doesNotMatch(recovery, /No work was started/);
  });

  it("summarizes repository mismatches for a human without dumping every path", () => {
    const error = new RepositoryDriftError(
      [
        { kind: "missing", path: "src/schema.ts" },
        { kind: "unexpected", path: "README.md" },
        { kind: "unexpected", path: "package.json" }
      ],
      "/workspace/score-protocol"
    );

    assert.equal(
      formatRepositoryDriftForHuman(error),
      [
        "Repository does not match the reviewed work.",
        "Missing expected file: src/schema.ts",
        "2 files are outside the approved Source Snapshot.",
        "No work was started. Run again with --verbose to see every mismatch."
      ].join("\n")
    );
  });

  it("renders drift and recovery values without allowing forged terminal records", () => {
    const credentialShapedText = ["ghp", "1234567890abcdefghijklmn"].join("_");
    const maliciousPath =
      `src/Trusted-${credentialShapedText}\nFORGED C0\u0000\u001b]2;FORGED OSC\u0007\u009b2JFORGED C1\u202eFORGED BIDI.ts`;
    const finding = { kind: "missing", path: maliciousPath } as const;
    const conflict = new RepositoryDriftError(
      [finding],
      "/workspace/project"
    );
    assert.equal(finding.path, maliciousPath);
    assert.match(conflict.message, /\u009b/u);
    assert.equal(
      formatRepositoryDriftFindingForTerminal(finding),
      "src/Trusted-[REDACTED CREDENTIAL] FORGED C0 FORGED C1 FORGED BIDI.ts is missing"
    );
    const recovery = formatRepositoryDriftForHuman(
      new RepositoryConflictRecoveryError(
        conflict,
        `/tmp/${maliciousPath}`,
        [`${maliciousPath}: target changed`]
      )
    );

    assert.doesNotMatch(recovery, /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]|\p{Cf}/u);
    assert.doesNotMatch(recovery, /FORGED OSC/u);
    assert.doesNotMatch(recovery, new RegExp(credentialShapedText, "u"));
    assert.doesNotMatch(recovery, /^FORGED/mu);
    assert.match(recovery, /Missing expected file: src\/Trusted-\[REDACTED CREDENTIAL\] FORGED C0 FORGED C1 FORGED BIDI\.ts/u);
    assert.match(recovery, /Recovery files: \/tmp\/src\/Trusted-\[REDACTED CREDENTIAL\] FORGED C0 FORGED C1 FORGED BIDI\.ts/u);
    assert.match(recovery, /Recovery issue: src\/Trusted-\[REDACTED CREDENTIAL\] FORGED C0 FORGED C1 FORGED BIDI\.ts: target changed/u);
  });

  it("preserves an exact nested project root instead of widening to the Git root", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "score-repository-root-")));
    try {
      initializeRepository(root);
      const nested = join(root, "src", "nested");
      mkdirSync(nested);

      assert.equal(resolveRepositoryRoot(nested), realpathSync(nested));
      assert.doesNotThrow(() =>
        verifyRepositoryMatchesSnapshot({
          repositoryRoot: root,
          snapshot: sourceSnapshot()
        })
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts an exact project directory before Git is initialized", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "score-unmanaged-project-")));
    try {
      mkdirSync(join(root, "src"));
      writeFileSync(join(root, "src", "schema.ts"), schemaContent, "utf8");

      assert.equal(resolveRepositoryRoot(root), root);
      assert.doesNotThrow(() =>
        verifyRepositoryMatchesSnapshot({
          repositoryRoot: root,
          snapshot: sourceSnapshot()
        })
      );

      writeFileSync(join(root, "README.md"), "unrelated\n", "utf8");
      assert.doesNotThrow(() =>
        verifyRepositoryMatchesSnapshot({
          repositoryRoot: root,
          snapshot: sourceSnapshot()
        })
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not depend on containing Git metadata to resolve the project root", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "score-invalid-git-root-")));
    try {
      const nested = join(root, "src", "nested");
      mkdirSync(nested, { recursive: true });
      mkdirSync(join(root, ".git"));

      assert.equal(resolveRepositoryRoot(nested), realpathSync(nested));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("excludes nested Git metadata from an unmanaged project manifest", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "score-nested-git-metadata-")));
    try {
      mkdirSync(join(root, "src"));
      writeFileSync(join(root, "src", "schema.ts"), schemaContent, "utf8");
      mkdirSync(join(root, "vendor", ".git"), { recursive: true });
      writeFileSync(join(root, "vendor", ".git", "config"), "metadata\n", "utf8");

      assert.doesNotThrow(() =>
        verifyRepositoryMatchesSnapshot({
          repositoryRoot: root,
          snapshot: sourceSnapshot()
        })
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects modified and missing declared targets while ignoring additional files", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "score-repository-drift-")));
    try {
      initializeRepository(root);
      writeFileSync(join(root, "src", "schema.ts"), "changed\n", "utf8");
      writeFileSync(join(root, "src", "unexpected.ts"), "unexpected\n", "utf8");

      assert.throws(
        () =>
          verifyRepositoryMatchesSnapshot({
            repositoryRoot: root,
            snapshot: sourceSnapshot()
          }),
        (error: unknown) => {
          assert.ok(error instanceof RepositoryDriftError);
          assert.deepEqual(error.findings, [{ kind: "changed", path: "src/schema.ts" }]);
          return true;
        }
      );

      rmSync(join(root, "src", "schema.ts"));
      rmSync(join(root, "src", "unexpected.ts"));
      assert.throws(
        () =>
          verifyRepositoryMatchesSnapshot({
            repositoryRoot: root,
            snapshot: sourceSnapshot()
          }),
        (error: unknown) => {
          assert.ok(error instanceof RepositoryDriftError);
          assert.deepEqual(error.findings, [{ kind: "missing", path: "src/schema.ts" }]);
          return true;
        }
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects an approved absent target even when Git ignores it", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "score-repository-ignored-target-")));
    try {
      initializeRepository(root);
      writeFileSync(
        join(root, ".git", "info", "exclude"),
        "src/account-label.ts\n",
        "utf8"
      );
      writeFileSync(join(root, "src", "account-label.ts"), "ignored target\n", "utf8");

      assert.throws(
        () =>
          verifyRepositoryMatchesSnapshot({
            repositoryRoot: root,
            snapshot: sourceSnapshot(),
            absentPaths: ["src/account-label.ts"]
          }),
        (error: unknown) => {
          assert.ok(error instanceof RepositoryDriftError);
          assert.deepEqual(error.findings, [
            { kind: "occupied", path: "src/account-label.ts" }
          ]);
          return true;
        }
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("refuses to rebind a frozen root after its path becomes a symlink", () => {
    const parent = realpathSync(mkdtempSync(join(tmpdir(), "score-repository-rebind-")));
    const root = join(parent, "repository");
    const moved = join(parent, "moved-repository");
    try {
      initializeRepository(root);
      renameSync(root, moved);
      symlinkSync(moved, root, "dir");

      assert.throws(
        () =>
          verifyRepositoryMatchesSnapshot({
            repositoryRoot: root,
            snapshot: sourceSnapshot()
          }),
        RepositoryRootError
      );
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it("rejects a symbolic-link target instead of treating it as confirmable state", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "score-repository-confirmed-symlink-")));
    try {
      initializeRepository(root);
      writeFileSync(join(root, "outside.ts"), "outside\n", "utf8");
      rmSync(join(root, "src", "schema.ts"));
      symlinkSync(join(root, "outside.ts"), join(root, "src", "schema.ts"));

      assert.throws(
        () =>
          captureRepositoryTargets({
            repositoryRoot: root,
            targetPaths: ["src/schema.ts"]
          }),
        (error: unknown) => {
          assert.ok(error instanceof RepositoryDriftError);
          assert.deepEqual(error.findings, [
            { kind: "not_regular", path: "src/schema.ts" }
          ]);
          return true;
        }
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a candidate digest mismatch before applying any target", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "score-repository-digest-")));
    try {
      initializeRepository(root);
      const replacement = "export interface Account { status: string; }\n";
      const created = "export const accountLabel = 'account';\n";

      assert.throws(
        () =>
          applyCandidateSet({
            repositoryRoot: root,
            snapshot: sourceSnapshot(),
            approvedTargets: [
              { targetPath: "src/account-label.ts", operation: "create" },
              { targetPath: "src/schema.ts", operation: "replace" }
            ],
            candidates: [
              {
                targetPath: "src/schema.ts",
                operation: "replace",
                content: replacement,
                candidateDigest: sha256Bytes("different bytes")
              },
              {
                targetPath: "src/account-label.ts",
                operation: "create",
                content: created,
                candidateDigest: sha256Bytes(created)
              }
            ]
          }),
        /Candidate digest mismatch for src\/schema\.ts/
      );
      assert.equal(readFileSync(join(root, "src", "schema.ts"), "utf8"), schemaContent);
      assert.equal(existsSync(join(root, "src", "account-label.ts")), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("applies one complete integrity-checked candidate set to its approved target paths", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "score-repository-apply-")));
    try {
      initializeRepository(root);
      const replacement = "export interface Account { id: string; name: string; status: string; }\n";
      const created = "export const accountLabel = 'account';\n";

      assert.deepEqual(
        applyCandidateSet({
          repositoryRoot: root,
          snapshot: sourceSnapshot(),
          approvedTargets: [
            { targetPath: "src/account-label.ts", operation: "create" },
            { targetPath: "src/schema.ts", operation: "replace" }
          ],
          candidates: [
            {
              targetPath: "src/schema.ts",
              operation: "replace",
              content: replacement,
              candidateDigest: sha256Bytes(replacement)
            },
            {
              targetPath: "src/account-label.ts",
              operation: "create",
              content: created,
              candidateDigest: sha256Bytes(created)
            }
          ]
        }),
        { appliedPaths: ["src/account-label.ts", "src/schema.ts"] }
      );
      assert.equal(readFileSync(join(root, "src", "schema.ts"), "utf8"), replacement);
      assert.equal(readFileSync(join(root, "src", "account-label.ts"), "utf8"), created);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("atomically replaces the exact target files confirmed for a guided Run", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "score-repository-confirmed-")));
    try {
      initializeRepository(root);
      const currentSchema = "// schema changed after planning\n";
      const currentLabel = "// create target already exists\n";
      writeFileSync(join(root, "src", "schema.ts"), currentSchema, "utf8");
      writeFileSync(join(root, "src", "account-label.ts"), currentLabel, "utf8");
      const confirmedTargets = captureRepositoryTargets({
        repositoryRoot: root,
        targetPaths: ["src/account-label.ts", "src/schema.ts"]
      });
      const replacement = "export interface Account { id: string; status: string; }\n";
      const created = "export const accountLabel = 'account';\n";

      assert.deepEqual(
        applyCandidateSet({
          repositoryRoot: root,
          snapshot: sourceSnapshot(),
          confirmedTargets,
          approvedTargets: [
            { targetPath: "src/account-label.ts", operation: "create" },
            { targetPath: "src/schema.ts", operation: "replace" }
          ],
          candidates: [
            {
              targetPath: "src/schema.ts",
              operation: "replace",
              content: replacement,
              candidateDigest: sha256Bytes(replacement)
            },
            {
              targetPath: "src/account-label.ts",
              operation: "create",
              content: created,
              candidateDigest: sha256Bytes(created)
            }
          ]
        }),
        { appliedPaths: ["src/account-label.ts", "src/schema.ts"] }
      );
      assert.equal(readFileSync(join(root, "src", "schema.ts"), "utf8"), replacement);
      assert.equal(readFileSync(join(root, "src", "account-label.ts"), "utf8"), created);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("recreates a replacement target that was absent at guided confirmation", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "score-repository-confirmed-absent-")));
    try {
      initializeRepository(root);
      rmSync(join(root, "src", "schema.ts"));
      const confirmedTargets = captureRepositoryTargets({
        repositoryRoot: root,
        targetPaths: ["src/schema.ts"]
      });
      const replacement = "export interface Account { status: string; }\n";

      applyCandidateSet({
        repositoryRoot: root,
        snapshot: sourceSnapshot(),
        confirmedTargets,
        approvedTargets: [{ targetPath: "src/schema.ts", operation: "replace" }],
        candidates: [
          {
            targetPath: "src/schema.ts",
            operation: "replace",
            content: replacement,
            candidateDigest: sha256Bytes(replacement)
          }
        ]
      });

      assert.equal(readFileSync(join(root, "src", "schema.ts"), "utf8"), replacement);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("restores confirmed current files when guided application fails", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "score-repository-confirmed-rollback-")));
    try {
      initializeRepository(root);
      const currentSchema = "// current schema\n";
      const currentLabel = "// current label\n";
      writeFileSync(join(root, "src", "schema.ts"), currentSchema, "utf8");
      writeFileSync(join(root, "src", "account-label.ts"), currentLabel, "utf8");
      const confirmedTargets = captureRepositoryTargets({
        repositoryRoot: root,
        targetPaths: ["src/account-label.ts", "src/schema.ts"]
      });
      const replacement = "export interface Account { status: string; }\n";
      const created = "export const accountLabel = 'candidate';\n";
      let commits = 0;

      assert.throws(() =>
        applyCandidateSet(
          {
            repositoryRoot: root,
            snapshot: sourceSnapshot(),
            confirmedTargets,
            approvedTargets: [
              { targetPath: "src/account-label.ts", operation: "create" },
              { targetPath: "src/schema.ts", operation: "replace" }
            ],
            candidates: [
              {
                targetPath: "src/account-label.ts",
                operation: "create",
                content: created,
                candidateDigest: sha256Bytes(created)
              },
              {
                targetPath: "src/schema.ts",
                operation: "replace",
                content: replacement,
                candidateDigest: sha256Bytes(replacement)
              }
            ]
          },
          {
            commitStagedFile: (source, target) => {
              commits += 1;
              if (commits === 2) throw new Error("synthetic write failure");
              linkSync(source, target);
            }
          }
        )
      );
      assert.equal(readFileSync(join(root, "src", "schema.ts"), "utf8"), currentSchema);
      assert.equal(readFileSync(join(root, "src", "account-label.ts"), "utf8"), currentLabel);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("atomically recreates an explicitly accepted missing replacement", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "score-repository-recreate-")));
    try {
      initializeRepository(root);
      rmSync(join(root, "src", "schema.ts"));
      const replacement = "export interface Account { id: string; status: string; }\n";
      const created = "export const accountLabel = 'account';\n";

      assert.deepEqual(
        applyCandidateSet({
          repositoryRoot: root,
          snapshot: sourceSnapshot(),
          acceptedMissingReplacementPaths: ["src/schema.ts"],
          approvedTargets: [
            { targetPath: "src/account-label.ts", operation: "create" },
            { targetPath: "src/schema.ts", operation: "replace" }
          ],
          candidates: [
            {
              targetPath: "src/schema.ts",
              operation: "replace",
              content: replacement,
              candidateDigest: sha256Bytes(replacement)
            },
            {
              targetPath: "src/account-label.ts",
              operation: "create",
              content: created,
              candidateDigest: sha256Bytes(created)
            }
          ]
        }),
        { appliedPaths: ["src/account-label.ts", "src/schema.ts"] }
      );
      assert.equal(readFileSync(join(root, "src", "schema.ts"), "utf8"), replacement);
      assert.equal(readFileSync(join(root, "src", "account-label.ts"), "utf8"), created);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("blocks an accepted missing replacement that reappears before application", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "score-repository-reappeared-")));
    try {
      initializeRepository(root);
      rmSync(join(root, "src", "schema.ts"));
      const replacement = "export interface Account { status: string; }\n";

      assert.throws(
        () =>
          applyCandidateSet(
            {
              repositoryRoot: root,
              snapshot: sourceSnapshot(),
              acceptedMissingReplacementPaths: ["src/schema.ts"],
              approvedTargets: [{ targetPath: "src/schema.ts", operation: "replace" }],
              candidates: [
                {
                  targetPath: "src/schema.ts",
                  operation: "replace",
                  content: replacement,
                  candidateDigest: sha256Bytes(replacement)
                }
              ]
            },
            {
              beforeFinalSnapshotCheck: () =>
                writeFileSync(join(root, "src", "schema.ts"), "// external recreation\n")
            }
          ),
        (error: unknown) => {
          assert.ok(error instanceof RepositoryApplicationConflictError);
          assert.deepEqual(error.findings, [
            { kind: "reappeared", path: "src/schema.ts" }
          ]);
          assert.equal(error.applicationOutcome, "not_written");
          return true;
        }
      );
      assert.equal(
        readFileSync(join(root, "src", "schema.ts"), "utf8"),
        "// external recreation\n"
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("removes a recreated replacement when a later candidate fails", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "score-repository-recreate-rollback-")));
    try {
      initializeRepository(root);
      rmSync(join(root, "src", "schema.ts"));
      const replacement = "export interface Account { status: string; }\n";
      const created = "export const last = true;\n";
      let commits = 0;

      assert.throws(
        () =>
          applyCandidateSet(
            {
              repositoryRoot: root,
              snapshot: sourceSnapshot(),
              acceptedMissingReplacementPaths: ["src/schema.ts"],
              approvedTargets: [
                { targetPath: "src/schema.ts", operation: "replace" },
                { targetPath: "src/z-last.ts", operation: "create" }
              ],
              candidates: [
                {
                  targetPath: "src/schema.ts",
                  operation: "replace",
                  content: replacement,
                  candidateDigest: sha256Bytes(replacement)
                },
                {
                  targetPath: "src/z-last.ts",
                  operation: "create",
                  content: created,
                  candidateDigest: sha256Bytes(created)
                }
              ]
            },
            {
              commitStagedFile: (source, target) => {
                commits += 1;
                if (commits === 2) throw new Error("synthetic later failure");
                linkSync(source, target);
              }
            }
          ),
        /all targets were restored.*synthetic later failure/
      );
      assert.equal(existsSync(join(root, "src", "schema.ts")), false);
      assert.equal(existsSync(join(root, "src", "z-last.ts")), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("restores every original target when a synchronous commit fails", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "score-repository-rollback-")));
    try {
      initializeRepository(root);
      mkdirSync(join(root, "src", "existing"));
      const replacement = "export interface Account { status: string; }\n";
      const created = "export const accountLabel = 'account';\n";
      let commits = 0;

      assert.throws(() =>
        applyCandidateSet(
          {
            repositoryRoot: root,
            snapshot: sourceSnapshot(),
            approvedTargets: [
              { targetPath: "src/existing/account-label.ts", operation: "create" },
              { targetPath: "src/schema.ts", operation: "replace" }
            ],
            candidates: [
              {
                targetPath: "src/existing/account-label.ts",
                operation: "create",
                content: created,
                candidateDigest: sha256Bytes(created)
              },
              {
                targetPath: "src/schema.ts",
                operation: "replace",
                content: replacement,
                candidateDigest: sha256Bytes(replacement)
              }
            ]
          },
          {
            commitStagedFile: (source, target) => {
              commits += 1;
              if (commits === 2) throw new Error("synthetic write failure");
              linkSync(source, target);
            }
          }
        )
      );

      assert.equal(readFileSync(join(root, "src", "schema.ts"), "utf8"), schemaContent);
      assert.equal(existsSync(join(root, "src", "existing", "account-label.ts")), false);
      assert.equal(existsSync(join(root, "src", "existing")), true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not overwrite a target created after the final repository check", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "score-repository-create-race-")));
    try {
      initializeRepository(root);
      const created = "export const accountLabel = 'candidate';\n";
      const concurrent = "export const accountLabel = 'user edit';\n";

      assert.throws(
        () => applyCandidateSet(
          {
            repositoryRoot: root,
            snapshot: sourceSnapshot(),
            approvedTargets: [{ targetPath: "src/account-label.ts", operation: "create" }],
            candidates: [
              {
                targetPath: "src/account-label.ts",
                operation: "create",
                content: created,
                candidateDigest: sha256Bytes(created)
              }
            ]
          },
          {
            commitStagedFile: (source, target) => {
              writeFileSync(target, concurrent, "utf8");
              linkSync(source, target);
            }
          }
        ),
        (error: unknown) => {
          assert.ok(error instanceof RepositoryDriftError);
          assert.deepEqual(error.findings, [
            { kind: "occupied", path: "src/account-label.ts" }
          ]);
          return true;
        }
      );
      assert.equal(readFileSync(join(root, "src", "account-label.ts"), "utf8"), concurrent);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("restores an edit that arrives immediately before a replacement is moved", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "score-repository-replace-race-")));
    try {
      initializeRepository(root);
      const replacement = "export interface Account { status: string; }\n";
      const concurrent = "// user edit during application\n";

      assert.throws(
        () => applyCandidateSet(
          {
            repositoryRoot: root,
            snapshot: sourceSnapshot(),
            approvedTargets: [{ targetPath: "src/schema.ts", operation: "replace" }],
            candidates: [
              {
                targetPath: "src/schema.ts",
                operation: "replace",
                content: replacement,
                candidateDigest: sha256Bytes(replacement)
              }
            ]
          },
          {
            moveOriginalToBackup: (source, backup) => {
              writeFileSync(source, concurrent, "utf8");
              renameSync(source, backup);
            }
          }
        ),
        (error: unknown) => {
          assert.ok(error instanceof RepositoryDriftError);
          assert.deepEqual(error.findings, [{ kind: "changed", path: "src/schema.ts" }]);
          return true;
        }
      );
      assert.equal(readFileSync(join(root, "src", "schema.ts"), "utf8"), concurrent);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("allows an unrelated repository change made after candidate staging", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "score-repository-final-drift-")));
    try {
      initializeRepository(root);
      const replacement = "export interface Account { status: string; }\n";

      assert.deepEqual(
        applyCandidateSet(
          {
            repositoryRoot: root,
            snapshot: sourceSnapshot(),
            approvedTargets: [{ targetPath: "src/schema.ts", operation: "replace" }],
            candidates: [
              {
                targetPath: "src/schema.ts",
                operation: "replace",
                content: replacement,
                candidateDigest: sha256Bytes(replacement)
              }
            ]
          },
          {
            beforeFinalSnapshotCheck: () => {
              writeFileSync(join(root, "src", "unrelated.ts"), "// user edit\n", "utf8");
            }
          }
        ),
        { appliedPaths: ["src/schema.ts"] }
      );
      assert.equal(readFileSync(join(root, "src", "schema.ts"), "utf8"), replacement);
      assert.equal(readFileSync(join(root, "src", "unrelated.ts"), "utf8"), "// user edit\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps an unrelated edit made during target installation", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "score-repository-install-drift-")));
    try {
      initializeRepository(root);
      const replacement = "export interface Account { status: string; }\n";
      const unrelated = "// user edit during installation\n";

      assert.deepEqual(
        applyCandidateSet(
          {
            repositoryRoot: root,
            snapshot: sourceSnapshot(),
            approvedTargets: [{ targetPath: "src/schema.ts", operation: "replace" }],
            candidates: [
              {
                targetPath: "src/schema.ts",
                operation: "replace",
                content: replacement,
                candidateDigest: sha256Bytes(replacement)
              }
            ]
          },
          {
            commitStagedFile: (source, target) => {
              linkSync(source, target);
              writeFileSync(join(root, "src", "unrelated.ts"), unrelated, "utf8");
            }
          }
        ),
        { appliedPaths: ["src/schema.ts"] }
      );
      assert.equal(readFileSync(join(root, "src", "schema.ts"), "utf8"), replacement);
      assert.equal(readFileSync(join(root, "src", "unrelated.ts"), "utf8"), unrelated);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("blocks the complete candidate set when any declared target changes before apply", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "score-target-conflict-")));
    try {
      initializeRepository(root);
      const replacement = "export interface Account { status: string; }\n";
      const created = "export const accountLabel = 'candidate';\n";
      const concurrent = "// user changed the declared target\n";

      assert.throws(
        () =>
          applyCandidateSet(
            {
              repositoryRoot: root,
              snapshot: sourceSnapshot(),
              approvedTargets: [
                { targetPath: "src/account-label.ts", operation: "create" },
                { targetPath: "src/schema.ts", operation: "replace" }
              ],
              candidates: [
                {
                  targetPath: "src/account-label.ts",
                  operation: "create",
                  content: created,
                  candidateDigest: sha256Bytes(created)
                },
                {
                  targetPath: "src/schema.ts",
                  operation: "replace",
                  content: replacement,
                  candidateDigest: sha256Bytes(replacement)
                }
              ]
            },
            {
              beforeFinalSnapshotCheck: () => {
                writeFileSync(join(root, "src", "schema.ts"), concurrent, "utf8");
              }
            }
          ),
        (error: unknown) => {
          assert.ok(error instanceof RepositoryDriftError);
          assert.deepEqual(error.findings, [{ kind: "changed", path: "src/schema.ts" }]);
          return true;
        }
      );
      assert.equal(readFileSync(join(root, "src", "schema.ts"), "utf8"), concurrent);
      assert.equal(existsSync(join(root, "src", "account-label.ts")), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("fails before moving originals when the repository cannot install hard links", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "score-repository-hard-links-")));
    try {
      initializeRepository(root);
      const replacement = "export interface Account { status: string; }\n";

      assert.throws(
        () =>
          applyCandidateSet(
            {
              repositoryRoot: root,
              snapshot: sourceSnapshot(),
              approvedTargets: [{ targetPath: "src/schema.ts", operation: "replace" }],
              candidates: [
                {
                  targetPath: "src/schema.ts",
                  operation: "replace",
                  content: replacement,
                  candidateDigest: sha256Bytes(replacement)
                }
              ]
            },
            {
              verifyHardLinkSupport: () => {
                throw new Error("hard links unsupported");
              }
            }
          ),
        /hard links unsupported/
      );
      assert.equal(readFileSync(join(root, "src", "schema.ts"), "utf8"), schemaContent);
      assert.deepEqual(
        readdirSync(root).filter((path) => path.startsWith(".score-apply-")),
        []
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns a structured conflict when a replace target disappears during staging", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "score-repository-staging-race-")));
    try {
      initializeRepository(root);
      const replacement = "export interface Account { status: string; }\n";

      assert.throws(
        () =>
          applyCandidateSet(
            {
              repositoryRoot: root,
              snapshot: sourceSnapshot(),
              approvedTargets: [{ targetPath: "src/schema.ts", operation: "replace" }],
              candidates: [
                {
                  targetPath: "src/schema.ts",
                  operation: "replace",
                  content: replacement,
                  candidateDigest: sha256Bytes(replacement)
                }
              ]
            },
            {
              beforeCandidateStaging: () => {
                rmSync(join(root, "src", "schema.ts"));
              }
            }
          ),
        (error: unknown) => {
          assert.ok(error instanceof RepositoryApplicationConflictError);
          assert.equal(error.applicationOutcome, "not_written");
          assert.deepEqual(error.findings, [{ kind: "missing", path: "src/schema.ts" }]);
          return true;
        }
      );
      assert.equal(existsSync(join(root, "src", "schema.ts")), false);
      assert.deepEqual(
        readdirSync(root).filter((path) => path.startsWith(".score-apply-")),
        []
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("blocks an ancestor changed to a symlink after candidate staging", () => {
    const parent = realpathSync(mkdtempSync(join(tmpdir(), "score-repository-ancestor-race-")));
    const root = join(parent, "repository");
    const outside = join(parent, "outside");
    try {
      initializeRepository(root);
      mkdirSync(join(root, "src", "safe"));
      mkdirSync(outside);
      const created = "export const value = 'candidate';\n";

      assert.throws(() =>
        applyCandidateSet(
          {
            repositoryRoot: root,
            snapshot: sourceSnapshot(),
            approvedTargets: [{ targetPath: "src/safe/new.ts", operation: "create" }],
            candidates: [
              {
                targetPath: "src/safe/new.ts",
                operation: "create",
                content: created,
                candidateDigest: sha256Bytes(created)
              }
            ]
          },
          {
            beforeTargetMutation: () => {
              rmSync(join(root, "src", "safe"), { recursive: true });
              symlinkSync(outside, join(root, "src", "safe"), "dir");
            }
          }
        )
      );
      assert.equal(existsSync(join(outside, "new.ts")), false);
    } finally {
      rmSync(parent, { recursive: true, force: true });
    }
  });

  it("preserves backups and reports their path when rollback cannot restore", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "score-repository-recovery-")));
    try {
      initializeRepository(root);
      const replacement = "export interface Account { status: string; }\n";
      const concurrent = "// concurrent replacement\n";
      let recoveryPath: string | undefined;

      assert.throws(
        () =>
          applyCandidateSet(
            {
              repositoryRoot: root,
              snapshot: sourceSnapshot(),
              approvedTargets: [{ targetPath: "src/schema.ts", operation: "replace" }],
              candidates: [
                {
                  targetPath: "src/schema.ts",
                  operation: "replace",
                  content: replacement,
                  candidateDigest: sha256Bytes(replacement)
                }
              ]
            },
            {
              commitStagedFile: (_source, target) => {
                writeFileSync(target, concurrent, "utf8");
                throw new Error("synthetic commit obstruction");
              }
            }
          ),
        (error: unknown) => {
          assert.ok(error instanceof RepositoryConflictRecoveryError);
          assert.deepEqual(error.findings, [{ kind: "changed", path: "src/schema.ts" }]);
          recoveryPath = error.recoveryPath;
          return true;
        }
      );
      assert.ok(recoveryPath);
      assert.equal(
        readFileSync(join(recoveryPath, "backups", "src", "schema.ts"), "utf8"),
        schemaContent
      );
      assert.equal(readFileSync(join(root, "src", "schema.ts"), "utf8"), concurrent);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports manual recovery when an installed create target becomes a dangling symlink", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "score-repository-symlink-recovery-")));
    try {
      initializeRepository(root);
      const created = "export const accountLabel = 'candidate';\n";
      let recoveryPath: string | undefined;

      assert.throws(
        () =>
          applyCandidateSet(
            {
              repositoryRoot: root,
              snapshot: sourceSnapshot(),
              approvedTargets: [{ targetPath: "src/account-label.ts", operation: "create" }],
              candidates: [
                {
                  targetPath: "src/account-label.ts",
                  operation: "create",
                  content: created,
                  candidateDigest: sha256Bytes(created)
                }
              ]
            },
            {
              commitStagedFile: (source, target) => {
                linkSync(source, target);
                rmSync(target);
                symlinkSync("missing-target.ts", target);
              }
            }
          ),
        (error: unknown) => {
          assert.ok(error instanceof RepositoryConflictRecoveryError);
          assert.deepEqual(error.findings, [
            { kind: "not_regular", path: "src/account-label.ts" }
          ]);
          assert.ok(
            error.rollbackFailures.some((failure) =>
              failure.includes("target changed after candidate installation")
            )
          );
          recoveryPath = error.recoveryPath;
          return true;
        }
      );
      assert.ok(recoveryPath);
      assert.equal(existsSync(recoveryPath), true);
      assert.equal(existsSync(join(root, "src", "account-label.ts")), false);
      assert.equal(lstatSync(join(root, "src", "account-label.ts")).isSymbolicLink(), true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports cleanup trouble without misclassifying installed files as failed", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "score-repository-cleanup-")));
    try {
      initializeRepository(root);
      const replacement = "export interface Account { status: string; }\n";
      const result = applyCandidateSet(
        {
          repositoryRoot: root,
          snapshot: sourceSnapshot(),
          approvedTargets: [{ targetPath: "src/schema.ts", operation: "replace" }],
          candidates: [
            {
              targetPath: "src/schema.ts",
              operation: "replace",
              content: replacement,
              candidateDigest: sha256Bytes(replacement)
            }
          ]
        },
        {
          cleanupStaging: () => {
            throw new Error("synthetic cleanup failure");
          }
        }
      );

      assert.deepEqual(result.appliedPaths, ["src/schema.ts"]);
      assert.match(result.cleanupWarning ?? "", /Applied files.*synthetic cleanup failure/);
      assert.equal(readFileSync(join(root, "src", "schema.ts"), "utf8"), replacement);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
