import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import type { ChangeDraft } from "../src/change-authoring.js";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const tsxPath = join(repositoryRoot, "node_modules", ".bin", "tsx");
const cliPath = join(repositoryRoot, "src", "cli.ts");
const usage = "Usage: score change --input -\n";

function writeProjectFile(root: string, path: string, content: string): void {
  const absolutePath = join(root, path);
  mkdirSync(join(absolutePath, ".."), { recursive: true });
  writeFileSync(absolutePath, content, "utf8");
}

function createProject(): string {
  const root = mkdtempSync(join(tmpdir(), "score-change-cli-"));
  writeProjectFile(root, "package.json", '{"type":"module"}\n');
  writeProjectFile(
    root,
    "tsconfig.json",
    '{"compilerOptions":{"module":"NodeNext","moduleResolution":"NodeNext","target":"ES2024","strict":true,"skipLibCheck":true,"types":[]},"include":["src/**/*.ts"]}\n'
  );
  writeProjectFile(root, "src/account.ts", "export interface Account { id: string; }\n");
  return realpathSync(root);
}

function changeDraft(): ChangeDraft {
  return {
    title: "Account status",
    objective: "Add an account status field.",
    requirements: ["Account exposes an active or suspended status."],
    files: [
      {
        path: "src/account.ts",
        operation: "modify",
        task: "Add the required status field to Account.",
        requirements: ["Account exposes an active or suspended status."],
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
        skills: [],
        constraints: ["Keep Account exported."]
      }
    ]
  };
}

function runCli(
  projectRoot: string,
  args: ReadonlyArray<string>,
  input = ""
): ReturnType<typeof spawnSync> & { readonly stdout: string; readonly stderr: string } {
  return spawnSync(tsxPath, [cliPath, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    input,
    timeout: 20_000
  }) as ReturnType<typeof spawnSync> & { readonly stdout: string; readonly stderr: string };
}

function parseCompactJsonLine(stdout: string): Record<string, unknown> {
  assert.match(stdout, /^[^\n]+\n$/u);
  const parsed = JSON.parse(stdout) as unknown;
  assert.equal(typeof parsed, "object");
  assert.ok(parsed !== null);
  assert.equal(stdout, `${JSON.stringify(parsed)}\n`);
  return parsed as Record<string, unknown>;
}

function assertNoRawTerminalControls(value: string): void {
  assert.doesNotMatch(value.slice(0, -1), /[\u0000-\u001f\u007f-\u009f]|\p{Cf}/u);
  assert.equal(value.endsWith("\n"), true);
}

function assertTypedInvalid(stdout: string): Record<string, unknown> {
  const parsed = parseCompactJsonLine(stdout);
  assert.equal(parsed.status, "invalid");
  assert.ok(Array.isArray(parsed.findings));
  assert.ok(parsed.findings.length > 0);
  for (const finding of parsed.findings as Array<Record<string, unknown>>) {
    assert.equal(typeof finding.code, "string");
    assert.equal(typeof finding.location, "string");
    assert.equal(typeof finding.message, "string");
    assert.equal(typeof finding.detail, "object");
    assert.equal(typeof finding.machineRepairable, "boolean");
  }
  return parsed;
}

