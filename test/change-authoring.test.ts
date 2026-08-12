import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, it } from "node:test";

import {
  CHANGE_DRAFT_SCHEMA,
  prepareChange,
  type ChangeDraft
} from "../src/change-authoring.js";
import { prepareSlice } from "../src/plan-intake.js";
import { ScoreAlpha } from "../src/score-alpha.js";
import { SLICE_DRAFT_SCHEMA } from "../src/slice-draft.js";

const requirements = [
  "Account exposes an active or suspended status.",
  "formatAccountLabel returns the account id and status."
] as const;

function writeProjectFile(root: string, path: string, content: string): void {
  const absolutePath = join(root, path);
  mkdirSync(join(absolutePath, ".."), { recursive: true });
  writeFileSync(absolutePath, content, "utf8");
}

function createProject(): string {
  const root = mkdtempSync(join(tmpdir(), "score-change-authoring-"));
  writeProjectFile(root, "package.json", '{"type":"module"}\n');
  writeProjectFile(
    root,
    "tsconfig.json",
    '{"compilerOptions":{"module":"NodeNext","moduleResolution":"NodeNext","target":"ES2024","strict":true,"skipLibCheck":true,"types":[]},"include":["src/**/*.ts"]}\n'
  );
  writeProjectFile(
    root,
    "src/account.ts",
    "export interface Account {\n  id: string;\n}\n"
  );
  writeProjectFile(
    root,
    "src/example.ts",
    'export const exampleAccount = { id: "a-1", status: "active" as const };\n'
  );
  writeProjectFile(
    root,
    "skills/type-imports.md",
    "# Type imports\n\nUse `import type` for type-only dependencies.\n"
  );
  return realpathSync(root);
}

function mixedChangeDraft(): ChangeDraft {
  return {
    title: "Account status",
    objective: "Add account status and a pure account label formatter.",
    requirements: [...requirements],
    files: [
      {
        path: "src/account.ts",
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
        context: [
          {
            path: "src/example.ts",
            purpose: "Show the current Account-shaped example."
          }
        ],
        skills: [
          {
            name: "Schema discipline",
            content: "Preserve existing public members unless explicitly changed."
          }
        ],
        constraints: ["Keep Account exported."]
      },
      {
        path: "src/format-account.ts",
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
        consumes: [{ name: "Account", from: "src/account.ts" }],
        context: [],
        skills: [{ name: "Type imports", path: "skills/type-imports.md" }],
        constraints: ["Return a string without side effects."]
      }
    ]
  };
}

function singleFileChangeDraft(): ChangeDraft {
  return {
    title: "Health check",
    objective: "Create one deterministic health-check function.",
    requirements: ["healthCheck returns ok."],
    files: [
      {
        path: "src/health-check.ts",
        operation: "create",
        task: "Create the health-check function.",
        requirements: ["healthCheck returns ok."],
        owns: [
          {
            name: "healthCheck",
            declaration: 'export function healthCheck(): "ok";',
            description: "Returns the process health marker."
          }
        ],
        consumes: [],
        context: [],
        skills: [],
        constraints: ["Return the literal string ok."]
      }
    ]
  };
}

interface ReviewCapsule {
  readonly target_path: string;
  readonly operation: "create" | "replace";
  readonly objective: string;
  readonly agent_input: {
    readonly target: {
      readonly state_at_base_revision: "absent" | "present";
      readonly content?: string;
    };
    readonly declarations: {
      readonly owned: ReadonlyArray<Record<string, unknown>>;
      readonly consumed: ReadonlyArray<Record<string, unknown>>;
    };
    readonly constraints: ReadonlyArray<string>;
    readonly input_bindings: ReadonlyArray<{
      readonly contract_input: string;
      readonly purpose: string;
      readonly content: unknown;
    }>;
  };
}

function readReviewSnapshot(path: string): {
  readonly manifest: { readonly label: string; readonly objective: string };
  readonly requirements: ReadonlyArray<{ readonly label: string; readonly statement: string }>;
  readonly passes: ReadonlyArray<{ readonly capsules: ReadonlyArray<ReviewCapsule> }>;
} {
  return JSON.parse(readFileSync(path, "utf8")) as ReturnType<typeof readReviewSnapshot>;
}

