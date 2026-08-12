import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  formatDoctorReport,
  runDoctor,
  type DoctorDependencies
} from "../src/doctor.js";
import { DOCTOR_USAGE, runDoctorCli } from "../src/doctor-cli.js";
import {
  inspectScorePackage,
  runDefaultDoctor
} from "../src/doctor-runtime.js";

function readyDependencies(root: string): DoctorDependencies {
  return {
    inspectNode: () => ({ version: "26.5.0", supported: true }),
    inspectPackage: () => ({ version: "1.2.3", resourcesAvailable: true }),
    inspectSqlite: async () => undefined,
    inspectOpenCode: () => ({ version: "0.0.0-next-17111" }),
    inspectAuthentication: () => ({ status: "configured", providerCount: 1 }),
    discoverModels: async () => ({ enabledModelCount: 41, providerCount: 1 }),
    inspectProject: () => ({ projectRoot: root, stateLocationReady: true })
  };
}

describe("score doctor", () => {
  it("reports a ready installation without claiming model execution or project writes", async () => {
    const root = mkdtempSync(join(tmpdir(), "score-doctor-ready-"));
    try {
      const report = await runDoctor({ projectRoot: root }, readyDependencies(root));

      assert.equal(report.status, "ready");
      assert.deepEqual(report.checks.map(({ id, status }) => ({ id, status })), [
        { id: "node", status: "pass" },
        { id: "package", status: "pass" },
        { id: "sqlite", status: "pass" },
        { id: "opencode", status: "pass" },
        { id: "auth", status: "pass" },
        { id: "models", status: "pass" },
        { id: "project", status: "pass" }
      ]);
      assert.deepEqual(report.safety, {
        projectWrites: false,
        persistentScoreWrites: false,
        modelRequests: 0,
        temporaryRuntimeStarted: true,
        networkMayHaveBeenUsed: true
      });
      assert.equal(
        formatDoctorReport(report),
        [
          "SCORE doctor",
          "",
          "Node runtime      ✓ Node 26.5.0 is supported.",
          "SCORE package     ✓ SCORE 1.2.3 and its packaged resources are available.",
          "SQLite runtime    ✓ SCORE databases can initialize in memory.",
          "OpenCode runtime  ✓ OpenCode 0.0.0-next-17111 is available.",
          "Authentication    ✓ OpenCode credential configuration is available.",
          "Model discovery   ✓ 41 enabled models from 1 provider were discovered.",
          "Project           ✓ The current directory is ready for SCORE state.",
          "",
          "SCORE is ready.",
          "No model was run. No project files or persistent SCORE state were written.",
          "Model discovery used an isolated temporary OpenCode runtime and may contact provider services.",
          ""
        ].join("\n")
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns stable sanitized failures and blocks dependent model discovery", async () => {
    const root = mkdtempSync(join(tmpdir(), "score-doctor-failure-"));
    let discoveryCalled = false;
    try {
      const report = await runDoctor(
        { projectRoot: root },
        {
          ...readyDependencies(root),
          inspectOpenCode: () => {
            throw new Error(
              "spawn /private/customer/bin failed with api_key=sk-private-customer-secret"
            );
          },
          discoverModels: async () => {
            discoveryCalled = true;
            throw new Error("must not be reached");
          }
        }
      );

      assert.equal(report.status, "needs_attention");
      assert.equal(discoveryCalled, false);
      assert.deepEqual(report.checks.find(({ id }) => id === "opencode"), {
        id: "opencode",
        label: "OpenCode runtime",
        status: "fail",
        summary: "The pinned OpenCode runtime is unavailable.",
        activity: "local_process",
        code: "OPENCODE_BINARY_UNAVAILABLE",
        repair:
          "Approve and rebuild @opencode-ai/cli for this SCORE installation, then rerun score doctor."
      });
      assert.deepEqual(report.checks.find(({ id }) => id === "models"), {
        id: "models",
        label: "Model discovery",
        status: "blocked",
        summary: "Model discovery was skipped because the OpenCode runtime is unavailable.",
        activity: "isolated_runtime_network",
        code: "MODEL_DISCOVERY_BLOCKED",
        repair: "Repair the OpenCode runtime, then rerun score doctor."
      });
      assert.doesNotMatch(JSON.stringify(report), /private|customer|sk-private|api_key/u);
      assert.equal(report.safety.temporaryRuntimeStarted, false);
      assert.equal(report.safety.networkMayHaveBeenUsed, false);
      const human = formatDoctorReport(report);
      assert.match(human, /Model discovery was skipped; no temporary OpenCode runtime was started\./u);
      assert.doesNotMatch(human, /Model discovery used an isolated temporary OpenCode runtime/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("treats missing authentication as a warning when model discovery succeeds", async () => {
    const root = mkdtempSync(join(tmpdir(), "score-doctor-auth-"));
    try {
      const report = await runDoctor(
        { projectRoot: root },
        {
          ...readyDependencies(root),
          inspectAuthentication: () => ({ status: "missing", providerCount: 0 })
        }
      );

      assert.equal(report.status, "ready_with_warnings");
      assert.deepEqual(report.checks.find(({ id }) => id === "auth"), {
        id: "auth",
        label: "Authentication",
        status: "warning",
        summary: "No OpenCode credential file is configured; models may still be available.",
        activity: "sensitive_local_read",
        code: "OPENCODE_AUTH_NOT_CONFIGURED",
        repair:
          "Configure a provider with opencode2 auth login <provider-url>, then rerun score doctor."
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("runs real package, SQLite, and project diagnostics without persistent SCORE writes", async () => {
    const root = mkdtempSync(join(tmpdir(), "score-doctor-real-"));
    try {
      const report = await runDefaultDoctor({
        projectRoot: root,
        openCodeCommand: join(root, "missing-opencode"),
        openCodeAuthPath: join(root, "missing-auth.json"),
        startTimeoutMs: 500
      });

      assert.equal(report.checks.find(({ id }) => id === "package")?.status, "pass");
      assert.equal(report.checks.find(({ id }) => id === "sqlite")?.status, "pass");
      assert.equal(report.checks.find(({ id }) => id === "opencode")?.status, "fail");
      assert.equal(report.checks.find(({ id }) => id === "models")?.status, "blocked");
      assert.equal(report.checks.find(({ id }) => id === "project")?.status, "pass");
      assert.equal(existsSync(join(root, ".score")), false);
      assert.deepEqual(readdirSync(root), []);
      assert.deepEqual(report.safety, {
        projectWrites: false,
        persistentScoreWrites: false,
        modelRequests: 0,
        temporaryRuntimeStarted: false,
        networkMayHaveBeenUsed: false
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a .score path that is not a directory without writing project state", async () => {
    const root = mkdtempSync(join(tmpdir(), "score-doctor-state-conflict-"));
    writeFileSync(join(root, ".score"), "occupied\n", "utf8");
    try {
      const report = await runDefaultDoctor({
        projectRoot: root,
        openCodeCommand: join(root, "missing-opencode"),
        openCodeAuthPath: join(root, "missing-auth.json"),
        startTimeoutMs: 500
      });

      assert.deepEqual(report.checks.find(({ id }) => id === "project"), {
        id: "project",
        label: "Project",
        status: "fail",
        summary: "The .score state path is not a directory.",
        activity: "inspection",
        code: "PROJECT_STATE_PATH_CONFLICT",
        repair: "Move or remove the .score file, then rerun score doctor."
      });
      assert.equal(readFileSync(join(root, ".score"), "utf8"), "occupied\n");
      assert.deepEqual(readdirSync(root), [".score"]);
      assert.equal(report.safety.persistentScoreWrites, false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("checks an existing score.db path without opening or changing it", async () => {
    const root = mkdtempSync(join(tmpdir(), "score-doctor-existing-state-"));
    const scoreDirectory = join(root, ".score");
    const databasePath = join(scoreDirectory, "score.db");
    mkdirSync(scoreDirectory);
    writeFileSync(databasePath, "existing-state-bytes", "utf8");
    try {
      const report = await runDefaultDoctor({
        projectRoot: root,
        openCodeCommand: join(root, "missing-opencode"),
        openCodeAuthPath: join(root, "missing-auth.json"),
        startTimeoutMs: 500
      });

      assert.equal(report.checks.find(({ id }) => id === "project")?.status, "pass");
      assert.equal(readFileSync(databasePath, "utf8"), "existing-state-bytes");
      assert.deepEqual(readdirSync(scoreDirectory), ["score.db"]);
      assert.equal(report.safety.persistentScoreWrites, false);

      chmodSync(databasePath, 0o400);
      const inaccessible = await runDefaultDoctor({
        projectRoot: root,
        openCodeCommand: join(root, "missing-opencode"),
        openCodeAuthPath: join(root, "missing-auth.json"),
        startTimeoutMs: 500
      });
      assert.deepEqual(inaccessible.checks.find(({ id }) => id === "project"), {
        id: "project",
        label: "Project",
        status: "fail",
        summary: "The existing SCORE database is not readable and writable.",
        activity: "inspection",
        code: "PROJECT_DATABASE_NOT_ACCESSIBLE",
        repair:
          "Grant the current user read and write access to .score/score.db, then rerun score doctor."
      });
      assert.equal(readFileSync(databasePath, "utf8"), "existing-state-bytes");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects an existing score.db path that is not a regular readable and writable file", async () => {
    const root = mkdtempSync(join(tmpdir(), "score-doctor-database-conflict-"));
    const scoreDirectory = join(root, ".score");
    mkdirSync(join(scoreDirectory, "score.db"), { recursive: true });
    try {
      const report = await runDefaultDoctor({
        projectRoot: root,
        openCodeCommand: join(root, "missing-opencode"),
        openCodeAuthPath: join(root, "missing-auth.json"),
        startTimeoutMs: 500
      });

      assert.deepEqual(report.checks.find(({ id }) => id === "project"), {
        id: "project",
        label: "Project",
        status: "fail",
        summary: "The existing SCORE database path is not a regular file.",
        activity: "inspection",
        code: "PROJECT_DATABASE_PATH_CONFLICT",
        repair: "Move or remove .score/score.db, then rerun score doctor."
      });
      assert.deepEqual(readdirSync(scoreDirectory), ["score.db"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("validates supported OpenCode credential record shapes without exposing credentials", async () => {
    const root = mkdtempSync(join(tmpdir(), "score-doctor-auth-shape-"));
    const authPath = join(root, "auth.json");
    const secret = "sk-doctor-must-not-leak";
    writeFileSync(
      authPath,
      JSON.stringify({ provider: { type: "api", key: secret } }),
      "utf8"
    );
    try {
      const valid = await runDefaultDoctor({
        projectRoot: root,
        openCodeCommand: join(root, "missing-opencode"),
        openCodeAuthPath: authPath,
        startTimeoutMs: 500
      });
      assert.equal(valid.checks.find(({ id }) => id === "auth")?.status, "pass");
      assert.doesNotMatch(JSON.stringify(valid), new RegExp(secret, "u"));

      writeFileSync(authPath, JSON.stringify({ provider: { type: "api", key: "" } }), "utf8");
      const emptyKey = await runDefaultDoctor({
        projectRoot: root,
        openCodeCommand: join(root, "missing-opencode"),
        openCodeAuthPath: authPath,
        startTimeoutMs: 500
      });
      assert.equal(emptyKey.checks.find(({ id }) => id === "auth")?.status, "fail");

      writeFileSync(authPath, JSON.stringify({ provider: { garbage: secret } }), "utf8");
      const invalid = await runDefaultDoctor({
        projectRoot: root,
        openCodeCommand: join(root, "missing-opencode"),
        openCodeAuthPath: authPath,
        startTimeoutMs: 500
      });
      assert.deepEqual(invalid.checks.find(({ id }) => id === "auth"), {
        id: "auth",
        label: "Authentication",
        status: "fail",
        summary: "OpenCode credential configuration is invalid.",
        activity: "sensitive_local_read",
        code: "OPENCODE_AUTH_INVALID",
        repair:
          "Repair or replace the OpenCode credential configuration, then rerun score doctor."
      });
      assert.doesNotMatch(JSON.stringify(invalid), new RegExp(secret, "u"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("requires every packaged migration and keeps package and SQLite failures distinct", async () => {
    const root = mkdtempSync(join(tmpdir(), "score-doctor-package-"));
    mkdirSync(join(root, "migrations"));
    mkdirSync(join(root, "schema"));
    mkdirSync(join(root, "skills", "score-authoring"), { recursive: true });
    mkdirSync(join(root, "skills", "how-to-score"), { recursive: true });
    writeFileSync(join(root, "package.json"), JSON.stringify({ version: "1.2.3" }), "utf8");
    for (const resource of [
      "001_initial.sql",
      "002_declaration_registry.sql",
      "003_declaration_registry_view.sql",
      "005_plan_intake_revisions.sql",
      "006_prepared_slice_publications.sql",
      "007_slice_identity_dependencies.sql"
    ]) {
      writeFileSync(join(root, "migrations", resource), "-- fixture\n", "utf8");
    }
    writeFileSync(join(root, "schema", "compilation-bundle.schema.json"), "{}\n", "utf8");
    writeFileSync(join(root, "skills", "score-authoring", "SKILL.md"), "fixture\n", "utf8");
    writeFileSync(join(root, "skills", "how-to-score", "SKILL.md"), "fixture\n", "utf8");
    writeFileSync(join(root, "CONTEXT.md"), "fixture\n", "utf8");
    try {
      assert.deepEqual(inspectScorePackage(root), {
        version: "1.2.3",
        resourcesAvailable: false
      });

      mkdirSync(join(root, "migrations", "004_repository_project_settings.sql"));
      assert.deepEqual(inspectScorePackage(root), {
        version: "1.2.3",
        resourcesAvailable: false
      });
      rmSync(join(root, "migrations", "004_repository_project_settings.sql"), {
        recursive: true
      });
      writeFileSync(
        join(root, "migrations", "004_repository_project_settings.sql"),
        "-- fixture\n",
        "utf8"
      );
      assert.deepEqual(inspectScorePackage(root), {
        version: "1.2.3",
        resourcesAvailable: true
      });
      rmSync(join(root, "migrations", "004_repository_project_settings.sql"));

      const report = await runDoctor(
        { projectRoot: root },
        {
          ...readyDependencies(root),
          inspectPackage: () => inspectScorePackage(root),
          inspectSqlite: async () => {
            throw new Error("native load failed at /private/path");
          }
        }
      );
      assert.deepEqual(report.checks.find(({ id }) => id === "package"), {
        id: "package",
        label: "SCORE package",
        status: "fail",
        summary: "Required SCORE package resources are missing.",
        activity: "inspection",
        code: "PACKAGE_RESOURCE_MISSING",
        repair: "Reinstall SCORE from a complete package, then rerun score doctor."
      });
      assert.deepEqual(report.checks.find(({ id }) => id === "sqlite"), {
        id: "sqlite",
        label: "SQLite runtime",
        status: "fail",
        summary: "The SQLite runtime could not initialize SCORE databases in memory.",
        activity: "in_memory",
        code: "SQLITE_NATIVE_UNAVAILABLE",
        repair:
          "Approve and rebuild better-sqlite3 for this SCORE installation, then rerun score doctor."
      });
      assert.doesNotMatch(JSON.stringify(report), /private\/path/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("discovers models through the isolated runtime without creating a model session", async () => {
    const root = mkdtempSync(join(tmpdir(), "score-doctor-catalog-"));
    const command = join(root, "fake-opencode2");
    const capture = join(root, "capture.json");
    writeFileSync(
      command,
      `#!/usr/bin/env node
const fs = require("node:fs");
const http = require("node:http");
if (process.argv[2] === "--version") {
  process.stdout.write("opencode2 v0.0.0-next-17111\\n");
  process.exit(0);
}
const capture = ${JSON.stringify(capture)};
const requests = [];
const password = "doctor-fixture-password";
const authorization = "Basic " + Buffer.from("opencode:" + password).toString("base64");
const persist = () => fs.writeFileSync(capture, JSON.stringify(requests));
const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  requests.push({ method: request.method, pathname: url.pathname });
  persist();
  response.setHeader("content-type", "application/json");
  if (request.headers.authorization !== authorization) {
    response.statusCode = 401;
    response.end(JSON.stringify({ message: "unauthorized" }));
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/provider") {
    response.end(JSON.stringify({ data: [{ id: "fixture", name: "Fixture" }] }));
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/model") {
    response.end(JSON.stringify({ data: [{ id: "model", providerID: "fixture", name: "Model", enabled: true, variants: [] }] }));
    return;
  }
  response.statusCode = 404;
  response.end(JSON.stringify({ message: "not found" }));
});
process.on("SIGTERM", () => server.close(() => process.exit(0)));
server.listen(0, "127.0.0.1", () => {
  persist();
  const address = server.address();
  process.stdout.write("server listening on http://127.0.0.1:" + address.port + "\\n");
  process.stdout.write("server password " + password + "\\n");
});
`,
      "utf8"
    );
    chmodSync(command, 0o755);
    try {
      const report = await runDefaultDoctor({
        projectRoot: root,
        openCodeCommand: command,
        openCodeAuthPath: join(root, "missing-auth.json"),
        startTimeoutMs: 2_000
      });

      assert.equal(report.checks.find(({ id }) => id === "models")?.status, "pass");
      const requests = JSON.parse(readFileSync(capture, "utf8")) as Array<{
        readonly method: string;
        readonly pathname: string;
      }>;
      assert.deepEqual(
        requests.map(({ method, pathname }) => ({ method, pathname })).toSorted(
          (left, right) => left.pathname.localeCompare(right.pathname)
        ),
        [
          { method: "GET", pathname: "/api/model" },
          { method: "GET", pathname: "/api/provider" }
        ]
      );
      assert.ok(requests.every(({ pathname }) => !pathname.startsWith("/api/session")));
      assert.equal(report.safety.modelRequests, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("exposes only the public doctor and --json CLI surface", () => {
    const root = mkdtempSync(join(tmpdir(), "score-doctor-cli-"));
    const projectRoot = join(root, "project");
    mkdirSync(projectRoot);
    try {
      const help = spawnSync(
        join(process.cwd(), "node_modules", ".bin", "tsx"),
        [join(process.cwd(), "src", "cli.ts"), "doctor", "--help"],
        { cwd: projectRoot, encoding: "utf8", timeout: 10_000 }
      );
      assert.equal(help.status, 0);
      assert.equal(help.stdout, DOCTOR_USAGE);
      assert.doesNotMatch(help.stdout, /opencode|timeout|auth|provider/u);

      const rejected = spawnSync(
        join(process.cwd(), "node_modules", ".bin", "tsx"),
        [join(process.cwd(), "src", "cli.ts"), "doctor", "--opencode-command", "fixture"],
        { cwd: projectRoot, encoding: "utf8", timeout: 10_000 }
      );
      assert.equal(rejected.status, 64);
      assert.equal(rejected.stdout, "");
      assert.equal(rejected.stderr, DOCTOR_USAGE);
      assert.equal(existsSync(join(projectRoot, ".score")), false);
      assert.deepEqual(readdirSync(projectRoot), []);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("formats one compact JSON report through internal CLI injection", async () => {
    const root = mkdtempSync(join(tmpdir(), "score-doctor-cli-json-"));
    let stdout = "";
    let stderr = "";
    try {
      const report = await runDoctor(
        { projectRoot: root },
        {
          ...readyDependencies(root),
          inspectOpenCode: () => {
            throw new Error("fixture unavailable");
          }
        }
      );
      const exitCode = await runDoctorCli(["--json"], {
        runDoctor: async () => report,
        writeStdout: (value) => {
          stdout += value;
        },
        writeStderr: (value) => {
          stderr += value;
        }
      });

      assert.equal(exitCode, 1);
      assert.equal(stderr, "");
      assert.match(stdout, /^[^\n]+\n$/u);
      assert.equal((JSON.parse(stdout) as { schemaVersion: number }).schemaVersion, 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("escapes terminal controls in doctor JSON without changing parsed report values", async () => {
    const maliciousSummary = "Ready\u009b2J\u202eFORGED";
    const report = {
      schemaVersion: 1,
      status: "ready",
      checks: [
        {
          id: "node",
          label: "Node runtime",
          status: "pass",
          summary: maliciousSummary,
          activity: "inspection"
        }
      ],
      safety: {
        projectWrites: false,
        persistentScoreWrites: false,
        modelRequests: 0,
        temporaryRuntimeStarted: false,
        networkMayHaveBeenUsed: false
      }
    } as const;
    let stdout = "";

    const exitCode = await runDoctorCli(["--json"], {
      runDoctor: async () => report,
      writeStdout: (value) => {
        stdout += value;
      },
      writeStderr: () => undefined
    });

    assert.equal(exitCode, 0);
    assert.doesNotMatch(stdout.slice(0, -1), /[\u007f-\u009f]|\p{Cf}/u);
    assert.match(stdout, /\\u009b/u);
    assert.match(stdout, /\\u202e/u);
    const parsed = JSON.parse(stdout) as typeof report;
    assert.equal(parsed.checks[0]?.summary, maliciousSummary);
  });
});
