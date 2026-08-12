import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { promisify } from "node:util";

import Database from "better-sqlite3";

import {
  prepareSlice,
  type PrepareSliceResult,
  type SliceDraft
} from "../src/plan-intake.js";
import { prepareSlice as prepareSliceFromCurrentProject } from "../src/plan-intake-tool.js";
import { ScoreAlpha } from "../src/score-alpha.js";

const execFileAsync = promisify(execFile);

function writeProjectFile(root: string, path: string, content: string): void {
  const absolutePath = join(root, path);
  mkdirSync(join(absolutePath, ".."), { recursive: true });
  writeFileSync(absolutePath, content, "utf8");
}

function createTypeScriptProject(): string {
  const root = mkdtempSync(join(tmpdir(), "score-plan-intake-"));
  writeProjectFile(root, "package.json", '{"type":"module"}\n');
  writeProjectFile(
    root,
    "tsconfig.json",
    JSON.stringify(
      {
        compilerOptions: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
          target: "ES2024",
          strict: true,
          skipLibCheck: true,
          types: []
        },
        include: ["src/**/*.ts"]
      },
      null,
      2
    ) + "\n"
  );
  writeProjectFile(
    root,
    "src/schema.ts",
    "export interface Account {\n  id: string;\n}\n"
  );
  writeProjectFile(
    root,
    "src/example.ts",
    "export const exampleAccount = { id: \"a-1\", status: \"active\" as const };\n"
  );
  writeProjectFile(
    root,
    "skills/type-imports.md",
    "# Type imports\n\nUse `import type` for type-only dependencies.\n"
  );
  return realpathSync(root);
}

const requirements = [
  "Account exposes an active or suspended status.",
  "formatAccountLabel returns the account id and status."
] as const;

function accountServiceDraft(): SliceDraft {
  return {
    slice_id: "account-service",
    title: "Account Service",
    objective: "Add account status and a pure account label formatter.",
    requirements: [...requirements],
    files: [
      {
        path: "src/schema.ts",
        operation: "modify",
        task: "Add the required status field to Account.",
        requirements: [requirements[0]],
        owns: [
          {
            name: "Account",
            declaration:
              'export interface Account { id: string; status: "active" | "suspended"; }',
            description: "Represents an account with its current status."
          }
        ],
        consumes: [],
        context: [],
        skills: [
          {
            name: "Schema discipline",
            content: "Preserve existing public members unless the task explicitly changes them."
          }
        ],
        constraints: ["Keep Account exported."]
      },
      {
        path: "src/account-label.ts",
        operation: "create",
        task: "Create a pure account label formatter.",
        requirements: [requirements[1]],
        owns: [
          {
            name: "formatAccountLabel",
            declaration: "export function formatAccountLabel(account: Account): string;",
            description: "Returns the account id and status as a label."
          }
        ],
        consumes: [{ name: "Account", from: "src/schema.ts" }],
        context: [
          {
            path: "src/example.ts",
            purpose: "Show the current Account-shaped example."
          }
        ],
        skills: [{ name: "Type imports", path: "skills/type-imports.md" }],
        constraints: ["Return a string without side effects."]
      }
    ]
  };
}

function cloneDraft(): Record<string, unknown> {
  return structuredClone(accountServiceDraft()) as unknown as Record<string, unknown>;
}

