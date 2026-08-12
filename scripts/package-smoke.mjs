import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = mkdtempSync(join(tmpdir(), "score-package-smoke-"));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    ...options
  });

  assert.equal(
    result.status,
    0,
    [
      `${command} ${args.join(" ")} failed with exit code ${result.status ?? "unknown"}.`,
      result.stdout,
      result.stderr,
      result.error?.stack
    ]
      .filter(Boolean)
      .join("\n")
  );

  return result;
}

function assertIncluded(packageRoot, relativePath) {
  assert.ok(
    existsSync(join(packageRoot, relativePath)),
    `Packed package is missing ${relativePath}.`
  );
}

function assertExcluded(packageRoot, relativePath) {
  assert.equal(
    existsSync(join(packageRoot, relativePath)),
    false,
    `Packed package must not contain ${relativePath}.`
  );
}

function packageFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  visit(root);
  return files;
}

function assertNoPrivatePublicationData(root) {
  const patterns = [
    /\/Users\/[A-Za-z0-9._-]+\//u,
    /\/home\/[A-Za-z0-9._-]+\//u,
    /[A-Za-z]:\\Users\\[^\\\r\n]+\\/u,
    /\b[A-Za-z0-9._%+-]+@gmail\.com\b/iu,
    /\bses_[A-Za-z0-9_-]{16,}\b/u
  ];
  const findings = [];
  for (const path of packageFiles(root)) {
    const content = readFileSync(path);
    if (content.includes(0)) continue;
    const text = content.toString("utf8");
    if (patterns.some((pattern) => pattern.test(text))) {
      findings.push(path.slice(root.length + 1));
    }
  }
  assert.deepEqual(findings, [], "Packed package contains private publication data.");
}

