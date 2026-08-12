import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";

import { Effect } from "effect";

import { formatRunApplicationSummary } from "../src/runner/application-summary.js";
import { runWithRunProgress } from "../src/runner/guided-start-cli.js";
import { AttemptId, JobId, RunId, type RunSnapshot } from "../src/runner/domain.js";
import { resolveNonInteractiveOpenCodeConfiguration } from "../src/runner/open-code-selection.js";
import type { RuntimeAdapterCatalog, RuntimeModel } from "../src/runner/runtime-adapter-catalog.js";
import type { AdapterConfiguration } from "../src/runner/domain.js";
import { optionValue } from "../src/runner/cli-options.js";
import { safeRunnerCliErrorMessage } from "../src/runner/diagnostic-sanitization.js";
import { defaultRunnerDatabasePath } from "../src/runner/runner-paths.js";

const completedRun: RunSnapshot = {
  runId: RunId.make("00000000-0000-4000-8000-000000000001"),
  passId: "pass-1",
  state: "completed",
  repositoryRoot: "/workspace/project",
  sourceSnapshotId: "snapshot-1",
  sourceSnapshotDigest: "digest-1",
  applicationState: "applied",
  appliedAt: "2026-08-08T00:00:00.000Z",
  acceptedMissingReplacementPaths: [],
  confirmedTargets: [],
  adapter: {
    kind: "opencode",
    providerId: "provider",
    modelId: "model",
    variantId: null,
    sdkVersion: "sdk",
    cliVersion: "cli"
  },
  maxConcurrency: 5,
  jobs: [
    {
      jobId: JobId.make("00000000-0000-4000-8000-000000000002"),
      ordinal: 1,
      targetPath: "src/one.ts",
      operation: "create",
      state: "succeeded",
      packageDigest: "package-1"
    },
    {
      jobId: JobId.make("00000000-0000-4000-8000-000000000003"),
      ordinal: 2,
      targetPath: "src/two.ts",
      operation: "create",
      state: "succeeded",
      packageDigest: "package-2"
    }
  ],
  observation: {
    runId: RunId.make("00000000-0000-4000-8000-000000000001"),
    providerId: "provider",
    modelId: "model",
    variantId: null,
    runtimeVersion: { sdkVersion: "sdk", cliVersion: "cli" },
    createdAt: "2026-08-08T00:00:00.000Z",
    lastObservedAt: "2026-08-08T00:00:04.000Z",
    terminalAt: "2026-08-08T00:00:04.000Z",
    sequence: 8,
    phase: "applied",
    failureCategory: null,
    failureMessage: null,
    application: {
      state: "applied",
      appliedAt: "2026-08-08T00:00:04.000Z",
      filesApplied: true
    },
    files: [
      {
        runId: RunId.make("00000000-0000-4000-8000-000000000001"),
        jobId: JobId.make("00000000-0000-4000-8000-000000000002"),
        attemptId: AttemptId.make("00000000-0000-4000-8000-000000000004"),
        targetPath: "src/one.ts",
        operation: "create",
        agentInputDigest: "package-1",
        stage: "succeeded",
        source: "runner",
        observedAt: "2026-08-08T00:00:03.000Z",
        claimedAt: "2026-08-08T00:00:01.000Z",
        terminalAt: "2026-08-08T00:00:03.000Z",
        sequence: 4,
        runtimeSessionId: "session-one",
        failureCategory: null,
        failureMessage: null,
        failureStage: null,
        terminalOutcome: {
          kind: "provider",
          status: "completed",
          statusCode: null,
          name: null
        },
        targetOutputState: "present",
        rejectedOutputDigest: null,
        rejectedOutputPath: null
      },
      {
        runId: RunId.make("00000000-0000-4000-8000-000000000001"),
        jobId: JobId.make("00000000-0000-4000-8000-000000000003"),
        attemptId: AttemptId.make("00000000-0000-4000-8000-000000000005"),
        targetPath: "src/two.ts",
        operation: "create",
        agentInputDigest: "package-2",
        stage: "succeeded",
        source: "runner",
        observedAt: "2026-08-08T00:00:04.000Z",
        claimedAt: "2026-08-08T00:00:02.000Z",
        terminalAt: "2026-08-08T00:00:04.000Z",
        sequence: 8,
        runtimeSessionId: "session-two",
        failureCategory: null,
        failureMessage: null,
        failureStage: null,
        terminalOutcome: {
          kind: "provider",
          status: "completed",
          statusCode: null,
          name: null
        },
        targetOutputState: "present",
        rejectedOutputDigest: null,
        rejectedOutputPath: null
      }
    ]
  }
};