function assertTypedInvalid(result: unknown): asserts result is {
  readonly status: "invalid";
  readonly changeId?: string;
  readonly findings: ReadonlyArray<{
    readonly code: string;
    readonly location: string;
    readonly message: string;
    readonly detail: Readonly<Record<string, unknown>>;
    readonly machineRepairable: boolean;
  }>;
} {
  assert.equal(typeof result, "object");
  assert.ok(result !== null);
  const candidate = result as { status?: unknown; findings?: unknown };
  assert.equal(candidate.status, "invalid");
  assert.ok(Array.isArray(candidate.findings));
  assert.ok(candidate.findings.length > 0);
  for (const finding of candidate.findings as Array<Record<string, unknown>>) {
    assert.equal(typeof finding.code, "string");
    assert.equal(typeof finding.location, "string");
    assert.equal(typeof finding.message, "string");
    assert.equal(typeof finding.detail, "object");
    assert.equal(typeof finding.machineRepairable, "boolean");
  }
}

describe("Change authoring", () => {
  it("uses the exact same semantic body and File Brief schema as a Slice", () => {
    assert.deepEqual(
      CHANGE_DRAFT_SCHEMA.properties.title,
      SLICE_DRAFT_SCHEMA.properties.title
    );
    assert.deepEqual(
      CHANGE_DRAFT_SCHEMA.properties.objective,
      SLICE_DRAFT_SCHEMA.properties.objective
    );
    assert.deepEqual(
      CHANGE_DRAFT_SCHEMA.properties.requirements,
      SLICE_DRAFT_SCHEMA.properties.requirements
    );
    assert.deepEqual(
      CHANGE_DRAFT_SCHEMA.properties.files,
      SLICE_DRAFT_SCHEMA.properties.files
    );
    assert.equal("slice_id" in CHANGE_DRAFT_SCHEMA.properties, false);
    assert.equal("after" in CHANGE_DRAFT_SCHEMA.properties, false);
  });

  it("creates a generated opaque identity for an initial one-File-Brief Change", () => {
    const projectRoot = createProject();
    try {
      const changeDraft = singleFileChangeDraft();
      assert.equal("change_id" in changeDraft, false);

      const result = prepareChange({ projectRoot, changeDraft });

      assert.equal(result.status, "review_ready");
      if (result.status !== "review_ready") return;
      assert.equal(typeof result.changeId, "string");
      assert.ok(result.changeId.length > 0);
      assert.match(result.changeId, /^chg_[0-9a-f-]{36}$/u);
      assert.notEqual(result.changeId, changeDraft.title);
      assert.notEqual(result.changeId, "health-check");
      assert.equal(result.revision, 1);
      assert.equal(result.humanApprovalRequired, true);
      assert.deepEqual(result.nextAction, {
        command: "score start",
        condition: "after_review"
      });
      assert.deepEqual(result.targets, [
        { path: "src/health-check.ts", operation: "create" }
      ]);
      assert.ok(existsSync(result.reviewPath));
      assert.ok(existsSync(result.snapshotPath));
      assert.match(readFileSync(result.reviewPath, "utf8"), /SCORE Change Review/);
      assert.doesNotMatch(
        readFileSync(result.snapshotPath, "utf8"),
        /reviewKind|nextAction|humanApprovalRequired/
      );
      assert.equal(existsSync(join(projectRoot, "src/health-check.ts")), false);
      assert.equal(existsSync(join(projectRoot, ".score", "runner.db")), false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("prepares coordinated create and modify File Briefs with the exact authored semantics", () => {
    const projectRoot = createProject();
    try {
      const originalAccount = readFileSync(join(projectRoot, "src/account.ts"), "utf8");
      const result = prepareChange({ projectRoot, changeDraft: mixedChangeDraft() });

      assert.equal(result.status, "review_ready");
      if (result.status !== "review_ready") return;
      const snapshot = readReviewSnapshot(result.snapshotPath);
      assert.equal(snapshot.manifest.label, "Account status");
      assert.equal(
        snapshot.manifest.objective,
        "Add account status and a pure account label formatter."
      );
      assert.deepEqual(
        snapshot.requirements.map(({ label, statement }) => ({ label, statement })),
        [
          { label: "R1", statement: requirements[0] },
          { label: "R2", statement: requirements[1] }
        ]
      );

      const capsules = snapshot.passes.flatMap((pass) => pass.capsules);
      assert.equal(capsules.length, 2);
      const account = capsules.find((capsule) => capsule.target_path === "src/account.ts");
      const formatter = capsules.find(
        (capsule) => capsule.target_path === "src/format-account.ts"
      );
      assert.ok(account);
      assert.ok(formatter);
      assert.equal(account.operation, "replace");
      assert.equal(account.objective, "Add the required status field to Account.");
      assert.equal(account.agent_input.target.state_at_base_revision, "present");
      assert.equal(account.agent_input.target.content, originalAccount);
      assert.deepEqual(account.agent_input.declarations.owned[0], {
        name: "Account",
        declaration:
          'export interface Account { id: string; status: "active" | "suspended"; }',
        description: "Represents an account with its current status."
      });
      assert.deepEqual(
        account.agent_input.input_bindings.find(
          (binding) => binding.contract_input === "allocated-requirements"
        )?.content,
        [{ id: "R1", statement: requirements[0] }]
      );
      assert.equal(
        account.agent_input.input_bindings.find(
          (binding) => binding.contract_input === "allocated-requirements"
        )?.purpose,
        "Supply the exact requirements allocated to this File Brief."
      );
      assert.deepEqual(
        account.agent_input.input_bindings.find(
          (binding) => binding.contract_input === "project-context"
        )?.content,
        {
          path: "src/example.ts",
          media_type: "text/typescript; charset=utf-8",
          content: 'export const exampleAccount = { id: "a-1", status: "active" as const };\n'
        }
      );
      assert.equal(
        account.agent_input.input_bindings.find(
          (binding) => binding.contract_input === "selected-skills"
        )?.content,
        "Preserve existing public members unless explicitly changed."
      );
      assert.deepEqual(account.agent_input.constraints, [
        "Keep Account exported.",
        "Produce the complete content of src/account.ts."
      ]);

      assert.equal(formatter.operation, "create");
      assert.equal(formatter.objective, "Create a pure account label formatter.");
      assert.equal(formatter.agent_input.target.state_at_base_revision, "absent");
      assert.deepEqual(formatter.agent_input.declarations.consumed[0], {
        name: "Account",
        declaration:
          'export interface Account { id: string; status: "active" | "suspended"; }',
        description: "Represents an account with its current status."
      });
      assert.equal(
        formatter.agent_input.input_bindings.find(
          (binding) => binding.contract_input === "selected-skills"
        )?.content,
        "# Type imports\n\nUse `import type` for type-only dependencies.\n"
      );
      assert.deepEqual(formatter.agent_input.constraints, [
        "Return a string without side effects.",
        "Produce the complete content of src/format-account.ts."
      ]);

      assert.equal(readFileSync(join(projectRoot, "src/account.ts"), "utf8"), originalAccount);
      assert.equal(existsSync(join(projectRoot, "src/format-account.ts")), false);
      assert.equal(existsSync(join(projectRoot, ".score", "runner.db")), false);
      assert.doesNotMatch(
        readFileSync(result.snapshotPath, "utf8"),
        /slice requirements|declared slice|for this slice/iu
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("refuses to import an absolute path-based skill from outside the project", () => {
    const projectRoot = createProject();
    const externalRoot = mkdtempSync(join(tmpdir(), "score-external-skill-"));
    const externalSkillPath = join(externalRoot, "private-skill.md");
    const privateContent = "PRIVATE_SKILL_CONTENT_MUST_NOT_BE_COPIED";
    try {
      writeFileSync(externalSkillPath, privateContent, "utf8");
      const draft = mixedChangeDraft();
      const changeDraft: ChangeDraft = {
        ...draft,
        files: draft.files.map((file, index) =>
          index === 1
            ? {
                ...file,
                skills: [{ name: "External private skill", path: externalSkillPath }]
              }
            : file
        )
      };

      const result = prepareChange({ projectRoot, changeDraft });

      assertTypedInvalid(result);
      assert.ok(result.findings.some((finding) => finding.code === "SKILL_PATH_INVALID"));
      assert.doesNotMatch(JSON.stringify(result), new RegExp(privateContent, "u"));
      assert.equal(existsSync(join(projectRoot, ".score")), false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(externalRoot, { recursive: true, force: true });
    }
  });

  it("refuses to import a traversal path-based skill from outside the project", () => {
    const projectRoot = createProject();
    const externalRoot = realpathSync(mkdtempSync(join(tmpdir(), "score-external-skill-")));
    const externalSkillPath = join(externalRoot, "private-skill.md");
    const privateContent = "TRAVERSAL_SKILL_CONTENT_MUST_NOT_BE_COPIED";
    try {
      writeFileSync(externalSkillPath, privateContent, "utf8");
      const traversalPath = relative(projectRoot, externalSkillPath);
      assert.match(traversalPath, /^\.\.[/\\]/u);
      const draft = mixedChangeDraft();
      const changeDraft: ChangeDraft = {
        ...draft,
        files: draft.files.map((file, index) =>
          index === 1
            ? {
                ...file,
                skills: [{ name: "Traversed private skill", path: traversalPath }]
              }
            : file
        )
      };

      const result = prepareChange({ projectRoot, changeDraft });

      assertTypedInvalid(result);
      assert.ok(result.findings.some((finding) => finding.code === "SKILL_PATH_INVALID"));
      assert.doesNotMatch(JSON.stringify(result), new RegExp(privateContent, "u"));
      assert.equal(existsSync(join(projectRoot, ".score")), false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(externalRoot, { recursive: true, force: true });
    }
  });

  it("refuses a project-relative skill path that traverses a symlink", () => {
    const projectRoot = createProject();
    const externalRoot = realpathSync(mkdtempSync(join(tmpdir(), "score-external-skill-")));
    const externalSkillPath = join(externalRoot, "private-skill.md");
    const privateContent = "SYMLINKED_SKILL_CONTENT_MUST_NOT_BE_COPIED";
    try {
      writeFileSync(externalSkillPath, privateContent, "utf8");
      symlinkSync(externalRoot, join(projectRoot, "skills", "external"), "dir");
      const draft = mixedChangeDraft();
      const changeDraft: ChangeDraft = {
        ...draft,
        files: draft.files.map((file, index) =>
          index === 1
            ? {
                ...file,
                skills: [
                  {
                    name: "Symlinked private skill",
                    path: "skills/external/private-skill.md"
                  }
                ]
              }
            : file
        )
      };

      const result = prepareChange({ projectRoot, changeDraft });

      assertTypedInvalid(result);
      assert.ok(result.findings.some((finding) => finding.code === "SKILL_PATH_INVALID"));
      assert.doesNotMatch(JSON.stringify(result), new RegExp(privateContent, "u"));
      assert.equal(existsSync(join(projectRoot, ".score")), false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(externalRoot, { recursive: true, force: true });
    }
  });

  it("refuses a path-based skill that is not a regular file", () => {
    const projectRoot = createProject();
    try {
      const draft = mixedChangeDraft();
      const changeDraft: ChangeDraft = {
        ...draft,
        files: draft.files.map((file, index) =>
          index === 1
            ? { ...file, skills: [{ name: "Skill directory", path: "skills" }] }
            : file
        )
      };

      const result = prepareChange({ projectRoot, changeDraft });

      assertTypedInvalid(result);
      assert.ok(
        result.findings.some((finding) => finding.code === "SKILL_FILE_NOT_REGULAR")
      );
      assert.equal(existsSync(join(projectRoot, ".score")), false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("persists an accepted skill locator as project-relative without leaking the project root", () => {
    const projectRoot = createProject();
    try {
      const result = prepareChange({ projectRoot, changeDraft: mixedChangeDraft() });

      assert.equal(result.status, "review_ready");
      if (result.status !== "review_ready") return;
      const snapshot = JSON.parse(readFileSync(result.snapshotPath, "utf8")) as {
        readonly passes: ReadonlyArray<{
          readonly capsules: ReadonlyArray<{
            readonly target_path: string;
            readonly resolved_skills: ReadonlyArray<{
              readonly source: {
                readonly kind: string;
                readonly locator: string;
                readonly version: string;
              };
              readonly content: unknown;
            }>;
            readonly agent_input: unknown;
          }>;
        }>;
      };
      const formatter = snapshot.passes
        .flatMap((pass) => pass.capsules)
        .find((capsule) => capsule.target_path === "src/format-account.ts");
      assert.ok(formatter);
      assert.equal(formatter.resolved_skills[0]?.source.kind, "skill_path");
      assert.equal(formatter.resolved_skills[0]?.source.locator, "skills/type-imports.md");

      const artifacts = [
        { name: "HTML review", bytes: readFileSync(result.reviewPath) },
        { name: "review snapshot", bytes: readFileSync(result.snapshotPath) },
        {
          name: "SCORE database",
          bytes: readFileSync(join(projectRoot, ".score", "score.db"))
        },
        { name: "Agent Input", bytes: Buffer.from(JSON.stringify(formatter.agent_input)) }
      ];
      for (const artifact of artifacts) {
        assert.equal(
          artifact.bytes.includes(projectRoot),
          false,
          `${artifact.name} contains the absolute project root`
        );
      }
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("reuses the same revision and artifact bytes for the same body and Source Snapshot", () => {
    const projectRoot = createProject();
    try {
      const initial = prepareChange({ projectRoot, changeDraft: mixedChangeDraft() });
      assert.equal(initial.status, "review_ready");
      if (initial.status !== "review_ready") return;
      const reviewInode = statSync(initial.reviewPath).ino;
      const snapshotInode = statSync(initial.snapshotPath).ino;

      const repeated = prepareChange({
        projectRoot,
        changeDraft: { ...mixedChangeDraft(), change_id: initial.changeId }
      });

      assert.deepEqual(repeated, initial);
      assert.equal(statSync(initial.reviewPath).ino, reviewInode);
      assert.equal(statSync(initial.snapshotPath).ino, snapshotInode);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("creates v2 for a changed body and preserves the complete v1 artifact pair", () => {
    const projectRoot = createProject();
    try {
      const initial = prepareChange({ projectRoot, changeDraft: mixedChangeDraft() });
      assert.equal(initial.status, "review_ready");
      if (initial.status !== "review_ready") return;
      const v1Html = readFileSync(initial.reviewPath, "utf8");
      const v1Snapshot = readFileSync(initial.snapshotPath, "utf8");
      const draft = mixedChangeDraft();

      const revised = prepareChange({
        projectRoot,
        changeDraft: {
          ...draft,
          change_id: initial.changeId,
          objective: "Add account status and a formatter with revised reviewed wording."
        }
      });

      assert.equal(revised.status, "review_ready");
      if (revised.status !== "review_ready") return;
      assert.equal(revised.changeId, initial.changeId);
      assert.equal(revised.revision, 2);
      assert.notEqual(revised.passId, initial.passId);
      assert.notEqual(revised.reviewPath, initial.reviewPath);
      assert.notEqual(revised.snapshotPath, initial.snapshotPath);
      assert.equal(readFileSync(initial.reviewPath, "utf8"), v1Html);
      assert.equal(readFileSync(initial.snapshotPath, "utf8"), v1Snapshot);
      assert.match(readFileSync(revised.reviewPath, "utf8"), /revised reviewed wording/u);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("creates v2 when declared source changes and leaves that source untouched", () => {
    const projectRoot = createProject();
    try {
      const initial = prepareChange({ projectRoot, changeDraft: mixedChangeDraft() });
      assert.equal(initial.status, "review_ready");
      if (initial.status !== "review_ready") return;
      const v1Html = readFileSync(initial.reviewPath, "utf8");
      const changedSource = "export interface Account {\n  id: string;\n  name: string;\n}\n";
      writeProjectFile(projectRoot, "src/account.ts", changedSource);

      const revised = prepareChange({
        projectRoot,
        changeDraft: { ...mixedChangeDraft(), change_id: initial.changeId }
      });

      assert.equal(revised.status, "review_ready");
      if (revised.status !== "review_ready") return;
      assert.equal(revised.changeId, initial.changeId);
      assert.equal(revised.revision, 2);
      assert.notEqual(revised.passId, initial.passId);
      assert.equal(readFileSync(initial.reviewPath, "utf8"), v1Html);
      assert.ok(existsSync(initial.snapshotPath));
      assert.equal(readFileSync(join(projectRoot, "src/account.ts"), "utf8"), changedSource);
      assert.equal(existsSync(join(projectRoot, ".score", "runner.db")), false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("returns typed invalid findings for an unknown supplied identity and for Slice-only fields", () => {
    const projectRoot = createProject();
    try {
      const unknownIdentity = prepareChange({
        projectRoot,
        changeDraft: { ...mixedChangeDraft(), change_id: `chg_${randomUUID()}` }
      });
      assertTypedInvalid(unknownIdentity);
      assert.equal(unknownIdentity.findings[0]?.code, "CHANGE_ID_UNKNOWN");
      assert.match(JSON.stringify(unknownIdentity), /change_id|changeId/u);
      assert.equal(existsSync(join(projectRoot, ".score", "reviews")), false);

      const sliceOnlyField = prepareChange({
        projectRoot,
        changeDraft: { ...mixedChangeDraft(), after: ["some-slice"] }
      });
      assertTypedInvalid(sliceOnlyField);
      assert.match(JSON.stringify(sliceOnlyField), /after/u);
      assert.equal(existsSync(join(projectRoot, ".score", "reviews")), false);

      const unknownRequirementDraft = mixedChangeDraft();
      const unknownRequirement = prepareChange({
        projectRoot,
        changeDraft: {
          ...unknownRequirementDraft,
          files: unknownRequirementDraft.files.map((file, index) =>
            index === 0
              ? { ...file, requirements: ["A requirement outside the Change."] }
              : file
          )
        }
      });
      assertTypedInvalid(unknownRequirement);
      assert.equal(unknownRequirement.findings[0]?.code, "FILE_REQUIREMENT_UNKNOWN");
      assert.doesNotMatch(unknownRequirement.findings[0]?.message ?? "", /slice/iu);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("never accepts a durable Slice identity as a Change identity", () => {
    const projectRoot = createProject();
    const identity = randomUUID();
    try {
      const sliceBody = mixedChangeDraft();
      const slice = prepareSlice({
        projectRoot,
        sliceDraft: {
          ...sliceBody,
          slice_id: `change-${identity}`,
          title: "Durable account Slice",
          objective: "Prepare durable feature work with a deliberately similar id."
        }
      });
      assert.equal(slice.status, "review_ready");

      const change = prepareChange({
        projectRoot,
        changeDraft: { ...mixedChangeDraft(), change_id: `chg_${identity}` }
      });

      assertTypedInvalid(change);
      assert.equal(change.findings[0]?.code, "CHANGE_ID_UNKNOWN");
      assert.equal(ScoreAlpha.listReviewedChangePlans(join(projectRoot, ".score", "score.db")).length, 1);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("returns a retained generated identity when review publication must be retried", () => {
    const projectRoot = createProject();
    const reviewsDirectory = join(projectRoot, ".score", "reviews");
    const conflictingReviewPath = join(reviewsDirectory, "account-status-review.html");
    try {
      mkdirSync(reviewsDirectory, { recursive: true });
      writeFileSync(conflictingReviewPath, "conflicting review\n", "utf8");

      const interrupted = prepareChange({
        projectRoot,
        changeDraft: mixedChangeDraft()
      });

      assertTypedInvalid(interrupted);
      assert.equal(interrupted.findings[0]?.code, "CHANGE_REVIEW_PUBLICATION_INCOMPLETE");
      const retainedChangeId = interrupted.changeId;
      assert.ok(retainedChangeId);
      assert.match(retainedChangeId, /^chg_[0-9a-f-]{36}$/u);
      assert.equal(
        ScoreAlpha.listReviewedChangePlans(join(projectRoot, ".score", "score.db")).length,
        0
      );

      rmSync(conflictingReviewPath);
      const recovered = prepareChange({
        projectRoot,
        changeDraft: mixedChangeDraft()
      });

      assert.equal(recovered.status, "review_ready");
      if (recovered.status !== "review_ready") return;
      assert.equal(recovered.changeId, retainedChangeId);
      assert.equal(recovered.revision, 1);
      assert.ok(existsSync(recovered.reviewPath));
      assert.equal(
        ScoreAlpha.listReviewedChangePlans(join(projectRoot, ".score", "score.db")).length,
        1
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
