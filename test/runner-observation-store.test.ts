import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { promisify } from "node:util";

import { Effect } from "effect";
import Database from "better-sqlite3";

import { sha256Bytes, sha256Json } from "../src/canonical.js";
import { repositoryRevisionContentDigest } from "../src/repository-source-state.js";
import { RunId } from "../src/runner/domain.js";
import { inspectLatestProjectRun } from "../src/runner/runner.js";
import { RunnerStore, RunnerStoreLive } from "../src/runner/runner-store.js";
import { formatRunStatus } from "../src/runner/failure-presentation.js";
import type { ApprovedPassExport } from "../src/score-alpha.js";

const execFileAsync = promisify(execFile);

function approvedCreatePlan(targetPaths = ["src/alpha.ts", "src/beta.ts"]): ApprovedPassExport {
  const sourceSnapshotDigest = repositoryRevisionContentDigest({ orderedManifest: [] });
  const payloads = targetPaths.map((targetPath, index) => {
    const control = {
      protocol: {
        bundle_schema: "score.compilation-bundle@0.1.0-alpha.5" as const,
        profile: "score.coding@0.1.0-alpha.5" as const,
        canonicalization: "RFC 8785" as const,
        digest_algorithm: "SHA-256" as const
      },
      target_path: targetPath,
      operation: "create" as const,
      base_revision_id: "observation-source-snapshot",
      base_revision_digest: sourceSnapshotDigest,
      allowed_effects: [{ kind: "create_file", path: targetPath }]
    };
    const agentInput = {
      target: {
        path: targetPath,
        operation: "create" as const,
        state_at_base_revision: "absent"
      },
      required_capabilities: [
        {
          capability: "score.coding.filesystem.single-target",
          version_rule: "=1.0.0",
          required: true,
          configuration: {
            allowed_operations: ["create_assigned_target"],
            network: false,
            repository_discovery: false,
            shell: false,
            target_path: targetPath
          }
        }
      ],
      declarations: {
        owned: [
          {
            name: `ObservedFile${index}`,
            declaration: `export interface ObservedFile${index} { value: string; }`,
            description: "A deterministic observation-store fixture declaration."
          }
        ],
        consumed: []
      }
    };
    const payload = { control, agent_input: agentInput };
    return {
      payload_id: `observation-payload-${index}`,
      target_path: targetPath,
      operation: "create" as const,
      control,
      agent_input: agentInput,
      payload,
      control_digest: sha256Json(control),
      agent_input_digest: sha256Json(agentInput),
      payload_digest: sha256Json(payload)
    };
  });
  return {
    schema: "score.approved-pass-export",
    version: "0.1.0-alpha.6",
    pass_id: "observation-approved-pass",
    publication: {
      review_id: "observation-review",
      decision_id: "observation-decision",
      authority: "test-human-authority",
      decided_at: "2026-08-11T12:00:00.000Z"
    },
    source_snapshot: {
      revision_id: "observation-source-snapshot",
      content_digest: sourceSnapshotDigest,
      files: []
    },
    payloads
  };
}

function enqueueStoredRun(runnerDatabasePath: string, plan = approvedCreatePlan()) {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function*() {
        const store = yield* RunnerStore;
        yield* store.initialize;
        return yield* store.enqueue({
          approvedPlan: plan,
          repositoryRoot: "/tmp/score-observation-store-fixture",
          adapter: {
            kind: "opencode",
            providerId: "test-provider",
            modelId: "test-model",
            variantId: "medium",
            sdkVersion: "0.0.0-next-17111",
            cliVersion: "0.0.0-next-17111"
          },
          maxConcurrency: 2
        });
      }).pipe(Effect.provide(RunnerStoreLive(runnerDatabasePath)))
    )
  );
}

function inspectStoredRun(runnerDatabasePath: string, runId: string) {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function*() {
        const store = yield* RunnerStore;
        yield* store.initialize;
        return yield* store.inspectRun(RunId.make(runId));
      }).pipe(Effect.provide(RunnerStoreLive(runnerDatabasePath)))
    )
  );
}