describe("noninteractive Runner application output", () => {
  it("shares live observations with the CLI renderer and closes it after success", async () => {
    const output: string[] = [];
    let clears = 0;

    const result = await runWithRunProgress({
      header: {
        modelLabel: "model",
        providerLabel: "provider"
      },
      progress: {
        now: () => Date.parse("2026-08-08T00:00:04.000Z"),
        schedule: () => ({
          clear: () => {
            clears += 1;
          }
        }),
        terminal: {
          mode: "append",
          write: (text) => output.push(text)
        }
      },
      execute: async (observer) => {
        observer.update(completedRun.observation);
        return completedRun;
      }
    });

    assert.equal(result, completedRun);
    assert.match(output.join(""), /Running\nprovider · model · Run 00000000/u);
    assert.match(output.join(""), /^src\/one\.ts\s+✓ succeeded\s+00:02$/mu);
    assert.equal(clears, 1);
  });

  it("closes the CLI renderer when Run execution fails", async () => {
    let clears = 0;

    await assert.rejects(
      runWithRunProgress({
        header: {
          modelLabel: "model",
          providerLabel: "provider"
        },
        progress: {
          now: () => Date.parse("2026-08-08T00:00:04.000Z"),
          schedule: () => ({
            clear: () => {
              clears += 1;
            }
          }),
          terminal: {
            mode: "append",
            write: () => undefined
          }
        },
        execute: async (observer) => {
          observer.update(completedRun.observation);
          throw new Error("synthetic Run failure");
        }
      }),
      /synthetic Run failure/u
    );

    assert.equal(clears, 1);
  });

  it("still executes when progress renderer construction fails", async () => {
    let executed = false;
    const progress = Object.defineProperty({}, "terminal", {
      get: () => {
        throw new Error("synthetic renderer construction failure");
      }
    }) as NonNullable<Parameters<typeof runWithRunProgress>[0]["progress"]>;

    const result = await runWithRunProgress({
      header: { modelLabel: "model", providerLabel: "provider" },
      progress,
      execute: async () => {
        executed = true;
        return completedRun;
      }
    });

    assert.equal(executed, true);
    assert.equal(result, completedRun);
  });

  it("reports atomic delivery without introducing project verification", () => {
    assert.equal(
      formatRunApplicationSummary(completedRun),
      "\nAll 2 candidates were generated and applied to /workspace/project.\n"
    );
  });

  it("renders the applied repository as one bounded terminal-safe line", () => {
    const rendered = formatRunApplicationSummary({
      ...completedRun,
      repositoryRoot:
        "/workspace/Trusted\nFORGED C0\u0000\u001b]2;FORGED OSC\u0007\u009b2JFORGED C1\u202eFORGED BIDI"
    });

    assert.equal(
      rendered,
      "\nAll 2 candidates were generated and applied to /workspace/Trusted FORGED C0 FORGED C1 FORGED BIDI.\n"
    );
    assert.equal(rendered.split("\n").length, 3);
    assert.doesNotMatch(rendered, /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]|\p{Cf}/u);
    assert.doesNotMatch(rendered, /FORGED OSC/u);
  });

  it("does not claim delivery for an unsuccessful Run", () => {
    assert.equal(
      formatRunApplicationSummary({
        ...completedRun,
        state: "completed_with_failures",
        applicationState: "not_applied",
        appliedAt: null
      }),
      "\nNo files were applied because the Run did not complete successfully.\n"
    );
  });
});