describe("score change CLI", () => {
  it("exposes version-matched agent and human guidance without project writes", () => {
    const projectRoot = createProject();
    try {
      const authoring = runCli(projectRoot, ["skill"]);
      assert.equal(authoring.status, 0);
      assert.equal(authoring.stderr, "");
      assert.match(authoring.stdout, /^---\nname: score-authoring\n/u);
      assert.match(authoring.stdout, /score change --input -/u);

      const human = runCli(projectRoot, ["skill", "how-to-score"]);
      assert.equal(human.status, 0);
      assert.equal(human.stderr, "");
      assert.match(human.stdout, /^---\nname: how-to-score\n/u);
      assert.match(human.stdout, /Use SCORE to prepare this work/u);

      const path = runCli(projectRoot, ["skill", "--path"]);
      assert.equal(path.status, 0);
      assert.equal(path.stderr, "");
      assert.match(path.stdout, /skills\/score-authoring\/SKILL\.md\n$/u);

      const invalid = runCli(projectRoot, ["skill", "unknown"]);
      assert.equal(invalid.status, 64);
      assert.equal(invalid.stdout, "");
      assert.equal(
        invalid.stderr,
        "Usage: score skill [score-authoring|how-to-score] [--path]\n"
      );
      assert.equal(existsSync(join(projectRoot, ".score")), false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("prepares stdin once and writes one compact success JSON line", () => {
    const projectRoot = createProject();
    try {
      const originalSource = readFileSync(join(projectRoot, "src/account.ts"), "utf8");

      const result = runCli(
        projectRoot,
        ["change", "--input", "-"],
        `${JSON.stringify(changeDraft())}\n`
      );

      assert.equal(result.status, 0);
      assert.equal(result.stderr, "");
      const output = parseCompactJsonLine(result.stdout);
      assert.equal(output.status, "review_ready");
      assert.equal(typeof output.changeId, "string");
      assert.ok((output.changeId as string).length > 0);
      assert.equal(output.revision, 1);
      assert.equal(output.humanApprovalRequired, true);
      assert.deepEqual(output.nextAction, {
        command: "score start",
        condition: "after_review"
      });
      assert.equal(typeof output.reviewPath, "string");
      assert.ok(existsSync(output.reviewPath as string));
      assert.equal(typeof output.snapshotPath, "string");
      assert.ok(existsSync(output.snapshotPath as string));
      assert.equal(readFileSync(join(projectRoot, "src/account.ts"), "utf8"), originalSource);
      assert.equal(existsSync(join(projectRoot, ".score", "runner.db")), false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("escapes terminal controls in JSON stdout without changing parsed Change values", () => {
    const projectRoot = createProject();
    try {
      const maliciousText =
        "Trusted\nFORGED C0\u0000\u001b]2;FORGED OSC\u0007\u009b2JFORGED C1\u202eFORGED BIDI";
      const draft = {
        ...changeDraft(),
        title: maliciousText,
        objective: maliciousText
      };

      const result = runCli(
        projectRoot,
        ["change", "--input", "-"],
        `${JSON.stringify(draft)}\n`
      );

      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, "");
      assertNoRawTerminalControls(result.stdout);
      assert.match(result.stdout, /\\n|\\u000a/u);
      assert.match(result.stdout, /\\u009b/u);
      assert.match(result.stdout, /\\u202e/u);
      const parsed = JSON.parse(result.stdout) as { readonly title: string };
      assert.equal(parsed.title, maliciousText);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("returns typed JSON on stdout with exit 2 for malformed or schema-invalid input", () => {
    const cases: ReadonlyArray<{
      readonly name: string;
      readonly input: string;
      readonly mentionedField?: string;
    }> = [
      { name: "malformed JSON", input: "{\n" },
      {
        name: "empty files",
        input: JSON.stringify({ ...changeDraft(), files: [] })
      },
      {
        name: "Slice-only after",
        input: JSON.stringify({ ...changeDraft(), after: ["foundation"] }),
        mentionedField: "after"
      },
      {
        name: "unknown File Brief field",
        input: JSON.stringify({
          ...changeDraft(),
          files: changeDraft().files.map((file) => ({ ...file, unexpected: true }))
        }),
        mentionedField: "unexpected"
      }
    ];

    for (const testCase of cases) {
      const projectRoot = createProject();
      try {
        const result = runCli(
          projectRoot,
          ["change", "--input", "-"],
          `${testCase.input}\n`
        );

        assert.equal(result.status, 2, testCase.name);
        assert.equal(result.stderr, "", testCase.name);
        const output = assertTypedInvalid(result.stdout);
        if (testCase.mentionedField !== undefined) {
          assert.match(JSON.stringify(output), new RegExp(testCase.mentionedField, "u"));
        }
        assert.equal(existsSync(join(projectRoot, ".score", "reviews")), false);
        assert.equal(existsSync(join(projectRoot, ".score", "runner.db")), false);
      } finally {
        rmSync(projectRoot, { recursive: true, force: true });
      }
    }
  });

  it("rejects an external skill path without copying its file into CLI output or SCORE state", () => {
    const projectRoot = createProject();
    const externalRoot = mkdtempSync(join(tmpdir(), "score-change-cli-private-skill-"));
    const externalSkillPath = join(externalRoot, "private-skill.md");
    const privateContent = "PRIVATE_CLI_SKILL_CONTENT_MUST_NOT_BE_COPIED";
    try {
      writeFileSync(externalSkillPath, privateContent, "utf8");
      const draft = changeDraft();
      const externalSkillDraft: ChangeDraft = {
        ...draft,
        files: draft.files.map((file) => ({
          ...file,
          skills: [{ name: "External private skill", path: externalSkillPath }]
        }))
      };

      const result = runCli(
        projectRoot,
        ["change", "--input", "-"],
        `${JSON.stringify(externalSkillDraft)}\n`
      );

      assert.equal(result.status, 2);
      assert.equal(result.stderr, "");
      const output = assertTypedInvalid(result.stdout);
      assert.ok(
        (output.findings as Array<Record<string, unknown>>).some(
          (finding) => finding.code === "SKILL_PATH_INVALID"
        )
      );
      assert.doesNotMatch(result.stdout, new RegExp(privateContent, "u"));
      assert.equal(existsSync(join(projectRoot, ".score")), false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(externalRoot, { recursive: true, force: true });
    }
  });

  it("rejects duplicate JSON object keys instead of accepting the last value", () => {
    const projectRoot = createProject();
    try {
      const serialized = JSON.stringify(changeDraft());
      const duplicateTitle = `{"title":"shadowed",${serialized.slice(1)}`;

      const result = runCli(
        projectRoot,
        ["change", "--input", "-"],
        `${duplicateTitle}\n`
      );

      assert.equal(result.status, 2);
      assert.equal(result.stderr, "");
      assertTypedInvalid(result.stdout);
      assert.equal(existsSync(join(projectRoot, ".score", "reviews")), false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("returns typed JSON with exit 2 for an unknown supplied Change identity", () => {
    const projectRoot = createProject();
    try {
      const result = runCli(
        projectRoot,
        ["change", "--input", "-"],
        `${JSON.stringify({ ...changeDraft(), change_id: `chg_${randomUUID()}` })}\n`
      );

      assert.equal(result.status, 2);
      assert.equal(result.stderr, "");
      const output = assertTypedInvalid(result.stdout);
      assert.equal(
        (output.findings as Array<Record<string, unknown>>)[0]?.code,
        "CHANGE_ID_UNKNOWN"
      );
      assert.match(JSON.stringify(output), /change_id|changeId/u);
      assert.equal(existsSync(join(projectRoot, ".score", "reviews")), false);
      assert.equal(existsSync(join(projectRoot, ".score", "runner.db")), false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("uses EX_USAGE and stderr for bad arguments", () => {
    const projectRoot = createProject();
    try {
      for (const args of [
        ["change"],
        ["change", "--input", "draft.json"],
        ["change", "--input", "-", "--unexpected"]
      ]) {
        const result = runCli(projectRoot, args);
        assert.equal(result.status, 64, args.join(" "));
        assert.equal(result.stdout, "", args.join(" "));
        assert.equal(result.stderr, usage, args.join(" "));
      }
      assert.equal(existsSync(join(projectRoot, ".score")), false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("prints Change help on stdout with exit 0", () => {
    const projectRoot = createProject();
    try {
      const result = runCli(projectRoot, ["change", "--help"]);

      assert.equal(result.status, 0);
      assert.equal(result.stdout.startsWith(usage), true);
      assert.match(result.stdout, /score change --schema/u);
      assert.match(result.stdout, /does not approve, run, or apply/u);
      assert.match(result.stdout, /omit change_id.*returned changeId.*as change_id/is);
      assert.equal(result.stderr, "");
      assert.equal(existsSync(join(projectRoot, ".score")), false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("prints the authoritative Change schema without preparing anything", () => {
    const projectRoot = createProject();
    try {
      const result = runCli(projectRoot, ["change", "--schema"]);

      assert.equal(result.status, 0);
      assert.equal(result.stderr, "");
      const schema = parseCompactJsonLine(result.stdout);
      assert.equal(schema.$id, "https://score-protocol.local/schema/change-draft-v1.json");
      assert.equal(existsSync(join(projectRoot, ".score")), false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