describe("Plan Intake", () => {
  it("offers an agent-facing entry point that binds the exact current project root", () => {
    const projectRoot = createTypeScriptProject();
    const originalCwd = process.cwd();
    try {
      process.chdir(projectRoot);

      const result = prepareSliceFromCurrentProject({
        sliceDraft: accountServiceDraft()
      });

      assert.equal(result.status, "review_ready");
      if (result.status !== "review_ready") return;
      assert.equal(
        result.reviewPath,
        join(projectRoot, ".score", "reviews", "account-service-review.html")
      );
    } finally {
      process.chdir(originalCwd);
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("prepares one compact slice into named local review artifacts without changing source files", () => {
    const projectRoot = createTypeScriptProject();
    try {
      const originalSchema = readFileSync(join(projectRoot, "src/schema.ts"), "utf8");

      const result = prepareSlice({ projectRoot, sliceDraft: accountServiceDraft() });

      assert.equal(result.status, "review_ready");
      if (result.status !== "review_ready") return;
      assert.equal(
        result.reviewPath,
        join(projectRoot, ".score", "reviews", "account-service-review.html")
      );
      assert.equal(
        result.snapshotPath,
        join(projectRoot, ".score", "reviews", "account-service-review.snapshot.json")
      );
      assert.ok(existsSync(join(projectRoot, ".score", "score.db")));
      assert.ok(existsSync(result.reviewPath));
      assert.ok(existsSync(result.snapshotPath));
      assert.deepEqual(result.nextAction, {
        command: "score start",
        condition: "after_review"
      });

      const html = readFileSync(result.reviewPath, "utf8");
      assert.match(html, /SCORE Slice Review/);
      assert.doesNotMatch(readFileSync(result.snapshotPath, "utf8"), /reviewKind|nextAction/);
      assert.match(html, /Account Service/);
      assert.match(html, /src\/schema\.ts/);
      assert.match(html, /src\/account-label\.ts/);
      assert.match(html, /Show the current Account-shaped example/);
      assert.match(html, /Use `import type` for type-only dependencies/);
      assert.match(html, /Preserve existing public members/);
      assert.doesNotMatch(html, /<h2 id="issues-title">Issues<\/h2>/);

      const snapshot = JSON.parse(readFileSync(result.snapshotPath, "utf8")) as {
        passes: Array<{
          capsules: Array<{
            target_path: string;
            agent_input: {
              target: Record<string, unknown>;
              declarations: {
                owned: Array<Record<string, unknown>>;
                consumed: Array<Record<string, unknown>>;
              };
              constraints: string[];
              input_bindings: Array<{
                contract_input: string;
                purpose: string;
                content: unknown;
              }>;
            };
          }>;
        }>;
      };
      const capsules = snapshot.passes.flatMap((pass) => pass.capsules);
      const schemaInput = capsules.find((capsule) => capsule.target_path === "src/schema.ts")
        ?.agent_input;
      const labelInput = capsules.find(
        (capsule) => capsule.target_path === "src/account-label.ts"
      )?.agent_input;
      assert.ok(schemaInput);
      assert.ok(labelInput);
      assert.equal(schemaInput.target.state_at_base_revision, "present");
      assert.equal(
        schemaInput.target.content,
        "export interface Account {\n  id: string;\n}\n"
      );
      assert.deepEqual(
        schemaInput.input_bindings.find(
          (binding) => binding.contract_input === "allocated-requirements"
        )?.content,
        [{ id: "R1", statement: requirements[0] }]
      );
      assert.deepEqual(schemaInput.declarations.owned[0], {
        name: "Account",
        declaration:
          'export interface Account { id: string; status: "active" | "suspended"; }',
        description: "Represents an account with its current status."
      });
      assert.equal(
        schemaInput.input_bindings.find(
          (binding) => binding.contract_input === "selected-skills"
        )?.content,
        "Preserve existing public members unless the task explicitly changes them."
      );
      assert.deepEqual(schemaInput.constraints, [
        "Keep Account exported.",
        "Produce the complete content of src/schema.ts."
      ]);
      assert.equal(labelInput.target.state_at_base_revision, "absent");
      assert.deepEqual(labelInput.declarations.consumed[0], {
        name: "Account",
        declaration:
          'export interface Account { id: string; status: "active" | "suspended"; }',
        description: "Represents an account with its current status."
      });
      assert.deepEqual(
        labelInput.input_bindings.find(
          (binding) => binding.contract_input === "allocated-requirements"
        )?.content,
        [{ id: "R2", statement: requirements[1] }]
      );
      assert.deepEqual(
        labelInput.input_bindings.find(
          (binding) => binding.contract_input === "project-context"
        )?.content,
        {
          path: "src/example.ts",
          media_type: "text/typescript; charset=utf-8",
          content:
            'export const exampleAccount = { id: "a-1", status: "active" as const };\n'
        }
      );
      assert.equal(
        labelInput.input_bindings.find((binding) => binding.contract_input === "selected-skills")
          ?.content,
        "# Type imports\n\nUse `import type` for type-only dependencies.\n"
      );
      assert.equal(readFileSync(join(projectRoot, "src/schema.ts"), "utf8"), originalSchema);
      assert.equal(existsSync(join(projectRoot, "src/account-label.ts")), false);
      assert.equal(existsSync(join(projectRoot, ".score", "runner.db")), false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("refuses to follow a .score symlink outside the project", () => {
    const projectRoot = createTypeScriptProject();
    const outsideDirectory = mkdtempSync(join(tmpdir(), "score-plan-intake-outside-"));
    try {
      symlinkSync(outsideDirectory, join(projectRoot, ".score"), "dir");

      assert.throws(
        () => prepareSlice({ projectRoot, sliceDraft: accountServiceDraft() }),
        /SCORE state directory.*symbolic link/i
      );
      assert.deepEqual(readdirSync(outsideDirectory), []);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(outsideDirectory, { recursive: true, force: true });
    }
  });

  it("refuses SCORE database and reviews symlinks without changing their targets", () => {
    for (const stateEntry of ["score.db", "reviews"] as const) {
      const projectRoot = createTypeScriptProject();
      const outsideDirectory = mkdtempSync(join(tmpdir(), "score-plan-intake-outside-"));
      const scoreDirectory = join(projectRoot, ".score");
      mkdirSync(scoreDirectory);
      const outsidePath = join(outsideDirectory, stateEntry);
      if (stateEntry === "score.db") writeFileSync(outsidePath, "outside bytes\n", "utf8");
      else mkdirSync(outsidePath);
      symlinkSync(
        outsidePath,
        join(scoreDirectory, stateEntry),
        stateEntry === "reviews" ? "dir" : "file"
      );
      try {
        assert.throws(
          () => prepareSlice({ projectRoot, sliceDraft: accountServiceDraft() }),
          /must not be a symbolic link/i
        );
        if (stateEntry === "score.db") {
          assert.equal(readFileSync(outsidePath, "utf8"), "outside bytes\n");
        } else {
          assert.deepEqual(readdirSync(outsidePath), []);
        }
      } finally {
        rmSync(projectRoot, { recursive: true, force: true });
        rmSync(outsideDirectory, { recursive: true, force: true });
      }
    }
  });

  it("refuses a SCORE SQLite sidecar symlink without changing its target", () => {
    const projectRoot = createTypeScriptProject();
    const scoreDirectory = join(projectRoot, ".score");
    const outsidePath = join(projectRoot, "outside");
    mkdirSync(scoreDirectory);
    writeFileSync(outsidePath, "outside bytes\n", "utf8");
    symlinkSync(outsidePath, join(scoreDirectory, "score.db-wal"), "file");
    try {
      assert.throws(
        () => prepareSlice({ projectRoot, sliceDraft: accountServiceDraft() }),
        /SCORE database-wal.*symbolic link/i
      );
      assert.equal(readFileSync(outsidePath, "utf8"), "outside bytes\n");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("creates private SCORE state, database, and review artifacts", () => {
    const projectRoot = createTypeScriptProject();
    try {
      const result = prepareSlice({ projectRoot, sliceDraft: accountServiceDraft() });
      assert.equal(result.status, "review_ready");
      if (result.status !== "review_ready" || process.platform === "win32") return;

      const permissionMode = (path: string) => statSync(path).mode & 0o777;
      assert.equal(permissionMode(join(projectRoot, ".score")), 0o700);
      assert.equal(permissionMode(join(projectRoot, ".score", "reviews")), 0o700);
      assert.equal(permissionMode(join(projectRoot, ".score", "score.db")), 0o600);
      for (const suffix of ["-shm", "-wal"] as const) {
        const sidecarPath = join(projectRoot, ".score", `score.db${suffix}`);
        if (existsSync(sidecarPath)) assert.equal(permissionMode(sidecarPath), 0o600);
      }
      assert.equal(permissionMode(result.reviewPath), 0o600);
      assert.equal(permissionMode(result.snapshotPath), 0o600);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("binds preparation to an exact nested project root and installs a local Git exclusion", () => {
    const gitRoot = mkdtempSync(join(tmpdir(), "score-plan-intake-git-"));
    const projectRoot = join(gitRoot, "packages", "service");
    try {
      mkdirSync(projectRoot, { recursive: true });
      const sourceProject = createTypeScriptProject();
      try {
        for (const path of [
          "package.json",
          "tsconfig.json",
          "src/schema.ts",
          "src/example.ts",
          "skills/type-imports.md"
        ]) {
          writeProjectFile(projectRoot, path, readFileSync(join(sourceProject, path), "utf8"));
        }
      } finally {
        rmSync(sourceProject, { recursive: true, force: true });
      }
      execFileSync("git", ["init", "--quiet", gitRoot]);

      const result = prepareSlice({ projectRoot, sliceDraft: accountServiceDraft() });

      assert.equal(result.status, "review_ready");
      assert.ok(existsSync(join(projectRoot, ".score", "score.db")));
      assert.equal(existsSync(join(gitRoot, ".score")), false);
      assert.match(
        readFileSync(join(gitRoot, ".git", "info", "exclude"), "utf8"),
        /^\/packages\/service\/\.score\/$/m
      );
    } finally {
      rmSync(gitRoot, { recursive: true, force: true });
    }
  });

  it("reuses unchanged preparation and preserves changed same-title revisions", () => {
    const projectRoot = createTypeScriptProject();
    try {
      const first = prepareSlice({ projectRoot, sliceDraft: accountServiceDraft() });
      assert.equal(first.status, "review_ready");
      if (first.status !== "review_ready") return;
      const firstReviewInode = statSync(first.reviewPath).ino;
      const firstSnapshotInode = statSync(first.snapshotPath).ino;
      const unchanged = prepareSlice({ projectRoot, sliceDraft: accountServiceDraft() });
      assert.deepEqual(unchanged, first);
      assert.equal(statSync(first.reviewPath).ino, firstReviewInode);
      assert.equal(statSync(first.snapshotPath).ino, firstSnapshotInode);

      rmSync(first.snapshotPath);
      const recoveredPair = prepareSlice({
        projectRoot,
        sliceDraft: accountServiceDraft()
      });
      assert.deepEqual(recoveredPair, first);
      assert.equal(statSync(first.reviewPath).ino, firstReviewInode);
      assert.ok(existsSync(first.snapshotPath));

      const revisedDraft = accountServiceDraft();
      const revised = prepareSlice({
        projectRoot,
        sliceDraft: {
          ...revisedDraft,
          files: revisedDraft.files.map((file, index) =>
            index === 0
              ? {
                  ...file,
                  owns: file.owns.map((declaration) => ({
                    ...declaration,
                    description: "Represents an account whose status is visible to every caller."
                  }))
                }
              : file
          )
        }
      });
      assert.equal(revised.status, "review_ready");
      if (revised.status !== "review_ready") return;
      assert.equal(
        revised.reviewPath,
        join(projectRoot, ".score", "reviews", "account-service-review-v2.html")
      );
      assert.equal(
        revised.snapshotPath,
        join(projectRoot, ".score", "reviews", "account-service-review-v2.snapshot.json")
      );
      assert.ok(existsSync(first.reviewPath));
      assert.ok(existsSync(first.snapshotPath));
      assert.ok(existsSync(revised.reviewPath));
      assert.ok(existsSync(revised.snapshotPath));
      assert.match(readFileSync(first.reviewPath, "utf8"), /pure account label formatter/);
      assert.match(readFileSync(revised.reviewPath, "utf8"), /status is visible to every caller/);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite an immutable named review artifact", () => {
    const projectRoot = createTypeScriptProject();
    try {
      const first = prepareSlice({ projectRoot, sliceDraft: accountServiceDraft() });
      assert.equal(first.status, "review_ready");
      if (first.status !== "review_ready") return;
      writeFileSync(first.reviewPath, "tampered review\n", "utf8");

      assert.throws(
        () => prepareSlice({ projectRoot, sliceDraft: accountServiceDraft() }),
        /immutable review artifact/i
      );
      assert.equal(readFileSync(first.reviewPath, "utf8"), "tampered review\n");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("does not expose a prepared review whose artifact pair failed publication", () => {
    const projectRoot = createTypeScriptProject();
    try {
      const reviewsDirectory = join(projectRoot, ".score", "reviews");
      mkdirSync(reviewsDirectory, { recursive: true });
      writeFileSync(
        join(reviewsDirectory, "account-service-review.html"),
        "conflicting review\n",
        "utf8"
      );

      assert.throws(
        () => prepareSlice({ projectRoot, sliceDraft: accountServiceDraft() }),
        /immutable review artifact/i
      );
      assert.deepEqual(
        ScoreAlpha.listReviewedChangePlans(join(projectRoot, ".score", "score.db")),
        []
      );
      const databasePath = join(projectRoot, ".score", "score.db");
      const raw = new Database(databasePath, { readonly: true, fileMustExist: true });
      const prepared = raw
        .prepare("SELECT manifest_id AS manifestId FROM prepared_slice_revisions")
        .get() as { manifestId: string };
      raw.close();
      const score = ScoreAlpha.open(databasePath);
      try {
        const review = score.loadPreparedReview(prepared.manifestId);
        const passId = review.digest_set.pass.protocol_id;
        assert.throws(
          () =>
            score.decidePublication({
              review_id: review.review_id,
              authority: "test-human-authority",
              decided_at: "2026-08-07T22:30:00.000Z",
              decision: "approve",
              expected_digest_set: review.digest_set,
              warning_waivers: [],
              rationale: "Synthetic direct approval attempt."
            }),
          /artifact pair/i
        );
        assert.throws(() => score.exportApprovedPass(passId), /artifact pair/i);
      } finally {
        score.close();
      }
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("does not fall back to an older revision when the latest artifact pair is unpublished", () => {
    const projectRoot = createTypeScriptProject();
    try {
      const first = prepareSlice({ projectRoot, sliceDraft: accountServiceDraft() });
      assert.equal(first.status, "review_ready");
      const reviewsDirectory = join(projectRoot, ".score", "reviews");
      writeFileSync(
        join(reviewsDirectory, "account-service-review-v2.html"),
        "conflicting v2 review\n",
        "utf8"
      );
      const original = accountServiceDraft();
      assert.throws(
        () =>
          prepareSlice({
            projectRoot,
            sliceDraft: { ...original, objective: "Prepare the revised account service." }
          }),
        /immutable review artifact/i
      );
      assert.deepEqual(
        ScoreAlpha.listReviewedChangePlans(join(projectRoot, ".score", "score.db")),
        []
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("does not inspect package metadata during preparation", () => {
    const projectRoot = createTypeScriptProject();
    try {
      writeProjectFile(projectRoot, "package.json", "{ malformed\n");

      const result = prepareSlice({ projectRoot, sliceDraft: accountServiceDraft() });

      assert.equal(result.status, "review_ready");
      assert.equal(readFileSync(join(projectRoot, "package.json"), "utf8"), "{ malformed\n");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("freezes mts and cts files as TypeScript context", () => {
    const projectRoot = createTypeScriptProject();
    try {
      writeProjectFile(projectRoot, "src/module-context.mts", "export const esm = true;\n");
      writeProjectFile(projectRoot, "src/common-context.cts", "export const cjs = true;\n");
      const baseDraft = accountServiceDraft();
      const draft: SliceDraft = {
        ...baseDraft,
        files: [
          baseDraft.files[0]!,
          {
            ...baseDraft.files[1]!,
            context: [
              { path: "src/module-context.mts", purpose: "Show ESM context." },
              { path: "src/common-context.cts", purpose: "Show CommonJS context." }
            ]
          }
        ]
      };

      const result = prepareSlice({ projectRoot, sliceDraft: draft });

      assert.equal(result.status, "review_ready");
      if (result.status !== "review_ready") return;
      const snapshot = JSON.parse(readFileSync(result.snapshotPath, "utf8")) as {
        passes: Array<{
          capsules: Array<{
            target_path: string;
            agent_input: {
              input_bindings: Array<{ kind: string; content: unknown }>;
            };
          }>;
        }>;
      };
      const labelInput = snapshot.passes
        .flatMap((pass) => pass.capsules)
        .find((capsule) => capsule.target_path === "src/account-label.ts")?.agent_input;
      assert.ok(labelInput);
      assert.deepEqual(
        labelInput.input_bindings
          .filter((binding) => binding.kind === "project_context")
          .map((binding) => binding.content),
        [
          {
            path: "src/module-context.mts",
            media_type: "text/typescript; charset=utf-8",
            content: "export const esm = true;\n"
          },
          {
            path: "src/common-context.cts",
            media_type: "text/typescript; charset=utf-8",
            content: "export const cjs = true;\n"
          }
        ]
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("does not read project compiler settings and preserves declaration text exactly", () => {
    const projectRoot = createTypeScriptProject();
    try {
      writeProjectFile(
        projectRoot,
        "tsconfig.json",
        "this is intentionally not valid JSON and SCORE must not inspect it\n"
      );
      const original = accountServiceDraft();
      const declaration = "ordinary documented interface text with } unmatched syntax";
      const draft: SliceDraft = {
        ...original,
        files: original.files.map((file, index) =>
          index === 0
            ? {
                ...file,
                owns: [
                  {
                    name: "Account",
                    declaration,
                    description: "Caller-facing account context."
                  }
                ]
              }
            : file
        )
      };

      const result = prepareSlice({ projectRoot, sliceDraft: draft });

      assert.equal(result.status, "review_ready");
      if (result.status !== "review_ready") return;
      const snapshot = JSON.parse(readFileSync(result.snapshotPath, "utf8")) as {
        passes: Array<{
          capsules: Array<{
            target_path: string;
            agent_input: {
              declarations: {
                owned: Array<{ declaration: string }>;
              };
            };
          }>;
        }>;
      };
      const schema = snapshot.passes[0]?.capsules.find(
        (capsule) => capsule.target_path === "src/schema.ts"
      );
      assert.equal(schema?.agent_input.declarations.owned[0]?.declaration, declaration);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects source bytes that cannot round-trip as exact UTF-8", () => {
    const projectRoot = createTypeScriptProject();
    try {
      writeFileSync(join(projectRoot, "src", "schema.ts"), Buffer.from([0xff, 0xfe, 0x00]));

      const result = prepareSlice({ projectRoot, sliceDraft: accountServiceDraft() });

      assert.equal(result.status, "invalid");
      if (result.status !== "invalid") return;
      assert.ok(
        result.findings.some((item) => item.code === "PROJECT_FILE_ENCODING_UNSUPPORTED")
      );
      assert.equal(existsSync(join(projectRoot, ".score")), false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects path-based skill bytes that cannot round-trip as exact UTF-8", () => {
    const projectRoot = createTypeScriptProject();
    try {
      writeFileSync(
        join(projectRoot, "skills", "type-imports.md"),
        Buffer.from([0x23, 0x20, 0xff])
      );

      const result = prepareSlice({ projectRoot, sliceDraft: accountServiceDraft() });

      assert.equal(result.status, "invalid");
      if (result.status !== "invalid") return;
      assert.ok(
        result.findings.some((item) => item.code === "SKILL_ENCODING_UNSUPPORTED")
      );
      assert.equal(existsSync(join(projectRoot, ".score")), false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("returns a typed finding for invalid Unicode in inline skill text", () => {
    const projectRoot = createTypeScriptProject();
    try {
      const original = accountServiceDraft();
      const draft: SliceDraft = {
        ...original,
        files: original.files.map((file, index) =>
          index === 0
            ? { ...file, skills: [{ name: "Invalid inline skill", content: "\ud800" }] }
            : file
        )
      };

      const result = prepareSlice({ projectRoot, sliceDraft: draft });

      assert.equal(result.status, "invalid");
      if (result.status !== "invalid") return;
      assert.ok(result.findings.some((item) => item.code === "SLICE_UNICODE_INVALID"));
      assert.equal(existsSync(join(projectRoot, ".score")), false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("prepares non-TypeScript targets without a language environment", () => {
    const projectRoot = createTypeScriptProject();
    try {
      writeProjectFile(projectRoot, "README.md", "# Account service\n");
      const original = accountServiceDraft();
      const draft: SliceDraft = {
        ...original,
        files: [
          { ...original.files[0]!, path: "README.md" },
          {
            ...original.files[1]!,
            path: "ACCOUNT.md",
            consumes: [{ name: "Account", from: "README.md" }],
            context: []
          }
        ]
      };

      const result = prepareSlice({ projectRoot, sliceDraft: draft });

      assert.equal(result.status, "review_ready");
      assert.equal(readFileSync(join(projectRoot, "README.md"), "utf8"), "# Account service\n");
      assert.equal(existsSync(join(projectRoot, "ACCOUNT.md")), false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("materializes concurrent unchanged preparation as one logical revision", async () => {
    const projectRoot = createTypeScriptProject();
    try {
      const moduleUrl = new URL("../src/plan-intake.ts", import.meta.url).href;
      const script = `
        import { prepareSlice } from ${JSON.stringify(moduleUrl)};
        const result = prepareSlice({ projectRoot: process.argv[1], sliceDraft: JSON.parse(process.argv[2]) });
        process.stdout.write(JSON.stringify(result));
      `;
      const executions = await Promise.all(
        Array.from({ length: 6 }, () =>
          execFileAsync(process.execPath, [
            "--import",
            "tsx",
            "--input-type=module",
            "--eval",
            script,
            projectRoot,
            JSON.stringify(accountServiceDraft())
          ])
        )
      );
      const results = executions.map(({ stdout }) => JSON.parse(stdout) as PrepareSliceResult);
      assert.ok(results.every((result) => result.status === "review_ready"));
      assert.equal(new Set(results.map((result) => result.status === "review_ready" && result.reviewPath)).size, 1);
      assert.deepEqual(
        ScoreAlpha.listReviewedChangePlans(join(projectRoot, ".score", "score.db")).map(
          (plan) => ({ label: plan.label, revisionCount: plan.revisionCount })
        ),
        [{ label: "Account Service", revisionCount: 1 }]
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("returns a typed finding when Git metadata exists but local exclusion fails", () => {
    const projectRoot = createTypeScriptProject();
    try {
      mkdirSync(join(projectRoot, ".git"));

      const result = prepareSlice({ projectRoot, sliceDraft: accountServiceDraft() });

      assert.equal(result.status, "invalid");
      if (result.status !== "invalid") return;
      assert.ok(result.findings.some((item) => item.code === "GIT_EXCLUDE_UNAVAILABLE"));
      assert.equal(existsSync(join(projectRoot, ".score")), false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("lists several logical slices by human title and exposes only each latest revision", () => {
    const projectRoot = createTypeScriptProject();
    try {
      prepareSlice({ projectRoot, sliceDraft: accountServiceDraft() });
      const revised = accountServiceDraft();
      prepareSlice({
        projectRoot,
        sliceDraft: { ...revised, objective: "Add account status and a labelled summary." }
      });
      const auditDraft = accountServiceDraft();
      prepareSlice({
        projectRoot,
        sliceDraft: {
          ...auditDraft,
          slice_id: "audit-trail",
          title: "Audit Trail",
          objective: "Prepare the same declared files as a separately reviewed slice."
        }
      });

      const plans = ScoreAlpha.listReviewedChangePlans(
        join(projectRoot, ".score", "score.db")
      );

      assert.deepEqual(
        plans.map((plan) => ({ label: plan.label, revision: plan.revision })),
        [
          { label: "Account Service v2", revision: 2 },
          { label: "Audit Trail", revision: 1 }
        ]
      );
      assert.ok(existsSync(join(projectRoot, ".score", "reviews", "account-service-review.html")));
      assert.ok(
        existsSync(join(projectRoot, ".score", "reviews", "account-service-review-v2.html"))
      );
      assert.ok(existsSync(join(projectRoot, ".score", "reviews", "audit-trail-review.html")));
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("returns repairable findings for invalid semantic input without producing a review", () => {
    const cases: ReadonlyArray<{
      readonly name: string;
      readonly mutate: (draft: Record<string, unknown>) => void;
      readonly expectedCode: string;
    }> = [
      {
        name: "declaration description missing",
        mutate: (draft) => {
          const files = draft.files as Array<Record<string, unknown>>;
          const owns = files[0]!.owns as Array<Record<string, unknown>>;
          delete owns[0]!.description;
        },
        expectedCode: "SLICE_REQUIRED_FIELD_MISSING"
      },
      {
        name: "unresolved consumer",
        mutate: (draft) => {
          const files = draft.files as Array<Record<string, unknown>>;
          files[1]!.consumes = [{ name: "MissingAccount", from: "src/schema.ts" }];
        },
        expectedCode: "DECLARATION_CONSUMER_UNRESOLVED"
      },
      {
        name: "SCORE target",
        mutate: (draft) => {
          const files = draft.files as Array<Record<string, unknown>>;
          files[0]!.path = ".score/owned.ts";
        },
        expectedCode: "TARGET_PATH_INVALID"
      },
      {
        name: "absolute target",
        mutate: (draft) => {
          const files = draft.files as Array<Record<string, unknown>>;
          files[0]!.path = "/tmp/schema.ts";
        },
        expectedCode: "TARGET_PATH_INVALID"
      },
      {
        name: "delete operation",
        mutate: (draft) => {
          const files = draft.files as Array<Record<string, unknown>>;
          files[0]!.operation = "delete";
        },
        expectedCode: "SLICE_ENUM"
      },
      {
        name: "missing context",
        mutate: (draft) => {
          const files = draft.files as Array<Record<string, unknown>>;
          files[1]!.context = [{ path: "src/missing.ts", purpose: "Missing example" }];
        },
        expectedCode: "PROJECT_FILE_UNREADABLE"
      },
      {
        name: "create target beneath a file",
        mutate: (draft) => {
          const files = draft.files as Array<Record<string, unknown>>;
          files[1]!.path = "src/schema.ts/account-label.ts";
        },
        expectedCode: "CREATE_TARGET_ANCESTOR_INVALID"
      },
      {
        name: "SCORE context",
        mutate: (draft) => {
          const files = draft.files as Array<Record<string, unknown>>;
          files[1]!.context = [{ path: ".score/score.db", purpose: "Forbidden state" }];
        },
        expectedCode: "CONTEXT_PATH_INVALID"
      },
      {
        name: "missing skill path",
        mutate: (draft) => {
          const files = draft.files as Array<Record<string, unknown>>;
          files[1]!.skills = [{ name: "Missing", path: "skills/missing.md" }];
        },
        expectedCode: "SKILL_UNREADABLE"
      },
      {
        name: "ambiguous skill source",
        mutate: (draft) => {
          const files = draft.files as Array<Record<string, unknown>>;
          files[1]!.skills = [
            {
              name: "Ambiguous",
              path: "skills/type-imports.md",
              content: "Do both."
            }
          ];
        },
        expectedCode: "SKILL_SOURCE_INVALID"
      }
    ];

    for (const testCase of cases) {
      const projectRoot = createTypeScriptProject();
      try {
        const draft = cloneDraft();
        testCase.mutate(draft);
        const result = prepareSlice({ projectRoot, sliceDraft: draft });
        assert.equal(result.status, "invalid", testCase.name);
        if (result.status !== "invalid") continue;
        assert.ok(
          result.findings.some((item) => item.code === testCase.expectedCode),
          `${testCase.name}: ${result.findings.map((item) => item.code).join(", ")}`
        );
        assert.equal(existsSync(join(projectRoot, ".score", "reviews")), false);
      } finally {
        rmSync(projectRoot, { recursive: true, force: true });
      }
    }
  });
});