describe("noninteractive OpenCode model selection", () => {
  const model: RuntimeModel = {
    key: "opencode/gpt-5.4",
    label: "GPT-5.4",
    sourceLabel: "OpenCode Zen",
    variants: [
      { id: "low", label: "Low", summaryLabel: "Low reasoning" },
      { id: "fast", label: "Fast", summaryLabel: "Fast reasoning" }
    ]
  };

  function catalog(discoveries: string[]): RuntimeAdapterCatalog<AdapterConfiguration> {
    return {
      id: "opencode",
      label: "OpenCode",
      discoverModels: Effect.sync(() => {
        discoveries.push("discover");
        return [model];
      }),
      configurationFor: (selected, variantId) => ({
        kind: "opencode",
        providerId: selected.key.split("/")[0]!,
        modelId: selected.key.split("/")[1]!,
        variantId: variantId ?? null,
        sdkVersion: "0.0.0-next-17111",
        cliVersion: "0.0.0-next-17111"
      })
    };
  }

  it("omits a variant without discovering or inventing an adapter default", async () => {
    const discoveries: string[] = [];
    const selection = await resolveNonInteractiveOpenCodeConfiguration({
      adapterCatalog: catalog(discoveries),
      providerId: "opencode",
      modelId: "gpt-5.4"
    });

    assert.equal(selection.configuration.variantId, null);
    assert.equal(selection.variant, null);
    assert.deepEqual(discoveries, []);
  });

  it("validates and preserves an opaque explicit variant", async () => {
    const discoveries: string[] = [];
    const selection = await resolveNonInteractiveOpenCodeConfiguration({
      adapterCatalog: catalog(discoveries),
      providerId: "opencode",
      modelId: "gpt-5.4",
      variantId: "fast"
    });

    assert.equal(selection.configuration.variantId, "fast");
    assert.deepEqual(selection.variant, model.variants[1]);
    assert.deepEqual(discoveries, ["discover"]);
  });

  it("rejects an unadvertised explicit variant before configuration is returned", async () => {
    const discoveries: string[] = [];
    await assert.rejects(
      resolveNonInteractiveOpenCodeConfiguration({
        adapterCatalog: catalog(discoveries),
        providerId: "opencode",
        modelId: "gpt-5.4",
        variantId: "turbo"
      }),
      /GPT-5.4 does not advertise variant turbo/
    );
    assert.deepEqual(discoveries, ["discover"]);
  });
});