describe("Runner observation store", () => {
  it("inspects the latest Run for the saved project repository rather than the global latest", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-latest-project-run-"));
    const runnerDatabasePath = join(directory, "runner.db");
    const scoreDatabasePath = join(directory, "project-a", ".score", "score.db");
    const projectA = join(directory, "project-a");
    const projectB = join(directory, "project-b");
    mkdirSync(join(projectA, ".score"), { recursive: true });
    mkdirSync(projectB, { recursive: true });
    try {
      const runs = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function*() {
            const store = yield* RunnerStore;
            yield* store.initialize;
            yield* store.saveRepositoryRoot({
              scoreDatabasePath: join(
                realpathSync(join(projectA, ".score")),
                "score.db"
              ),
              repositoryRoot: projectA
            });
            const firstProjectRun = yield* store.enqueue({
              approvedPlan: approvedCreatePlan(["src/first.ts"]),
              repositoryRoot: projectA,
              adapter: {
                kind: "opencode",
                providerId: "test-provider",
                modelId: "test-model",
                variantId: "medium",
                sdkVersion: "0.0.0-next-17111",
                cliVersion: "0.0.0-next-17111"
              },
              maxConcurrency: 1
            });
            const latestProjectRun = yield* store.enqueue({
              approvedPlan: approvedCreatePlan(["src/latest.ts"]),
              repositoryRoot: projectA,
              adapter: {
                kind: "opencode",
                providerId: "test-provider",
                modelId: "test-model",
                variantId: "medium",
                sdkVersion: "0.0.0-next-17111",
                cliVersion: "0.0.0-next-17111"
              },
              maxConcurrency: 1
            });
            const globalLatestRun = yield* store.enqueue({
              approvedPlan: approvedCreatePlan(["src/foreign.ts"]),
              repositoryRoot: projectB,
              adapter: {
                kind: "opencode",
                providerId: "test-provider",
                modelId: "test-model",
                variantId: "medium",
                sdkVersion: "0.0.0-next-17111",
                cliVersion: "0.0.0-next-17111"
              },
              maxConcurrency: 1
            });
            return { firstProjectRun, latestProjectRun, globalLatestRun };
          }).pipe(Effect.provide(RunnerStoreLive(runnerDatabasePath)))
        )
      );

      const latest = await Effect.runPromise(
        inspectLatestProjectRun({ scoreDatabasePath, runnerDatabasePath })
      );

      assert.notEqual(runs.firstProjectRun.runId, runs.latestProjectRun.runId);
      assert.notEqual(runs.latestProjectRun.runId, runs.globalLatestRun.runId);
      assert.equal(latest.runId, runs.latestProjectRun.runId);
      assert.equal(latest.repositoryRoot, projectA);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("prints the latest project Run when status omits --run", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-latest-status-cli-"));
    const runnerDatabasePath = join(directory, "runner.db");
    const projectRoot = join(directory, "project");
    mkdirSync(join(projectRoot, ".score"), { recursive: true });
    try {
      const enqueued = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function*() {
            const store = yield* RunnerStore;
            yield* store.initialize;
            yield* store.saveRepositoryRoot({
              scoreDatabasePath: join(
                realpathSync(join(projectRoot, ".score")),
                "score.db"
              ),
              repositoryRoot: projectRoot
            });
            return yield* store.enqueue({
              approvedPlan: approvedCreatePlan(["src/latest.ts"]),
              repositoryRoot: projectRoot,
              adapter: {
                kind: "opencode",
                providerId: "test-provider",
                modelId: "test-model",
                variantId: "medium",
                sdkVersion: "0.0.0-next-17111",
                cliVersion: "0.0.0-next-17111"
              },
              maxConcurrency: 1
            });
          }).pipe(Effect.provide(RunnerStoreLive(runnerDatabasePath)))
        )
      );

      const { stdout, stderr } = await execFileAsync(
        join(process.cwd(), "node_modules", ".bin", "tsx"),
        [
          join(process.cwd(), "src", "cli.ts"),
          "status",
          "--runner-db",
          runnerDatabasePath,
          "--json"
        ],
        { cwd: projectRoot }
      );

      assert.equal(stderr, "");
      assert.equal(JSON.parse(stdout).runId, enqueued.runId);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("retains explicit status lookup for an older Run", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-explicit-status-cli-"));
    const runnerDatabasePath = join(directory, "runner.db");
    const projectRoot = join(directory, "project");
    mkdirSync(join(projectRoot, ".score"), { recursive: true });
    try {
      const runs = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function*() {
            const store = yield* RunnerStore;
            yield* store.initialize;
            const older = yield* store.enqueue({
              approvedPlan: approvedCreatePlan(["src/older.ts"]),
              repositoryRoot: projectRoot,
              adapter: {
                kind: "opencode",
                providerId: "test-provider",
                modelId: "test-model",
                variantId: "medium",
                sdkVersion: "0.0.0-next-17111",
                cliVersion: "0.0.0-next-17111"
              },
              maxConcurrency: 1
            });
            const newer = yield* store.enqueue({
              approvedPlan: approvedCreatePlan(["src/newer.ts"]),
              repositoryRoot: projectRoot,
              adapter: {
                kind: "opencode",
                providerId: "test-provider",
                modelId: "test-model",
                variantId: "medium",
                sdkVersion: "0.0.0-next-17111",
                cliVersion: "0.0.0-next-17111"
              },
              maxConcurrency: 1
            });
            return { older, newer };
          }).pipe(Effect.provide(RunnerStoreLive(runnerDatabasePath)))
        )
      );

      const { stdout, stderr } = await execFileAsync(
        join(process.cwd(), "node_modules", ".bin", "tsx"),
        [
          join(process.cwd(), "src", "cli.ts"),
          "status",
          "--runner-db",
          runnerDatabasePath,
          "--run",
          runs.older.runId,
          "--json"
        ],
        { cwd: projectRoot }
      );

      assert.equal(stderr, "");
      assert.equal(JSON.parse(stdout).runId, runs.older.runId);
      assert.notEqual(JSON.parse(stdout).runId, runs.newer.runId);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does not select a global Run when the current project has no saved binding", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-unbound-status-cli-"));
    const runnerDatabasePath = join(directory, "runner.db");
    const projectRoot = join(directory, "project");
    mkdirSync(join(projectRoot, ".score"), { recursive: true });
    try {
      await enqueueStoredRun(
        runnerDatabasePath,
        approvedCreatePlan(["src/global-only.ts"])
      );

      await assert.rejects(
        execFileAsync(
          join(process.cwd(), "node_modules", ".bin", "tsx"),
          [
            join(process.cwd(), "src", "cli.ts"),
            "status",
            "--runner-db",
            runnerDatabasePath
          ],
          { cwd: projectRoot }
        ),
        (cause: unknown) => {
          const failure = cause as {
            readonly code?: unknown;
            readonly stdout?: unknown;
            readonly stderr?: unknown;
          };
          assert.equal(failure.code, 1);
          assert.equal(failure.stdout, "");
          assert.equal(
            failure.stderr,
            "No Run is available for the current project. Start one with score start or use score status --run <id>.\n"
          );
          return true;
        }
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("migrates a historical Run into an honest additive observation", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-observation-migration-"));
    const runnerDatabasePath = join(directory, "runner.db");
    try {
      const database = new Database(runnerDatabasePath);
      database.exec(`CREATE TABLE runner_runs (
        run_id TEXT PRIMARY KEY,
        approved_pass_id TEXT NOT NULL,
        review_id TEXT NOT NULL,
        decision_id TEXT NOT NULL,
        decision_authority TEXT NOT NULL,
        decision_at TEXT NOT NULL,
        adapter_kind TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        sdk_version TEXT NOT NULL,
        cli_version TEXT NOT NULL,
        max_concurrency INTEGER NOT NULL CHECK (max_concurrency BETWEEN 1 AND 32),
        state TEXT NOT NULL CHECK (state IN ('pending', 'running', 'completed', 'completed_with_failures')),
        created_at TEXT NOT NULL
      ) STRICT`);
      database
        .prepare(
          `INSERT INTO runner_runs
           (run_id, approved_pass_id, review_id, decision_id, decision_authority,
            decision_at, adapter_kind, provider_id, model_id, sdk_version,
            cli_version, max_concurrency, state, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          "historical-run",
          "historical-pass",
          "historical-review",
          "historical-decision",
          "historical-authority",
          "2026-08-06T12:00:00.000Z",
          "opencode",
          "historical-provider",
          "historical-model",
          "0.0.0-next-17111",
          "0.0.0-next-17111",
          2,
          "completed",
          "2026-08-06T12:01:00.000Z"
        );
      database.close();

      const run = await inspectStoredRun(runnerDatabasePath, "historical-run");

      assert.deepEqual(run.observation, {
        runId: "historical-run",
        providerId: "historical-provider",
        modelId: "historical-model",
        variantId: null,
        runtimeVersion: {
          sdkVersion: "0.0.0-next-17111",
          cliVersion: "0.0.0-next-17111"
        },
        createdAt: "2026-08-06T12:01:00.000Z",
        lastObservedAt: "2026-08-06T12:01:00.000Z",
        terminalAt: null,
        sequence: 0,
        phase: "not applied",
        failureCategory: null,
        failureMessage: null,
        application: {
          state: "not_applied",
          appliedAt: null,
          filesApplied: false
        },
        files: []
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("migrates partially upgraded historical Attempts with honest sanitized defaults", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-observation-attempt-migration-"));
    const runnerDatabasePath = join(directory, "runner.db");
    try {
      const database = new Database(runnerDatabasePath);
      database.exec(`CREATE TABLE runner_runs (
        run_id TEXT PRIMARY KEY,
        approved_pass_id TEXT NOT NULL,
        review_id TEXT NOT NULL,
        decision_id TEXT NOT NULL,
        decision_authority TEXT NOT NULL,
        decision_at TEXT NOT NULL,
        adapter_kind TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        sdk_version TEXT NOT NULL,
        cli_version TEXT NOT NULL,
        max_concurrency INTEGER NOT NULL,
        state TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE runner_jobs (
        job_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runner_runs(run_id),
        ordinal INTEGER NOT NULL,
        payload_id TEXT NOT NULL,
        target_path TEXT NOT NULL,
        operation TEXT NOT NULL,
        control_json TEXT NOT NULL,
        agent_input_json TEXT NOT NULL,
        package_json TEXT NOT NULL,
        control_digest TEXT NOT NULL,
        agent_input_digest TEXT NOT NULL,
        package_digest TEXT NOT NULL,
        state TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE runner_attempts (
        attempt_id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL REFERENCES runner_jobs(job_id),
        attempt_number INTEGER NOT NULL,
        state TEXT NOT NULL,
        claimed_at TEXT NOT NULL,
        completed_at TEXT,
        candidate_path TEXT,
        candidate_digest TEXT,
        candidate_content TEXT,
        runtime_session_id TEXT,
        failure_tag TEXT,
        failure_message TEXT,
        failure_stage TEXT
      ) STRICT`);
      database
        .prepare(
          `INSERT INTO runner_runs
           (run_id, approved_pass_id, review_id, decision_id, decision_authority,
            decision_at, adapter_kind, provider_id, model_id, sdk_version,
            cli_version, max_concurrency, state, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          "historical-attempt-run",
          "historical-pass",
          "historical-review",
          "historical-decision",
          "historical-authority",
          "2026-08-06T12:00:00.000Z",
          "opencode",
          "historical-provider",
          "historical-model",
          "historical-sdk",
          "historical-cli",
          1,
          "completed_with_failures",
          "2026-08-06T12:01:00.000Z"
        );
      database
        .prepare(
          `INSERT INTO runner_jobs
           (job_id, run_id, ordinal, payload_id, target_path, operation, control_json,
            agent_input_json, package_json, control_digest, agent_input_digest,
            package_digest, state, created_at)
           VALUES (?, ?, 0, ?, ?, 'create', '{}', '{}', '{}', ?, ?, ?, 'failed', ?)`
        )
        .run(
          "historical-job",
          "historical-attempt-run",
          "historical-payload",
          "src/historical.ts",
          "control-digest",
          "agent-input-digest",
          "package-digest",
          "2026-08-06T12:01:00.000Z"
        );
      database
        .prepare(
          `INSERT INTO runner_attempts
           (attempt_id, job_id, attempt_number, state, claimed_at, completed_at,
            runtime_session_id, failure_tag, failure_message)
           VALUES (?, ?, 1, 'failed', ?, ?, ?, ?, ?)`
        )
        .run(
          "historical-attempt",
          "historical-job",
          "2026-08-06T12:02:00.000Z",
          "2026-08-06T12:03:00.000Z",
          "historical-session",
          "AdapterInvocationError",
          "Provider failed; token=historical-secret"
        );
      const historicalReplacement = "export const historical = true;\n";
      database
        .prepare(
          `INSERT INTO runner_jobs
           (job_id, run_id, ordinal, payload_id, target_path, operation, control_json,
            agent_input_json, package_json, control_digest, agent_input_digest,
            package_digest, state, created_at)
           VALUES (?, ?, 1, ?, ?, 'replace', '{}', '{}', '{}', ?, ?, ?, 'succeeded', ?)`
        )
        .run(
          "historical-replace-job",
          "historical-attempt-run",
          "historical-replace-payload",
          "src/historical-replace.ts",
          "replace-control-digest",
          "replace-agent-input-digest",
          "replace-package-digest",
          "2026-08-06T12:01:00.000Z"
        );
      database
        .prepare(
          `INSERT INTO runner_attempts
           (attempt_id, job_id, attempt_number, state, claimed_at, completed_at,
            candidate_path, candidate_digest, candidate_content, runtime_session_id)
           VALUES (?, ?, 1, 'succeeded', ?, ?, ?, ?, ?, ?)`
        )
        .run(
          "historical-replace-attempt",
          "historical-replace-job",
          "2026-08-06T12:02:00.000Z",
          "2026-08-06T12:03:00.000Z",
          "src/historical-replace.ts",
          sha256Bytes(historicalReplacement),
          historicalReplacement,
          "ghp_0123456789abcdefghijklmnopqrstuvwxyz"
        );
      database.close();

      const run = await inspectStoredRun(runnerDatabasePath, "historical-attempt-run");
      const file = run.observation.files.find(
        (candidate) => candidate.targetPath === "src/historical.ts"
      );
      const historicalReplace = run.observation.files.find(
        (candidate) => candidate.targetPath === "src/historical-replace.ts"
      );
      assert.ok(file);
      assert.ok(historicalReplace);
      assert.equal(run.observation.phase, "not applied");
      assert.equal(file.stage, "failed");
      assert.equal(file.source, "historical");
      assert.equal(file.sequence, 0);
      assert.equal(file.observedAt, "2026-08-06T12:03:00.000Z");
      assert.equal(file.failureCategory, "runtime");
      assert.equal(file.failureMessage, "Runtime failure.");
      assert.equal(file.failureStage, null);
      assert.deepEqual(file.failureEvidence, {
        category: "runtime",
        stage: null,
        name: null,
        status: null,
        statusCode: null,
        reason: null
      });
      assert.equal(file.runtimeSessionId, "historical-session");
      assert.equal(file.targetOutputState, "not observed");
      assert.equal(historicalReplace.stage, "succeeded");
      assert.equal(historicalReplace.source, "historical");
      assert.equal(historicalReplace.runtimeSessionId, null);
      assert.equal(historicalReplace.targetOutputState, "not observed");
      const migrated = new Database(runnerDatabasePath, { readonly: true });
      const stored = migrated
        .prepare(
          `SELECT failure_message AS failureMessage
           FROM runner_attempts WHERE attempt_id = 'historical-attempt'`
        )
        .get() as { failureMessage: string };
      assert.equal(stored.failureMessage, "Runtime failure.");
      const storedSession = migrated
        .prepare(
          `SELECT runtime_session_id AS runtimeSessionId
           FROM runner_attempts WHERE attempt_id = 'historical-replace-attempt'`
        )
        .get() as { runtimeSessionId: string | null };
      migrated.close();
      assert.equal(storedSession.runtimeSessionId, null);
      const historicalStatus = formatRunStatus(run);
      assert.match(historicalStatus, /^src\/historical\.ts failed$/mu);
      assert.match(
        historicalStatus,
        /^Reason: Unavailable \(not retained for this Run\)$/mu
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("serializes concurrent first-open migrations across processes", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-observation-race-"));
    const runnerDatabasePath = join(directory, "runner.db");
    try {
      const database = new Database(runnerDatabasePath);
      database.exec(`CREATE TABLE runner_runs (
        run_id TEXT PRIMARY KEY,
        approved_pass_id TEXT NOT NULL,
        review_id TEXT NOT NULL,
        decision_id TEXT NOT NULL,
        decision_authority TEXT NOT NULL,
        decision_at TEXT NOT NULL,
        adapter_kind TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        sdk_version TEXT NOT NULL,
        cli_version TEXT NOT NULL,
        max_concurrency INTEGER NOT NULL,
        state TEXT NOT NULL,
        created_at TEXT NOT NULL
      ) STRICT`);
      database.close();

      const runnerModuleUrl = new URL("../src/runner/runner.ts", import.meta.url).href;
      const startPath = join(directory, "start");
      const readyDirectory = join(directory, "ready");
      mkdirSync(readyDirectory);
      const script = `
        import { existsSync, writeFileSync } from "node:fs";
        import { join } from "node:path";
        import { Effect } from "effect";
        import { inspectRunner } from ${JSON.stringify(runnerModuleUrl)};
        writeFileSync(join(process.argv[3], String(process.pid)), "ready");
        while (!existsSync(process.argv[2])) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        const result = await Effect.runPromise(inspectRunner(process.argv[1]));
        process.stdout.write(JSON.stringify(result));
      `;
      const processCount = 16;
      const executions = Array.from({ length: processCount }, () =>
          execFileAsync(
            process.execPath,
            [
              "--import",
              "tsx",
              "--input-type=module",
              "--eval",
              script,
              runnerDatabasePath,
              startPath,
              readyDirectory
            ],
            { cwd: process.cwd(), timeout: 20_000 }
          )
      );
      const readyDeadline = Date.now() + 15_000;
      while (readdirSync(readyDirectory).length < processCount) {
        assert.ok(Date.now() < readyDeadline, "migration workers did not become ready");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      writeFileSync(startPath, "start");
      const results = await Promise.all(executions);
      assert.ok(
        results.every(({ stdout }) =>
          JSON.stringify(JSON.parse(stdout)) ===
          JSON.stringify({ runs: 0, jobs: 0, attempts: 0 })
        )
      );
      const migrated = new Database(runnerDatabasePath, { readonly: true });
      const attemptColumns = migrated
        .prepare("PRAGMA table_info(runner_attempts)")
        .all() as Array<{ name: string }>;
      migrated.close();
      assert.equal(attemptColumns.some(({ name }) => name === "failure_stage"), true);
      assert.equal(
        attemptColumns.some(({ name }) => name === "failure_evidence_json"),
        true
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("shows every File Job as waiting immediately after enqueue", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-observation-waiting-"));
    const runnerDatabasePath = join(directory, "runner.db");
    try {
      const plan = approvedCreatePlan();
      const enqueued = await enqueueStoredRun(runnerDatabasePath, plan);
      const run = await inspectStoredRun(runnerDatabasePath, enqueued.runId);

      assert.equal(run.observation.phase, "generating candidates");
      assert.equal(run.observation.sequence, 0);
      assert.deepEqual(
        run.observation.files.map((file) => ({
          runId: file.runId,
          targetPath: file.targetPath,
          operation: file.operation,
          agentInputDigest: file.agentInputDigest,
          attemptId: file.attemptId,
          stage: file.stage,
          source: file.source,
          observedAt: file.observedAt,
          sequence: file.sequence,
          targetOutputState: file.targetOutputState
        })),
        plan.payloads.map((payload) => ({
          runId: enqueued.runId,
          targetPath: payload.target_path,
          operation: payload.operation,
          agentInputDigest: payload.agent_input_digest,
          attemptId: null,
          stage: "waiting",
          source: "runner",
          observedAt: run.observation.createdAt,
          sequence: 0,
          targetOutputState: "not observed"
        }))
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("advances ordered Attempt stages and rejects late observations after terminal storage", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-observation-stages-"));
    const runnerDatabasePath = join(directory, "runner.db");
    try {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function*() {
            const store = yield* RunnerStore;
            yield* store.initialize;
            const enqueued = yield* store.enqueue({
              approvedPlan: approvedCreatePlan(["src/only.ts"]),
              repositoryRoot: "/tmp/score-observation-store-fixture",
              adapter: {
                kind: "opencode",
                providerId: "test-provider",
                modelId: "test-model",
                variantId: "medium",
                sdkVersion: "0.0.0-next-17111",
                cliVersion: "0.0.0-next-17111"
              },
              maxConcurrency: 1
            });
            const initial = yield* store.inspectRun(enqueued.runId);
            yield* store.beginWork(enqueued.runId);
            const claimed = yield* store.claimNext(enqueued.runId);
            assert.ok(claimed);
            const starting = yield* store.inspectRun(enqueued.runId);
            yield* store.recordAttemptObservation({
              job: claimed,
              stage: "starting",
              source: "runtime adapter",
              runtimeSessionId: "session-observed"
            });
            const sessionCreated = yield* store.inspectRun(enqueued.runId);
            yield* store.recordAttemptObservation({
              job: claimed,
              stage: "Agent working",
              source: "runtime adapter",
              runtimeSessionId: "session-observed"
            });
            const working = yield* store.inspectRun(enqueued.runId);
            yield* store.recordAttemptObservation({
              job: claimed,
              stage: "checking output",
              source: "runtime adapter",
              runtimeSessionId: "session-observed"
            });
            const checking = yield* store.inspectRun(enqueued.runId);
            yield* store.recordAttemptObservation({
              job: claimed,
              stage: "candidate ready",
              source: "runtime adapter",
              runtimeSessionId: "session-observed",
              targetOutputState: "present",
              targetOutputDigest: sha256Bytes("candidate\n")
            });
            const ready = yield* store.inspectRun(enqueued.runId);
            yield* store.completeSuccess({
              job: claimed,
              content: "candidate\n",
              runtimeSessionId: "session-observed",
              targetOutputState: "present",
              targetOutputDigest: sha256Bytes("candidate\n")
            });
            const succeeded = yield* store.inspectRun(enqueued.runId);
            const lateError = yield* Effect.flip(
              store.recordAttemptObservation({
                job: claimed,
                stage: "checking output",
                source: "runtime adapter"
              })
            );
            const afterLate = yield* store.inspectRun(enqueued.runId);
            return {
              initial,
              starting,
              sessionCreated,
              working,
              checking,
              ready,
              succeeded,
              lateError,
              afterLate
            };
          }).pipe(Effect.provide(RunnerStoreLive(runnerDatabasePath)))
        )
      );

      const stages = [
        result.starting,
        result.sessionCreated,
        result.working,
        result.checking,
        result.ready,
        result.succeeded
      ].map((run) => run.observation.files[0]);
      assert.deepEqual(
        stages.map((file) => [file?.stage, file?.sequence]),
        [
          ["starting", 1],
          ["starting", 2],
          ["Agent working", 3],
          ["checking output", 4],
          ["candidate ready", 5],
          ["succeeded", 6]
        ]
      );
      assert.deepEqual(
        stages.map((file) => file?.runtimeSessionId),
        [
          null,
          "session-observed",
          "session-observed",
          "session-observed",
          "session-observed",
          "session-observed"
        ]
      );
      assert.deepEqual(
        [
          result.initial.observation.sequence,
          result.starting.observation.sequence,
          result.sessionCreated.observation.sequence,
          result.working.observation.sequence,
          result.checking.observation.sequence,
          result.ready.observation.sequence,
          result.succeeded.observation.sequence
        ],
        [0, 2, 3, 4, 5, 6, 7]
      );
      assert.equal(result.lateError._tag, "RunnerStoreError");
      assert.deepEqual(result.afterLate.observation, result.succeeded.observation);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reopens sanitized failure evidence while retaining only the rejected-byte digest", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-observation-failure-"));
    const runnerDatabasePath = join(directory, "runner.db");
    try {
      const rejectedContent = "export const rejected = true;\n";
      const rejectedDigest = sha256Bytes(rejectedContent);
      const first = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function*() {
            const store = yield* RunnerStore;
            yield* store.initialize;
            const enqueued = yield* store.enqueue({
              approvedPlan: approvedCreatePlan(["src/rejected.ts"]),
              repositoryRoot: "/tmp/score-observation-store-fixture",
              adapter: {
                kind: "opencode",
                providerId: "test-provider",
                modelId: "test-model",
                variantId: "medium",
                sdkVersion: "0.0.0-next-17111",
                cliVersion: "0.0.0-next-17111"
              },
              maxConcurrency: 1
            });
            yield* store.beginWork(enqueued.runId);
            const claimed = yield* store.claimNext(enqueued.runId);
            assert.ok(claimed);
            yield* store.recordAttemptObservation({
              job: claimed,
              stage: "Agent working",
              source: "runtime adapter",
              runtimeSessionId: "failed-session"
            });
            yield* store.completeFailure({
              job: claimed,
              failureEvidence: {
                category: "provider",
                stage: null,
                name: "RateLimitError",
                status: "error",
                statusCode: 429,
                reason:
                  "Rate limited; token=private-status-token; " +
                  'raw_metadata={"authorization":"Bearer raw-header-secret","private":"must-not-survive"}'
              },
              runtimeSessionId: "failed-session",
              targetOutputState: "different",
              targetOutputDigest: rejectedDigest,
              diagnosticContent: rejectedContent
            });
            return {
              runId: enqueued.runId,
              observation: (yield* store.inspectRun(enqueued.runId)).observation,
              candidates: yield* store.readCandidates(enqueued.runId)
            };
          }).pipe(Effect.provide(RunnerStoreLive(runnerDatabasePath)))
        )
      );
      const reopened = await inspectStoredRun(runnerDatabasePath, first.runId);
      const file = reopened.observation.files[0];
      assert.ok(file);

      assert.deepEqual(reopened.observation, first.observation);
      assert.deepEqual(first.candidates, []);
      assert.equal(file.stage, "failed");
      assert.equal(file.runtimeSessionId, "failed-session");
      assert.equal(file.failureCategory, "provider");
      assert.equal(file.failureStage, "Agent working");
      assert.equal(file.targetOutputState, "different");
      assert.equal(file.rejectedOutputDigest, rejectedDigest);
      assert.deepEqual(file.terminalOutcome, {
        kind: "provider",
        status: "error",
        statusCode: 429,
        name: "RateLimitError"
      });
      assert.deepEqual(file.failureEvidence, {
        category: "provider",
        stage: "Agent working",
        name: "RateLimitError",
        status: "error",
        statusCode: 429,
        reason:
          "Rate limited; [REDACTED CREDENTIAL]; [REDACTED METADATA]"
      });
      assert.equal(file.rejectedOutputPath, null);
      assert.equal(existsSync(`${runnerDatabasePath}.diagnostics`), false);
      const serialized = JSON.stringify(reopened.observation);
      assert.doesNotMatch(
        serialized,
        /secret-token|private-key|private-status-token|raw-secret|private-secret/
      );
      assert.doesNotMatch(
        serialized,
        /authorization|bearer|apiKey|raw[-_]metadata|private[-_]metadata|raw-header-secret|must-not-survive|"headers"|"body"/i
      );
      assert.match(file.failureMessage ?? "", /^Rate limited;/u);

      const projectRoot = join(directory, "project");
      mkdirSync(join(projectRoot, ".score"), { recursive: true });
      const status = await execFileAsync(
        join(process.cwd(), "node_modules", ".bin", "tsx"),
        [
          join(process.cwd(), "src", "cli.ts"),
          "status",
          "--runner-db",
          runnerDatabasePath,
          "--run",
          first.runId
        ],
        { cwd: projectRoot }
      );
      assert.equal(status.stderr, "");
      assert.match(status.stdout, /^Run .* needs attention$/mu);
      assert.match(status.stdout, /^src\/rejected\.ts failed$/mu);
      assert.match(status.stdout, /^Provider: RateLimitError$/mu);
      assert.match(status.stdout, /^Reason: Rate limited;/mu);
      assert.match(status.stdout, /^Stage: Agent working$/mu);
      assert.match(status.stdout, /^Candidate output: Changed, but rejected$/mu);
      assert.match(status.stdout, /^Next: Address the cause recorded for this Run;/mu);
      assert.doesNotMatch(status.stdout, /runner -- retry --run/u);
      assert.doesNotMatch(
        status.stdout,
        /private-status-token|raw-header-secret|must-not-survive|authorization|bearer|raw_metadata/iu
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("never persists raw rejected output, including standalone credential formats", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-observation-sensitive-"));
    const runnerDatabasePath = join(directory, "runner.db");
    const sensitiveContent =
      'export const aws = "AKIAIOSFODNN7EXAMPLE";\n' +
      'export const github = "ghp_0123456789abcdefghijklmnopqrstuvwxyz";\n' +
      'export const webhook = "whsec_0123456789abcdefghijklmnopqrstuvwxyz";\n';
    try {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function*() {
            const store = yield* RunnerStore;
            yield* store.initialize;
            const enqueued = yield* store.enqueue({
              approvedPlan: approvedCreatePlan(["src/sensitive.ts"]),
              repositoryRoot: "/tmp/score-observation-store-fixture",
              adapter: {
                kind: "opencode",
                providerId: "test-provider",
                modelId: "test-model",
                variantId: null,
                sdkVersion: "0.0.0-next-17111",
                cliVersion: "0.0.0-next-17111"
              },
              maxConcurrency: 1
            });
            yield* store.beginWork(enqueued.runId);
            const claimed = yield* store.claimNext(enqueued.runId);
            assert.ok(claimed);
            yield* store.completeFailure({
              job: claimed,
              failureEvidence: {
                category: "workspace integrity",
                stage: null,
                name: "ghp_0123456789abcdefghijklmnopqrstuvwxyz",
                status: "error",
                statusCode: null,
                reason: "Workspace inspection rejected raw output"
              },
              targetOutputState: "different",
              targetOutputDigest: sha256Bytes(sensitiveContent),
              diagnosticContent: sensitiveContent,
            });
            return {
              run: yield* store.inspectRun(enqueued.runId),
              candidates: yield* store.readCandidates(enqueued.runId)
            };
          }).pipe(Effect.provide(RunnerStoreLive(runnerDatabasePath)))
        )
      );
      const file = result.run.observation.files[0];

      assert.ok(file);
      assert.deepEqual(result.candidates, []);
      assert.equal(file.rejectedOutputDigest, sha256Bytes(sensitiveContent));
      assert.equal(file.rejectedOutputPath, null);
      assert.equal(file.failureMessage, "Workspace inspection rejected raw output");
      assert.equal(file.failureStage, "starting");
      assert.deepEqual(file.terminalOutcome, {
        kind: "workspace",
        status: "error",
        statusCode: null,
        name: null
      });
      assert.equal(existsSync(`${runnerDatabasePath}.diagnostics`), false);
      assert.doesNotMatch(
        JSON.stringify(result.run.observation),
        /AKIAIOSFODNN7EXAMPLE|ghp_|whsec_/u
      );
      const database = new Database(runnerDatabasePath, { readonly: true });
      const stored = database
        .prepare(
          `SELECT failure_message AS failureMessage,
                  terminal_outcome_json AS terminalOutcomeJson,
                  failure_evidence_json AS failureEvidenceJson
           FROM runner_attempts WHERE attempt_id = ?`
        )
        .get(file.attemptId) as {
        failureMessage: string;
        terminalOutcomeJson: string;
        failureEvidenceJson: string;
      };
      database.close();
      assert.equal(stored.failureMessage, "Workspace inspection rejected raw output");
      assert.doesNotMatch(stored.terminalOutcomeJson, /ghp_/u);
      assert.doesNotMatch(stored.failureEvidenceJson, /ghp_|AKIA|whsec_/u);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("never persists a credential-shaped runtime session ID on success", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-observation-session-id-"));
    const runnerDatabasePath = join(directory, "runner.db");
    const credentialId = "ghp_0123456789abcdefghijklmnopqrstuvwxyz";
    try {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function*() {
            const store = yield* RunnerStore;
            yield* store.initialize;
            const enqueued = yield* store.enqueue({
              approvedPlan: approvedCreatePlan(["src/session.ts"]),
              repositoryRoot: "/tmp/score-observation-store-fixture",
              adapter: {
                kind: "opencode",
                providerId: "test-provider",
                modelId: "test-model",
                variantId: null,
                sdkVersion: "0.0.0-next-17111",
                cliVersion: "0.0.0-next-17111"
              },
              maxConcurrency: 1
            });
            yield* store.beginWork(enqueued.runId);
            const claimed = yield* store.claimNext(enqueued.runId);
            assert.ok(claimed);
            yield* store.completeSuccess({
              job: claimed,
              content: "export const safe = true;\n",
              runtimeSessionId: credentialId
            });
            return yield* store.inspectRun(enqueued.runId);
          }).pipe(Effect.provide(RunnerStoreLive(runnerDatabasePath)))
        )
      );
      assert.equal(result.observation.files[0]?.runtimeSessionId, null);
      const database = new Database(runnerDatabasePath, { readonly: true });
      const stored = database
        .prepare(
          `SELECT runtime_session_id AS runtimeSessionId FROM runner_attempts LIMIT 1`
        )
        .get() as { runtimeSessionId: string | null };
      database.close();
      assert.equal(stored.runtimeSessionId, null);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reopens the retained adapter failure-category and target-state matrix", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-observation-matrix-"));
    const runnerDatabasePath = join(directory, "runner.db");
    const cases = [
      {
        path: "src/provider.ts",
        category: "provider",
        state: "present",
        failureStage: "Agent working"
      },
      {
        path: "src/tool.ts",
        category: "tool",
        state: "present",
        failureStage: "Agent working"
      },
      {
        path: "src/timeout.ts",
        category: "timeout",
        state: "not observed",
        failureStage: "Agent working"
      },
      {
        path: "src/missing.ts",
        category: "missing output",
        state: "missing",
        failureStage: "checking output"
      },
      {
        path: "src/workspace.ts",
        category: "workspace integrity",
        state: "present",
        failureStage: "checking output"
      }
    ] as const;
    try {
      const runId = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function*() {
            const store = yield* RunnerStore;
            yield* store.initialize;
            const enqueued = yield* store.enqueue({
              approvedPlan: approvedCreatePlan(cases.map((entry) => entry.path)),
              repositoryRoot: "/tmp/score-observation-store-fixture",
              adapter: {
                kind: "opencode",
                providerId: "test-provider",
                modelId: "test-model",
                variantId: "medium",
                sdkVersion: "0.0.0-next-17111",
                cliVersion: "0.0.0-next-17111"
              },
              maxConcurrency: cases.length
            });
            yield* store.beginWork(enqueued.runId);
            for (const entry of cases) {
              const claimed = yield* store.claimNext(enqueued.runId);
              assert.ok(claimed);
              assert.equal(claimed.targetPath, entry.path);
              yield* store.recordAttemptObservation({
                job: claimed,
                stage: entry.failureStage,
                source: "runtime adapter",
                runtimeSessionId: `session-${entry.category.replaceAll(" ", "-")}`
              });
              yield* store.completeFailure({
                job: claimed,
                failureEvidence: {
                  category: entry.category,
                  stage: null,
                  name: null,
                  status: entry.category === "timeout" ? "aborted" : "error",
                  statusCode: null,
                  reason: `${entry.category} fixture failure`
                },
                runtimeSessionId: `session-${entry.category.replaceAll(" ", "-")}`,
                targetOutputState: entry.state,
                ...(entry.category === "workspace integrity"
                  ? { diagnosticContent: "export const rejected = true;\n" }
                  : {})
              });
            }
            yield* store.finalizeRun(enqueued.runId);
            return enqueued.runId;
          }).pipe(Effect.provide(RunnerStoreLive(runnerDatabasePath)))
        )
      );
      const reopened = await inspectStoredRun(runnerDatabasePath, runId);

      for (const entry of cases) {
        const file = reopened.observation.files.find(
          (candidate) => candidate.targetPath === entry.path
        );
        assert.ok(file);
        assert.equal(file.stage, "failed");
        assert.equal(file.failureCategory, entry.category);
        assert.equal(file.failureEvidence?.category, entry.category);
        assert.equal(
          file.failureEvidence?.status,
          entry.category === "timeout" ? "aborted" : "error"
        );
        assert.equal(file.failureStage, entry.failureStage);
        assert.equal(file.targetOutputState, entry.state);
        assert.equal(
          file.runtimeSessionId,
          `session-${entry.category.replaceAll(" ", "-")}`
        );
        assert.doesNotMatch(file.failureMessage ?? "", /matrix-secret/u);
      }
      assert.equal(reopened.observation.phase, "not applied");
      assert.doesNotMatch(
        JSON.stringify(reopened.observation),
        /matrix-secret|must-not-survive|privateMetadata/u
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("advances whole-Run phases monotonically and retains sanitized terminal failure", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-observation-phases-"));
    const runnerDatabasePath = join(directory, "runner.db");
    try {
      const result = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function*() {
            const store = yield* RunnerStore;
            yield* store.initialize;
            const enqueued = yield* store.enqueue({
              approvedPlan: approvedCreatePlan(["src/only.ts"]),
              repositoryRoot: "/tmp/score-observation-store-fixture",
              adapter: {
                kind: "opencode",
                providerId: "test-provider",
                modelId: "test-model",
                variantId: "medium",
                sdkVersion: "0.0.0-next-17111",
                cliVersion: "0.0.0-next-17111"
              },
              maxConcurrency: 1
            });
            yield* store.recordRunPhase({
              runId: enqueued.runId,
              phase: "checking current target state"
            });
            const currentState = yield* store.inspectRun(enqueued.runId);
            yield* store.recordRunPhase({
              runId: enqueued.runId,
              phase: "checking the complete set"
            });
            const completeSet = yield* store.inspectRun(enqueued.runId);
            const stalePhaseError = yield* Effect.flip(
              store.recordRunPhase({
                runId: enqueued.runId,
                phase: "checking current target state"
              })
            );
            yield* store.recordRunFailure({
              runId: enqueued.runId,
              phase: "not applied",
              failureCategory: "candidate integrity"
            });
            const failed = yield* store.inspectRun(enqueued.runId);
            const latePhaseError = yield* Effect.flip(
              store.recordRunPhase({
                runId: enqueued.runId,
                phase: "applying all candidates"
              })
            );
            return { currentState, completeSet, stalePhaseError, failed, latePhaseError };
          }).pipe(Effect.provide(RunnerStoreLive(runnerDatabasePath)))
        )
      );

      assert.deepEqual(
        [
          result.currentState.observation.phase,
          result.currentState.observation.sequence,
          result.completeSet.observation.phase,
          result.completeSet.observation.sequence
        ],
        ["checking current target state", 1, "checking the complete set", 2]
      );
      assert.equal(result.stalePhaseError._tag, "RunnerStoreError");
      assert.equal(result.failed.observation.phase, "not applied");
      assert.equal(result.failed.observation.sequence, 3);
      assert.equal(result.failed.observation.failureCategory, "candidate integrity");
      assert.equal(
        result.failed.observation.failureMessage,
        "Candidate-set integrity failure."
      );
      assert.ok(result.failed.observation.terminalAt);
      assert.equal(result.failed.observation.application.filesApplied, false);
      assert.equal(result.latePhaseError._tag, "RunnerStoreError");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("folds authoritative Run and application transitions into the same observation", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-observation-application-"));
    const runnerDatabasePath = join(directory, "runner.db");
    try {
      const snapshots = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function*() {
            const store = yield* RunnerStore;
            yield* store.initialize;
            const enqueued = yield* store.enqueue({
              approvedPlan: approvedCreatePlan(["src/only.ts"]),
              repositoryRoot: "/tmp/score-observation-store-fixture",
              adapter: {
                kind: "opencode",
                providerId: "test-provider",
                modelId: "test-model",
                variantId: "medium",
                sdkVersion: "0.0.0-next-17111",
                cliVersion: "0.0.0-next-17111"
              },
              maxConcurrency: 1
            });
            yield* store.beginWork(enqueued.runId);
            const claimed = yield* store.claimNext(enqueued.runId);
            assert.ok(claimed);
            yield* store.completeSuccess({
              job: claimed,
              content: "candidate\n",
              runtimeSessionId: "successful-session"
            });
            yield* store.finalizeRun(enqueued.runId);
            const finalized = yield* store.inspectRun(enqueued.runId);
            yield* store.recordRunFailure({
              runId: enqueued.runId,
              phase: "not applied",
              failureCategory: "candidate integrity"
            });
            const failedCheck = yield* store.inspectRun(enqueued.runId);
            yield* store.recordRunPhase({
              runId: enqueued.runId,
              phase: "checking current target state"
            });
            const currentState = yield* store.inspectRun(enqueued.runId);
            yield* store.recordRunPhase({
              runId: enqueued.runId,
              phase: "checking the complete set"
            });
            const checked = yield* store.inspectRun(enqueued.runId);
            yield* store.beginApplication(enqueued.runId);
            const applying = yield* store.inspectRun(enqueued.runId);
            yield* store.failApplication({
              runId: enqueued.runId,
              failureCategory: "application"
            });
            const failedApplication = yield* store.inspectRun(enqueued.runId);
            yield* store.recordRunPhase({
              runId: enqueued.runId,
              phase: "checking current target state"
            });
            const rechecking = yield* store.inspectRun(enqueued.runId);
            yield* store.recordRunPhase({
              runId: enqueued.runId,
              phase: "checking the complete set"
            });
            yield* store.beginApplication(enqueued.runId);
            const reapplying = yield* store.inspectRun(enqueued.runId);
            yield* store.completeApplication(enqueued.runId);
            const applied = yield* store.inspectRun(enqueued.runId);
            return {
              runId: enqueued.runId,
              finalized,
              failedCheck,
              currentState,
              checked,
              applying,
              failedApplication,
              rechecking,
              reapplying,
              applied
            };
          }).pipe(Effect.provide(RunnerStoreLive(runnerDatabasePath)))
        )
      );
      const reopened = await inspectStoredRun(runnerDatabasePath, snapshots.runId);

      assert.equal(snapshots.finalized.observation.phase, "generating candidates");
      assert.equal(snapshots.failedCheck.observation.phase, "not applied");
      assert.equal(
        snapshots.failedCheck.observation.failureCategory,
        "candidate integrity"
      );
      assert.ok(snapshots.failedCheck.observation.terminalAt);
      assert.equal(snapshots.currentState.observation.phase, "checking current target state");
      assert.equal(snapshots.currentState.observation.failureCategory, null);
      assert.equal(snapshots.currentState.observation.failureMessage, null);
      assert.equal(snapshots.currentState.observation.terminalAt, null);
      assert.equal(snapshots.checked.observation.phase, "checking the complete set");
      assert.equal(snapshots.applying.observation.phase, "applying all candidates");
      assert.deepEqual(snapshots.applying.observation.application, {
        state: "applying",
        appliedAt: null,
        filesApplied: null
      });
      assert.equal(snapshots.failedApplication.observation.phase, "application failed");
      assert.equal(snapshots.failedApplication.observation.failureCategory, "application");
      assert.equal(snapshots.failedApplication.observation.application.filesApplied, null);
      assert.equal(
        snapshots.failedApplication.observation.failureMessage,
        "Atomic application failure; repository recovery may be required."
      );
      assert.ok(snapshots.failedApplication.observation.terminalAt);
      assert.equal(snapshots.rechecking.observation.phase, "checking current target state");
      assert.equal(snapshots.rechecking.observation.failureCategory, null);
      assert.equal(snapshots.rechecking.observation.failureMessage, null);
      assert.equal(snapshots.rechecking.observation.terminalAt, null);
      assert.equal(snapshots.reapplying.observation.phase, "applying all candidates");
      assert.equal(snapshots.reapplying.observation.failureCategory, null);
      assert.equal(snapshots.reapplying.observation.failureMessage, null);
      assert.equal(snapshots.reapplying.observation.terminalAt, null);
      assert.equal(snapshots.applied.observation.phase, "applied");
      assert.equal(snapshots.applied.observation.application.filesApplied, true);
      assert.ok(snapshots.applied.observation.terminalAt);
      assert.equal(
        snapshots.applied.observation.terminalAt,
        snapshots.applied.observation.application.appliedAt
      );
      assert.deepEqual(reopened.observation, snapshots.applied.observation);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("retains ambiguous recovery as needs-attention evidence without redelivery", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-observation-recovery-"));
    const runnerDatabasePath = join(directory, "runner.db");
    try {
      const recovered = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function*() {
            const store = yield* RunnerStore;
            yield* store.initialize;
            const enqueued = yield* store.enqueue({
              approvedPlan: approvedCreatePlan(["src/only.ts"]),
              repositoryRoot: "/tmp/score-observation-store-fixture",
              adapter: {
                kind: "opencode",
                providerId: "test-provider",
                modelId: "test-model",
                variantId: "medium",
                sdkVersion: "0.0.0-next-17111",
                cliVersion: "0.0.0-next-17111"
              },
              maxConcurrency: 1
            });
            yield* store.beginWork(enqueued.runId);
            const claimed = yield* store.claimNext(enqueued.runId);
            assert.ok(claimed);
            yield* store.recordAttemptObservation({
              job: claimed,
              stage: "Agent working",
              source: "runtime adapter",
              runtimeSessionId: "ambiguous-session"
            });
            assert.equal(yield* store.recoverRun(enqueued.runId), 1);
            return yield* store.inspectRun(enqueued.runId);
          }).pipe(Effect.provide(RunnerStoreLive(runnerDatabasePath)))
        )
      );
      const file = recovered.observation.files[0];
      assert.ok(file);
      assert.equal(recovered.state, "pending");
      assert.equal(file.stage, "needs attention");
      assert.equal(file.source, "recovery");
      assert.equal(file.sequence, 3);
      assert.equal(file.runtimeSessionId, "ambiguous-session");
      assert.equal(file.failureCategory, "ambiguous recovery");
      assert.equal(file.failureStage, "Agent working");
      assert.equal(file.targetOutputState, "not observed");
      assert.ok(file.terminalAt);
      assert.equal(file.observedAt, file.terminalAt);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