try {
  const packageManifest = JSON.parse(
    readFileSync(join(repositoryRoot, "package.json"), "utf8")
  );
  const packDirectory = join(temporaryRoot, "pack");
  const projectDirectory = join(temporaryRoot, "consumer");
  mkdirSync(packDirectory);
  mkdirSync(projectDirectory);

  run(
    "npm",
    ["pack", "--silent", "--pack-destination", packDirectory],
    { cwd: repositoryRoot }
  );

  const archives = readdirSync(packDirectory).filter((name) => name.endsWith(".tgz"));
  assert.equal(archives.length, 1, "npm pack must produce exactly one archive.");
  const archivePath = join(packDirectory, archives[0]);

  writeFileSync(
    join(projectDirectory, "package.json"),
    `${JSON.stringify({ name: "score-package-consumer", private: true }, null, 2)}\n`,
    "utf8"
  );
  run(
    "npm",
    ["install", "--no-audit", "--no-fund", "--loglevel=error", archivePath],
    { cwd: projectDirectory }
  );

  const packageRoot = join(
    projectDirectory,
    "node_modules",
    ...packageManifest.name.split("/")
  );
  assertIncluded(packageRoot, "dist/cli.js");
  for (const migration of readdirSync(join(repositoryRoot, "migrations"))) {
    if (migration.endsWith(".sql")) {
      assertIncluded(packageRoot, join("migrations", migration));
    }
  }
  assertIncluded(packageRoot, "schema/compilation-bundle.schema.json");
  assertIncluded(packageRoot, "skills/score-authoring/SKILL.md");
  assertIncluded(packageRoot, "skills/how-to-score/SKILL.md");
  assertIncluded(packageRoot, "README.md");
  assertIncluded(packageRoot, "CONTEXT.md");
  assertIncluded(packageRoot, "LICENSE");
  assertExcluded(packageRoot, "src");
  assertExcluded(packageRoot, "test");
  assertExcluded(packageRoot, "examples");
  assertExcluded(packageRoot, "dist/src");
  assertNoPrivatePublicationData(packageRoot);

  const help = run(join(projectDirectory, "node_modules", ".bin", "score"), ["--help"], {
    cwd: projectDirectory
  });
  assert.match(help.stdout, /score/i, "score --help must identify the CLI.");

  const authoringSkill = run(
    join(projectDirectory, "node_modules", ".bin", "score"),
    ["skill"],
    { cwd: projectDirectory }
  );
  assert.match(authoringSkill.stdout, /^---\nname: score-authoring\n/u);
  assert.match(authoringSkill.stdout, /score change --input -/u);
  const humanSkill = run(
    join(projectDirectory, "node_modules", ".bin", "score"),
    ["skill", "how-to-score"],
    { cwd: projectDirectory }
  );
  assert.match(humanSkill.stdout, /^---\nname: how-to-score\n/u);
  assert.match(humanSkill.stdout, /Use SCORE to prepare this work/u);
  const skillPath = run(
    join(projectDirectory, "node_modules", ".bin", "score"),
    ["skill", "--path"],
    { cwd: projectDirectory }
  ).stdout.trim();
  assert.equal(
    realpathSync(skillPath),
    realpathSync(join(packageRoot, "skills", "score-authoring", "SKILL.md"))
  );

  const score = join(projectDirectory, "node_modules", ".bin", "score");
  const doctorHelp = run(score, ["doctor", "--help"], { cwd: projectDirectory });
  assert.equal(doctorHelp.stdout, "Usage: score doctor [--json]\n");
  assert.doesNotMatch(doctorHelp.stdout, /opencode|timeout|auth|provider/u);
  const rejectedDoctorOption = spawnSync(
    score,
    ["doctor", "--opencode-command", "fixture"],
    { cwd: projectDirectory, encoding: "utf8" }
  );
  assert.equal(rejectedDoctorOption.status, 64);
  assert.equal(rejectedDoctorOption.stdout, "");
  assert.equal(rejectedDoctorOption.stderr, doctorHelp.stdout);

  const { runDoctorCli } = await import(
    pathToFileURL(join(packageRoot, "dist", "doctor-cli.js")).href
  );
  let doctorStdout = "";
  let doctorStderr = "";
  const doctorExit = await runDoctorCli(["--json"], {
    runDoctor: async () => ({
      schemaVersion: 1,
      status: "needs_attention",
      checks: [],
      safety: {
        projectWrites: false,
        persistentScoreWrites: false,
        modelRequests: 0,
        temporaryRuntimeStarted: false,
        networkMayHaveBeenUsed: false
      }
    }),
    writeStdout: (value) => {
      doctorStdout += value;
    },
    writeStderr: (value) => {
      doctorStderr += value;
    }
  });
  assert.equal(doctorExit, 1);
  assert.equal(doctorStderr, "");
  assert.match(doctorStdout, /^[^\n]+\n$/u);
  const doctorReport = JSON.parse(doctorStdout);
  assert.equal(doctorReport.schemaVersion, 1);
  assert.equal(doctorReport.status, "needs_attention");
  assert.equal(doctorReport.safety.modelRequests, 0);
  assert.equal(doctorReport.safety.persistentScoreWrites, false);
  assert.equal(existsSync(join(projectDirectory, ".score")), false);

  mkdirSync(join(projectDirectory, "src"));
  const originalTarget = "export interface Account { id: string; }\n";
  writeFileSync(join(projectDirectory, "src", "account.ts"), originalTarget, "utf8");
  const change = {
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
  const first = run(score, ["change", "--input", "-"], {
    cwd: projectDirectory,
    input: `${JSON.stringify(change)}\n`
  });
  const firstResult = JSON.parse(first.stdout);
  assert.equal(firstResult.status, "review_ready");
  assert.equal(firstResult.revision, 1);
  assert.equal(firstResult.humanApprovalRequired, true);
  assert.deepEqual(firstResult.nextAction, {
    command: "score start",
    condition: "after_review"
  });
  assert.equal(typeof firstResult.changeId, "string");
  assert.ok(existsSync(firstResult.reviewPath));
  const projectRootBytes = Buffer.from(projectDirectory, "utf8");
  assert.equal(readFileSync(firstResult.reviewPath).includes(projectRootBytes), false);
  assert.equal(readFileSync(firstResult.snapshotPath).includes(projectRootBytes), false);
  assert.equal(
    readFileSync(join(projectDirectory, ".score", "score.db")).includes(projectRootBytes),
    false
  );
  assert.equal(readFileSync(join(projectDirectory, "src", "account.ts"), "utf8"), originalTarget);
  assert.equal(existsSync(join(projectDirectory, ".score", "runner.db")), false);

  const revised = {
    ...change,
    change_id: firstResult.changeId,
    objective: "Add and document an account status field."
  };
  const second = run(score, ["change", "--input", "-"], {
    cwd: projectDirectory,
    input: `${JSON.stringify(revised)}\n`
  });
  const secondResult = JSON.parse(second.stdout);
  assert.equal(secondResult.status, "review_ready");
  assert.equal(secondResult.changeId, firstResult.changeId);
  assert.equal(secondResult.revision, 2);
  assert.notEqual(secondResult.reviewPath, firstResult.reviewPath);
  assert.ok(existsSync(firstResult.reviewPath));
  assert.ok(existsSync(secondResult.reviewPath));

  const listed = run(
    score,
    [
      "list",
      "--score-db",
      ".score/score.db",
      "--runner-db",
      ".score/runner.db"
    ],
    { cwd: projectDirectory }
  );
  assert.match(listed.stdout, /Account status v2/u);
  assert.doesNotMatch(listed.stdout, /Account status v1/u);

  process.stdout.write("Package smoke test passed.\n");
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