describe("Runner CLI options", () => {
  it("refuses an explicit Runner database symlink without changing its target", () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-cli-db-symlink-"));
    const outsidePath = join(directory, "outside.db");
    const runnerDatabasePath = join(directory, "runner.db");
    writeFileSync(outsidePath, "outside bytes\n", "utf8");
    symlinkSync(outsidePath, runnerDatabasePath, "file");
    try {
      const result = spawnSync(
        join(process.cwd(), "node_modules", ".bin", "tsx"),
        ["src/cli.ts", "counts", "--runner-db", runnerDatabasePath],
        { cwd: process.cwd(), encoding: "utf8", timeout: 10_000 }
      );

      assert.equal(result.status, 1);
      assert.match(result.stderr, /Runner database.*symbolic link/i);
      assert.equal(readFileSync(outsidePath, "utf8"), "outside bytes\n");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("refuses an explicit Runner database parent symlink", () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-cli-parent-symlink-"));
    const outsideDirectory = mkdtempSync(join(tmpdir(), "score-runner-cli-outside-"));
    const linkedParent = join(directory, "state");
    symlinkSync(outsideDirectory, linkedParent, "dir");
    try {
      const result = spawnSync(
        join(process.cwd(), "node_modules", ".bin", "tsx"),
        ["src/cli.ts", "counts", "--runner-db", join(linkedParent, "runner.db")],
        { cwd: process.cwd(), encoding: "utf8", timeout: 10_000 }
      );

      assert.equal(result.status, 1);
      assert.match(result.stderr, /Runner database parent.*symbolic link/i);
      assert.equal(existsSync(join(outsideDirectory, "runner.db")), false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
      rmSync(outsideDirectory, { recursive: true, force: true });
    }
  });

  it("refuses a symlink in an explicit Runner database parent chain", () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-cli-ancestor-symlink-"));
    const outsideDirectory = mkdtempSync(join(tmpdir(), "score-runner-cli-ancestor-outside-"));
    const linkedAncestor = join(directory, "redirect");
    const outsidePrivateDirectory = join(outsideDirectory, "private");
    mkdirSync(outsidePrivateDirectory, { mode: 0o700 });
    symlinkSync(outsideDirectory, linkedAncestor, "dir");
    try {
      const result = spawnSync(
        join(process.cwd(), "node_modules", ".bin", "tsx"),
        [
          "src/cli.ts",
          "counts",
          "--runner-db",
          join(linkedAncestor, "private", "runner.db")
        ],
        { cwd: process.cwd(), encoding: "utf8", timeout: 10_000 }
      );

      assert.equal(result.status, 1);
      assert.match(result.stderr, /Runner database parent.*symbolic link/i);
      assert.equal(existsSync(join(outsidePrivateDirectory, "runner.db")), false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
      rmSync(outsideDirectory, { recursive: true, force: true });
    }
  });

  it("locally excludes an explicit in-project Runner database and every SQLite sidecar", () => {
    const cliPath = join(process.cwd(), "src", "cli.ts");
    const projectRoot = mkdtempSync(join(tmpdir(), "score-runner-cli-git-exclude-"));
    const stateDirectory = join(projectRoot, "state");
    const runnerDatabasePath = join(stateDirectory, "custom.sqlite");
    execFileSync("git", ["init", "-q", projectRoot]);
    mkdirSync(stateDirectory, { mode: 0o700 });
    try {
      const result = spawnSync(
        join(process.cwd(), "node_modules", ".bin", "tsx"),
        [cliPath, "counts", "--runner-db", runnerDatabasePath],
        { cwd: projectRoot, encoding: "utf8", timeout: 10_000 }
      );
      assert.equal(result.status, 0, result.stderr);

      for (const suffix of ["", "-journal", "-shm", "-wal"] as const) {
        const path = `${runnerDatabasePath}${suffix}`;
        if (suffix !== "") writeFileSync(path, "private state\n", "utf8");
        const ignored = spawnSync("git", ["check-ignore", "-q", "--no-index", path], {
          cwd: projectRoot
        });
        assert.equal(ignored.status, 0, `${path} must be locally excluded`);
      }
      assert.equal(
        execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], {
          cwd: projectRoot,
          encoding: "utf8"
        }),
        ""
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("rejects an in-project Runner database name that could inject Git exclusions", () => {
    const cliPath = join(process.cwd(), "src", "cli.ts");
    const projectRoot = mkdtempSync(join(tmpdir(), "score-runner-cli-git-injection-"));
    execFileSync("git", ["init", "-q", projectRoot]);
    try {
      const result = spawnSync(
        join(process.cwd(), "node_modules", ".bin", "tsx"),
        [cliPath, "counts", "--runner-db", join(projectRoot, "state\n*.secret.db")],
        { cwd: projectRoot, encoding: "utf8", timeout: 10_000 }
      );

      assert.equal(result.status, 1);
      assert.match(result.stderr, /Runner database path.*control characters/i);
      const excludePath = join(projectRoot, ".git", "info", "exclude");
      assert.doesNotMatch(readFileSync(excludePath, "utf8"), /secret/u);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("refuses a Runner SQLite sidecar symlink without changing its target", () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-cli-sidecar-symlink-"));
    const outsidePath = join(directory, "outside");
    const runnerDatabasePath = join(directory, "runner.db");
    writeFileSync(outsidePath, "outside bytes\n", "utf8");
    symlinkSync(outsidePath, `${runnerDatabasePath}-wal`, "file");
    try {
      const result = spawnSync(
        join(process.cwd(), "node_modules", ".bin", "tsx"),
        ["src/cli.ts", "counts", "--runner-db", runnerDatabasePath],
        { cwd: process.cwd(), encoding: "utf8", timeout: 10_000 }
      );

      assert.equal(result.status, 1);
      assert.match(result.stderr, /Runner database-wal.*symbolic link/i);
      assert.equal(readFileSync(outsidePath, "utf8"), "outside bytes\n");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("creates and tightens an explicit Runner database to private permissions", () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-cli-private-db-"));
    const runnerDatabasePath = join(directory, "runner.db");
    writeFileSync(runnerDatabasePath, "", { mode: 0o644 });
    try {
      const result = spawnSync(
        join(process.cwd(), "node_modules", ".bin", "tsx"),
        ["src/cli.ts", "counts", "--runner-db", runnerDatabasePath],
        { cwd: process.cwd(), encoding: "utf8", timeout: 10_000 }
      );

      assert.equal(result.status, 0, result.stderr);
      if (process.platform !== "win32") {
        assert.equal(statSync(directory).mode & 0o777, 0o700);
        assert.equal(statSync(runnerDatabasePath).mode & 0o777, 0o600);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("requires an explicit existing Runner database parent to already be private", () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-cli-public-parent-"));
    const runnerDatabasePath = join(directory, "runner.db");
    chmodSync(directory, 0o755);
    try {
      const result = spawnSync(
        join(process.cwd(), "node_modules", ".bin", "tsx"),
        ["src/cli.ts", "counts", "--runner-db", runnerDatabasePath],
        { cwd: process.cwd(), encoding: "utf8", timeout: 10_000 }
      );

      if (process.platform === "win32") {
        assert.equal(result.status, 0, result.stderr);
      } else {
        assert.equal(result.status, 1);
        assert.match(result.stderr, /Runner database parent permissions must be 0700/i);
        assert.equal(existsSync(runnerDatabasePath), false);
        assert.equal(statSync(directory).mode & 0o777, 0o755);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("creates the default Runner state directory and database with private permissions", () => {
    const homeDirectory = mkdtempSync(join(tmpdir(), "score-runner-cli-default-home-"));
    const runnerDatabasePath = defaultRunnerDatabasePath({
      homeDirectory,
      environment: {}
    });
    mkdirSync(dirname(runnerDatabasePath), { recursive: true, mode: 0o755 });
    chmodSync(dirname(runnerDatabasePath), 0o755);
    try {
      const result = spawnSync(
        join(process.cwd(), "node_modules", ".bin", "tsx"),
        ["src/cli.ts", "counts"],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          timeout: 10_000,
          env: { ...process.env, HOME: homeDirectory, XDG_DATA_HOME: "" }
        }
      );

      assert.equal(result.status, 0, result.stderr);
      assert.equal(existsSync(runnerDatabasePath), true);
      if (process.platform !== "win32") {
        assert.equal(statSync(dirname(runnerDatabasePath)).mode & 0o777, 0o700);
        assert.equal(statSync(runnerDatabasePath).mode & 0o777, 0o600);
      }
    } finally {
      rmSync(homeDirectory, { recursive: true, force: true });
    }
  });

  it("rejects an empty explicit status Run ID as a missing option value", () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-cli-status-option-"));
    try {
      const result = spawnSync(
        join(process.cwd(), "node_modules", ".bin", "tsx"),
        [
          "src/cli.ts",
          "status",
          "--runner-db",
          join(directory, "runner.db"),
          "--run",
          ""
        ],
        { cwd: process.cwd(), encoding: "utf8", timeout: 10_000 }
      );

      assert.equal(result.status, 1);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "Missing required --run option\n");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does not render absolute local paths from runtime failures", () => {
    const privateSource = "/tmp/private-customer-name/secrets/auth.json";
    const privateDestination =
      "/var/folders/private-run/score-opencode-models/xdg-data/opencode/auth.json";
    const unsafeMessages = [
      `Failed to copy ${privateSource} to ${privateDestination}`,
      "Failed to load file://server/share/private-config.json",
      "Failed to load //server/share/private-config.json"
    ];

    for (const unsafeMessage of unsafeMessages) {
      const message = safeRunnerCliErrorMessage(new Error(unsafeMessage));
      assert.equal(
        message,
        "Runner command failed. Inspect score status for retained diagnostics."
      );
      assert.doesNotMatch(
        message,
        /private-customer-name|private-run|private-config|auth\.json/u
      );
    }
  });

  it("projects generic runtime failures into one bounded terminal-safe line", () => {
    const message = safeRunnerCliErrorMessage(
      "Provider refused\nFORGED C0\u0000\u001b]2;FORGED OSC\u0007\u009b2JFORGED C1\u202eFORGED BIDI"
    );

    assert.equal(
      message,
      "Provider refused FORGED C0 FORGED C1 FORGED BIDI"
    );
    assert.equal(message.split("\n").length, 1);
    assert.doesNotMatch(message, /[\u0000-\u001f\u007f-\u009f]|\p{Cf}/u);
    assert.doesNotMatch(message, /FORGED OSC/u);
  });

  it("does not render internal stack paths for an unavailable SCORE database", () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-cli-safe-error-"));
    try {
      const missingDatabasePath = join(directory, "missing", "score.db");
      const result = spawnSync(
        join(process.cwd(), "node_modules", ".bin", "tsx"),
        [
          "src/cli.ts",
          "list",
          "--score-db",
          missingDatabasePath,
          "--runner-db",
          join(directory, "runner.db")
        ],
        { cwd: process.cwd(), encoding: "utf8", timeout: 10_000 }
      );

      assert.equal(result.status, 1);
      assert.match(result.stderr, /open database/i);
      assert.doesNotMatch(result.stderr, /node_modules|src\/score-alpha|missing\/score\.db/u);
      assert.equal(result.stderr.trim().split("\n").length, 1);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("parses an explicit variant value", () => {
    assert.equal(optionValue(["start", "--variant", "low"], "variant"), "low");
  });

  it("rejects a bare variant instead of silently using the runtime default", () => {
    assert.throws(
      () => optionValue(["start", "--variant"], "variant"),
      /Missing value for --variant option/
    );
    assert.throws(
      () => optionValue(["start", "--variant", "--repo", "/workspace"], "variant"),
      /Missing value for --variant option/
    );
  });

  it("rejects an invalid noninteractive --variant before creating a Run database", () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-cli-variant-"));
    const commandPath = join(directory, "fake-opencode");
    const authPath = join(directory, "auth.json");
    const runnerDatabasePath = join(directory, "runner.db");
    writeFileSync(authPath, "{}\n", "utf8");
    writeFileSync(
      commandPath,
      `#!/usr/bin/env node
const http = require("node:http");
if (process.argv[2] === "--version") {
  process.stdout.write("opencode2 v0.0.0-next-17111\\n");
  process.exit(0);
}
if (process.argv[2] !== "serve") process.exit(2);
const password = "selection-password";
const authorization = "Basic " + Buffer.from("opencode:" + password).toString("base64");
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, "http://127.0.0.1").pathname;
  response.setHeader("content-type", "application/json");
  if (request.headers.authorization !== authorization) {
    response.statusCode = 401;
    response.end(JSON.stringify({ message: "unauthorized" }));
    return;
  }
  if (request.method === "GET" && pathname === "/api/provider") {
    response.end(JSON.stringify({
      location: { directory: "fixture", project: { id: "p", directory: "fixture", canonical: "fixture" } },
      data: [{ id: "opencode", name: "OpenCode Zen", package: "zen" }]
    }));
    return;
  }
  if (request.method === "GET" && pathname === "/api/model") {
    response.end(JSON.stringify({
      location: { directory: "fixture", project: { id: "p", directory: "fixture", canonical: "fixture" } },
      data: [{
        id: "gpt-5.4",
        modelID: "gpt-5.4",
        providerID: "opencode",
        name: "GPT-5.4",
        enabled: true,
        variants: [{ id: "low" }, { id: "fast" }]
      }]
    }));
    return;
  }
  response.statusCode = 404;
  response.end(JSON.stringify({ error: pathname }));
});
process.on("SIGTERM", () => server.close(() => process.exit(0)));
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  process.stdout.write("server listening on http://127.0.0.1:" + address.port + "\\n");
  process.stdout.write("server password " + password + "\\n");
});
`,
      "utf8"
    );
    chmodSync(commandPath, 0o755);

    try {
      const result = spawnSync(
        join(process.cwd(), "node_modules", ".bin", "tsx"),
        [
          "src/runner/cli.ts",
          "start",
          "--score-db",
          join(directory, "score.db"),
          "--runner-db",
          runnerDatabasePath,
          "--pass",
          "pass-not-reached",
          "--provider",
          "opencode",
          "--model",
          "gpt-5.4",
          "--variant",
          "turbo",
          "--opencode-command",
          commandPath,
          "--opencode-auth",
          authPath,
          "--start-timeout-ms",
          "3000"
        ],
        { cwd: process.cwd(), encoding: "utf8", timeout: 10_000 }
      );

      assert.equal(result.status, 1);
      assert.match(result.stderr, /GPT-5\.4 does not advertise variant turbo/);
      assert.equal(existsSync(runnerDatabasePath), false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
