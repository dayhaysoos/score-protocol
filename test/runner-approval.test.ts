import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { Effect } from "effect";
import Database from "better-sqlite3";

import { sha256Json } from "../src/canonical.js";
import { createAcceptedInputPacket } from "../src/fixture-inputs.js";
import {
  enqueueApprovedPlan,
  inspectRun,
  inspectRunner,
  prepareRepositoryForPlan
} from "../src/runner/runner.js";
import { ScoreAlpha } from "../src/score-alpha.js";
import { RunnerStore, RunnerStoreLive } from "../src/runner/runner-store.js";
import { RunId } from "../src/runner/domain.js";
import {
  createFixtureGitRepository,
  createFixtureProjectDirectory
} from "./helpers/git-repository.js";

function readBundle(): unknown {
  return JSON.parse(
    readFileSync(join(process.cwd(), "fixtures", "account-status.bundle.json"), "utf8")
  );
}

function taggedError(error: unknown): { readonly _tag?: string; readonly operation?: string } {
  return error as { readonly _tag?: string; readonly operation?: string };
}

describe("approval-gated Runner enqueue", () => {
  it("automatically saves a verified repository and reuses it on later starts", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-project-binding-"));
    const scoreDatabasePath = join(directory, "score.db");
    const runnerDatabasePath = join(directory, "runner.db");
    try {
      const repositoryRoot = createFixtureProjectDirectory(directory);
      const unrelatedRepository = join(directory, "unrelated-repository");
      mkdirSync(unrelatedRepository);
      execFileSync("git", ["init", "--quiet", unrelatedRepository]);
      writeFileSync(join(unrelatedRepository, "README.md"), "unrelated\n", "utf8");

      const score = ScoreAlpha.open(scoreDatabasePath);
      score.initializeAcceptedInputs(createAcceptedInputPacket());
      const submitted = score.submitCompilation(readBundle(), {
        compiler_name: "codex-existing-agent",
        model_id: "openai/gpt-5",
        received_at: "2026-08-07T17:40:00.000Z",
        label: "automatic-project-binding"
      });
      assert.ok(submitted.manifest_id);
      const review = score.prepareReview(
        submitted.manifest_id,
        "2026-08-07T17:41:00.000Z"
      );
      score.close();

      const initialFailure = await Effect.runPromise(
        Effect.flip(
          prepareRepositoryForPlan({
            scoreDatabasePath,
            runnerDatabasePath,
            passId: review.digest_set.pass.protocol_id,
            invokingDirectory: unrelatedRepository
          })
        )
      );
      const first = await Effect.runPromise(
        prepareRepositoryForPlan({
          scoreDatabasePath,
          runnerDatabasePath,
          passId: review.digest_set.pass.protocol_id,
          invokingDirectory: repositoryRoot
        })
      );
      const schemaPath = join(repositoryRoot, "src", "schema.ts");
      const approvedSchema = readFileSync(schemaPath, "utf8");
      rmSync(schemaPath);
      const strictMissingFailure = await Effect.runPromise(
        Effect.flip(
          prepareRepositoryForPlan({
            scoreDatabasePath,
            runnerDatabasePath,
            passId: review.digest_set.pass.protocol_id,
            invokingDirectory: repositoryRoot
          })
        )
      );
      const recoverableMissing = await Effect.runPromise(
        prepareRepositoryForPlan({
          scoreDatabasePath,
          runnerDatabasePath,
          passId: review.digest_set.pass.protocol_id,
          invokingDirectory: repositoryRoot,
          recoverMissingReplacements: true
        })
      );
      writeFileSync(schemaPath, approvedSchema, "utf8");
      const recoveredReplacement = await Effect.runPromise(
        prepareRepositoryForPlan({
          scoreDatabasePath,
          runnerDatabasePath,
          passId: review.digest_set.pass.protocol_id,
          invokingDirectory: repositoryRoot,
          recoverMissingReplacements: true
        })
      );
      const invalidOverride = await Effect.runPromise(
        Effect.flip(
          prepareRepositoryForPlan({
            scoreDatabasePath,
            runnerDatabasePath,
            passId: review.digest_set.pass.protocol_id,
            invokingDirectory: repositoryRoot,
            repositoryOverride: unrelatedRepository
          })
        )
      );
      const reused = await Effect.runPromise(
        prepareRepositoryForPlan({
          scoreDatabasePath,
          runnerDatabasePath,
          passId: review.digest_set.pass.protocol_id,
          invokingDirectory: unrelatedRepository
        })
      );
      const alternateParent = join(directory, "alternate");
      mkdirSync(alternateParent);
      const alternateRepository = createFixtureGitRepository(alternateParent);
      const rebound = await Effect.runPromise(
        prepareRepositoryForPlan({
          scoreDatabasePath,
          runnerDatabasePath,
          passId: review.digest_set.pass.protocol_id,
          invokingDirectory: unrelatedRepository,
          repositoryOverride: alternateRepository
        })
      );
      const reusedAfterRebind = await Effect.runPromise(
        prepareRepositoryForPlan({
          scoreDatabasePath,
          runnerDatabasePath,
          passId: review.digest_set.pass.protocol_id,
          invokingDirectory: unrelatedRepository
        })
      );

      assert.equal(initialFailure.name, "RepositoryDriftError");
      assert.equal(first.repositoryRoot, realpathSync(repositoryRoot));
      assert.deepEqual(first.missingReplacementPaths, []);
      assert.equal(strictMissingFailure.name, "RepositoryDriftError");
      assert.deepEqual(recoverableMissing, {
        repositoryRoot: realpathSync(repositoryRoot),
        missingReplacementPaths: ["src/schema.ts"]
      });
      assert.deepEqual(recoveredReplacement.missingReplacementPaths, []);
      assert.equal(invalidOverride.name, "RepositoryDriftError");
      assert.equal(reused.repositoryRoot, realpathSync(repositoryRoot));
      assert.equal(rebound.repositoryRoot, realpathSync(alternateRepository));
      assert.equal(
        reusedAfterRebind.repositoryRoot,
        realpathSync(alternateRepository)
      );
      assert.equal(
        ScoreAlpha.listReviewedChangePlans(scoreDatabasePath)[0]?.approvalStatus,
        "needs_approval"
      );
      assert.deepEqual(await Effect.runPromise(inspectRunner(runnerDatabasePath)), {
        runs: 0,
        jobs: 0,
        attempts: 0
      });

      const plan = ScoreAlpha.listReviewedChangePlans(scoreDatabasePath)[0];
      assert.ok(plan);
      ScoreAlpha.approveReviewedChangePlan(scoreDatabasePath, {
        plan,
        authority: "local-cli:test-user",
        decidedAt: "2026-08-07T17:42:00.000Z"
      });
      const enqueued = await Effect.runPromise(
        enqueueApprovedPlan({
          scoreDatabasePath,
          runnerDatabasePath,
          passId: plan.passId,
          adapter: {
            kind: "opencode",
            providerId: "test-provider",
            modelId: "test-model",
            variantId: null,
            sdkVersion: "0.0.0-next-17111",
            cliVersion: "0.0.0-next-17111"
          },
          maxConcurrency: 5
        })
      );
      const run = await Effect.runPromise(inspectRun(runnerDatabasePath, enqueued.runId));
      assert.equal(run.repositoryRoot, realpathSync(alternateRepository));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("lists reviewed Changes by human title and approves the selected exact revision without a human rationale", () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-guided-approval-"));
    const scoreDatabasePath = join(directory, "score.db");
    try {
      const score = ScoreAlpha.open(scoreDatabasePath);
      score.initializeAcceptedInputs(createAcceptedInputPacket());
      const submitted = score.submitCompilation(readBundle(), {
        compiler_name: "codex-existing-agent",
        model_id: "openai/gpt-5",
        received_at: "2026-08-06T14:00:00.000Z",
        label: "guided-approval"
      });
      assert.ok(submitted.manifest_id);
      score.prepareReview(submitted.manifest_id, "2026-08-06T14:01:00.000Z");
      score.close();

      const plans = ScoreAlpha.listReviewedChangePlans(scoreDatabasePath);
      assert.equal(plans.length, 1);
      assert.deepEqual(
        {
          label: plans[0]?.label,
          objective: plans[0]?.objective,
          files: plans[0]?.files,
          approvalStatus: plans[0]?.approvalStatus,
          warningCount: plans[0]?.warningCount
        },
        {
          label: "Account Status two-file change",
          objective:
            "Add the accepted account status declaration and pure account label formatter without changing any other file.",
          files: ["src/account-label.ts", "src/schema.ts"],
          approvalStatus: "needs_approval",
          warningCount: 0
        }
      );
      const selected = plans[0];
      assert.ok(selected);
      ScoreAlpha.approveReviewedChangePlan(scoreDatabasePath, {
        plan: selected,
        authority: "local-cli:test-user",
        decidedAt: "2026-08-06T14:02:00.000Z"
      });
      assert.equal(
        ScoreAlpha.listReviewedChangePlans(scoreDatabasePath)[0]?.approvalStatus,
        "approved"
      );
      assert.equal(
        ScoreAlpha.readApprovedPass(scoreDatabasePath, selected.passId).pass_id,
        selected.passId
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does not create or migrate a missing SCORE database while checking approval", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-missing-score-"));
    const scoreDatabasePath = join(directory, "missing-score.db");
    const runnerDatabasePath = join(directory, "runner.db");
    try {
      const error = await Effect.runPromise(
        Effect.flip(
          enqueueApprovedPlan({
            scoreDatabasePath,
            runnerDatabasePath,
            passId: "missing-pass",
            adapter: {
              kind: "opencode",
              providerId: "test-provider",
              modelId: "test-model",
              variantId: null,
              sdkVersion: "0.0.0-next-17111",
              cliVersion: "0.0.0-next-17111"
            },
            maxConcurrency: 1
          })
        )
      );
      assert.equal(taggedError(error)._tag, "PlanNotApproved");
      assert.equal(existsSync(scoreDatabasePath), false);
      assert.deepEqual(await Effect.runPromise(inspectRunner(runnerDatabasePath)), {
        runs: 0,
        jobs: 0,
        attempts: 0
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("migrates an existing pre-application Runner database without changing old Runs", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-schema-migration-"));
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
          "legacy-run",
          "legacy-pass",
          "legacy-review",
          "legacy-decision",
          "legacy-authority",
          "2026-08-06T12:00:00.000Z",
          "opencode",
          "legacy-provider",
          "legacy-model",
          "0.0.0-next-17111",
          "0.0.0-next-17111",
          2,
          "completed",
          "2026-08-06T12:01:00.000Z"
        );
      database.close();

      assert.deepEqual(await Effect.runPromise(inspectRunner(runnerDatabasePath)), {
        runs: 1,
        jobs: 0,
        attempts: 0
      });
      const historicalRun = await Effect.runPromise(
        inspectRun(runnerDatabasePath, RunId.make("legacy-run"))
      );
      assert.equal(historicalRun.adapter.variantId, null);
      assert.deepEqual(historicalRun.acceptedMissingReplacementPaths, []);
      assert.deepEqual(historicalRun.confirmedTargets, []);
      const migrated = new Database(runnerDatabasePath, { readonly: true });
      const columns = migrated
        .prepare("PRAGMA table_info(runner_runs)")
        .all()
        .map((row) => (row as { name: string }).name);
      assert.ok(columns.includes("repository_root"));
      assert.ok(columns.includes("source_snapshot_json"));
      assert.ok(columns.includes("application_state"));
      assert.ok(columns.includes("applied_at"));
      assert.ok(columns.includes("variant_id"));
      assert.ok(columns.includes("confirmed_targets_json"));
      const legacy = migrated
        .prepare(
          `SELECT approved_pass_id, state, repository_root, source_snapshot_json,
                  confirmed_targets_json, application_state, applied_at, variant_id
           FROM runner_runs WHERE run_id = 'legacy-run'`
        )
        .get();
      const bindingTable = migrated
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'table' AND name = 'runner_repository_bindings'`
        )
        .get();
      const acceptedMissingTable = migrated
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'table' AND name = 'runner_accepted_missing_replacements'`
        )
        .get();
      migrated.close();
      assert.deepEqual(legacy, {
        approved_pass_id: "legacy-pass",
        state: "completed",
        repository_root: null,
        source_snapshot_json: null,
        confirmed_targets_json: null,
        application_state: "not_applied",
        applied_at: null,
        variant_id: null
      });
      assert.deepEqual(bindingTable, { name: "runner_repository_bindings" });
      assert.deepEqual(acceptedMissingTable, {
        name: "runner_accepted_missing_replacements"
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("refuses to create Runner tables inside the SCORE database", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-boundary-"));
    const databasePath = join(directory, "score.db");
    try {
      ScoreAlpha.open(databasePath).close();
      const error = await Effect.runPromise(
        Effect.flip(
          enqueueApprovedPlan({
            scoreDatabasePath: databasePath,
            runnerDatabasePath: databasePath,
            passId: "not-reached",
            adapter: {
              kind: "opencode",
              providerId: "test-provider",
              modelId: "test-model",
              variantId: null,
              sdkVersion: "0.0.0-next-17111",
              cliVersion: "0.0.0-next-17111"
            },
            maxConcurrency: 1
          })
        )
      );

      assert.equal(taggedError(error)._tag, "RunnerStoreError");
      assert.equal(taggedError(error).operation, "databaseBoundary");
      const database = new Database(databasePath, { readonly: true });
      const runnerTables = database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'runner_%'"
        )
        .all();
      database.close();
      assert.deepEqual(runnerTables, []);

      const inspectionError = await Effect.runPromise(
        Effect.flip(inspectRunner(databasePath))
      );
      assert.equal(inspectionError._tag, "RunnerStoreError");
      assert.equal(inspectionError.operation, "initialize");
      const inspectionDatabase = new Database(databasePath, { readonly: true });
      const tablesAfterInspection = inspectionDatabase
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'runner_%'"
        )
        .all();
      inspectionDatabase.close();
      assert.deepEqual(tablesAfterInspection, []);

      const hardLinkPath = join(directory, "score-hard-link.db");
      linkSync(databasePath, hardLinkPath);
      const hardLinkError = await Effect.runPromise(
        Effect.flip(
          enqueueApprovedPlan({
            scoreDatabasePath: databasePath,
            runnerDatabasePath: hardLinkPath,
            passId: "not-reached",
            adapter: {
              kind: "opencode",
              providerId: "test-provider",
              modelId: "test-model",
              variantId: null,
              sdkVersion: "0.0.0-next-17111",
              cliVersion: "0.0.0-next-17111"
            },
            maxConcurrency: 1
          })
        )
      );
      assert.equal(taggedError(hardLinkError)._tag, "RunnerStoreError");
      assert.equal(taggedError(hardLinkError).operation, "databaseBoundary");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects an unapproved Change before creating any Run or Job", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-unapproved-"));
    const scoreDatabasePath = join(directory, "score.db");
    const runnerDatabasePath = join(directory, "runner.db");
    try {
      const score = ScoreAlpha.open(scoreDatabasePath);
      score.initializeAcceptedInputs(createAcceptedInputPacket());
      const submitted = score.submitCompilation(readBundle(), {
        compiler_name: "codex-existing-agent",
        model_id: "openai/gpt-5",
        received_at: "2026-08-06T15:00:00.000Z",
        label: "runner-unapproved"
      });
      assert.ok(submitted.manifest_id);
      const review = score.prepareReview(
        submitted.manifest_id ?? "",
        "2026-08-06T15:01:00.000Z"
      );
      score.close();

      const error = await Effect.runPromise(
        Effect.flip(
          enqueueApprovedPlan({
            scoreDatabasePath,
            runnerDatabasePath,
            passId: review.digest_set.pass.protocol_id,
            adapter: {
              kind: "opencode",
              providerId: "test-provider",
              modelId: "test-model",
              variantId: null,
              sdkVersion: "0.0.0-next-17111",
              cliVersion: "0.0.0-next-17111"
            },
            maxConcurrency: 5
          })
        )
      );

      assert.equal(taggedError(error)._tag, "PlanNotApproved");
      const state = await Effect.runPromise(inspectRunner(runnerDatabasePath));
      assert.deepEqual(state, {
        runs: 0,
        jobs: 0,
        attempts: 0
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("freezes one pending Job per approved Agent Package", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-approved-"));
    const scoreDatabasePath = join(directory, "score.db");
    const runnerDatabasePath = join(directory, "runner.db");
    try {
      const repositoryRoot = createFixtureGitRepository(directory);
      const score = ScoreAlpha.open(scoreDatabasePath);
      score.initializeAcceptedInputs(createAcceptedInputPacket());
      const submitted = score.submitCompilation(readBundle(), {
        compiler_name: "codex-existing-agent",
        model_id: "openai/gpt-5",
        received_at: "2026-08-06T15:10:00.000Z",
        label: "runner-approved"
      });
      assert.ok(submitted.manifest_id);
      const review = score.prepareReview(
        submitted.manifest_id ?? "",
        "2026-08-06T15:11:00.000Z"
      );
      score.decidePublication({
        review_id: review.review_id,
        authority: "test-human-authority",
        decided_at: "2026-08-06T15:12:00.000Z",
        decision: "approve",
        expected_digest_set: review.digest_set,
        warning_waivers: [],
        rationale: "Synthetic approval in an isolated Runner test database."
      });
      const approved = score.exportApprovedPass(review.digest_set.pass.protocol_id);
      score.close();

      const enqueued = await Effect.runPromise(
        enqueueApprovedPlan({
          scoreDatabasePath,
          runnerDatabasePath,
          passId: review.digest_set.pass.protocol_id,
          repositoryRoot,
          adapter: {
            kind: "opencode",
            providerId: "test-provider",
            modelId: "test-model",
            variantId: "fast",
            sdkVersion: "0.0.0-next-17111",
            cliVersion: "0.0.0-next-17111"
          },
          maxConcurrency: 5
        })
      );

      assert.equal(enqueued.passId, review.digest_set.pass.protocol_id);
      assert.equal(enqueued.jobCount, 2);
      const run = await Effect.runPromise(inspectRun(runnerDatabasePath, enqueued.runId));
      assert.equal(run.repositoryRoot, realpathSync(repositoryRoot));
      assert.equal(run.sourceSnapshotId, approved.source_snapshot.revision_id);
      assert.equal(run.sourceSnapshotDigest, approved.source_snapshot.content_digest);
      assert.equal(run.applicationState, "not_applied");
      assert.equal(run.appliedAt, null);
      assert.deepEqual(
        {
          passId: run.passId,
          state: run.state,
          adapter: run.adapter,
          maxConcurrency: run.maxConcurrency,
          jobs: run.jobs.map((job) => ({
            targetPath: job.targetPath,
            operation: job.operation,
            state: job.state,
            packageDigest: job.packageDigest
          }))
        },
        {
          passId: review.digest_set.pass.protocol_id,
          state: "pending",
          adapter: {
            kind: "opencode",
            providerId: "test-provider",
            modelId: "test-model",
            variantId: "fast",
            sdkVersion: "0.0.0-next-17111",
            cliVersion: "0.0.0-next-17111"
          },
          maxConcurrency: 5,
          jobs: approved.payloads
            .toSorted((left, right) => left.target_path.localeCompare(right.target_path))
            .map((payload) => ({
              targetPath: payload.target_path,
              operation: payload.operation,
              state: "pending",
              packageDigest: payload.payload_digest
            }))
        }
      );

      writeFileSync(join(repositoryRoot, "src/schema.ts"), "// stale repository\n", "utf8");
      writeFileSync(
        join(repositoryRoot, "src", "unexpected; file.ts"),
        "// unexpected\n",
        "utf8"
      );
      const driftDatabasePath = join(directory, "drift-runner.db");
      const driftError = await Effect.runPromise(
        Effect.flip(
          enqueueApprovedPlan({
            scoreDatabasePath,
            runnerDatabasePath: driftDatabasePath,
            passId: review.digest_set.pass.protocol_id,
            repositoryRoot,
            adapter: {
              kind: "opencode",
              providerId: "test-provider",
              modelId: "test-model",
              variantId: null,
              sdkVersion: "0.0.0-next-17111",
              cliVersion: "0.0.0-next-17111"
            },
            maxConcurrency: 1
          })
        )
      );
      assert.equal(driftError.name, "RepositoryDriftError");
      assert.deepEqual(
        "findings" in driftError ? driftError.findings : [],
        [{ kind: "changed", path: "src/schema.ts" }]
      );
      assert.deepEqual(await Effect.runPromise(inspectRunner(driftDatabasePath)), {
        runs: 0,
        jobs: 0,
        attempts: 0
      });

      const incompatible = structuredClone(approved);
      const incompatiblePayload = incompatible.payloads[0];
      assert.ok(incompatiblePayload);
      const agentInput = incompatiblePayload.agent_input as {
        required_capabilities: Array<{
          configuration: { shell: boolean };
        }>;
      };
      const capability = agentInput.required_capabilities[0];
      assert.ok(capability);
      capability.configuration.shell = true;
      incompatiblePayload.payload = {
        control: incompatiblePayload.control,
        agent_input: incompatiblePayload.agent_input
      };
      incompatiblePayload.agent_input_digest = sha256Json(incompatiblePayload.agent_input);
      incompatiblePayload.payload_digest = sha256Json(incompatiblePayload.payload);
      const incompatibleDatabasePath = join(directory, "incompatible-runner.db");
      const compatibilityError = await Effect.runPromise(
        Effect.flip(
          Effect.scoped(
            Effect.gen(function*() {
              const store = yield* RunnerStore;
              yield* store.initialize;
              return yield* store.enqueue({
                approvedPlan: incompatible,
                repositoryRoot: directory,
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
            }).pipe(Effect.provide(RunnerStoreLive(incompatibleDatabasePath)))
          )
        )
      );
      assert.equal(compatibilityError._tag, "AdapterCompatibilityError");
      assert.match(compatibilityError.message, /cannot satisfy/);
      assert.deepEqual(await Effect.runPromise(inspectRunner(incompatibleDatabasePath)), {
        runs: 0,
        jobs: 0,
        attempts: 0
      });

      const staleBase = structuredClone(approved);
      const stalePayload = staleBase.payloads[0];
      assert.ok(stalePayload);
      const staleControl = stalePayload.control as { base_revision_id: string };
      staleControl.base_revision_id = "different-source-snapshot";
      stalePayload.payload = {
        control: stalePayload.control,
        agent_input: stalePayload.agent_input
      };
      stalePayload.control_digest = sha256Json(stalePayload.control);
      stalePayload.payload_digest = sha256Json(stalePayload.payload);
      const staleDatabasePath = join(directory, "stale-base-runner.db");
      const staleError = await Effect.runPromise(
        Effect.flip(
          Effect.scoped(
            Effect.gen(function*() {
              const store = yield* RunnerStore;
              yield* store.initialize;
              return yield* store.enqueue({
                approvedPlan: staleBase,
                repositoryRoot: directory,
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
            }).pipe(Effect.provide(RunnerStoreLive(staleDatabasePath)))
          )
        )
      );
      assert.equal(staleError._tag, "AdapterCompatibilityError");
      assert.match(staleError.message, /do not bind the approved Source Snapshot/);
      assert.deepEqual(await Effect.runPromise(inspectRunner(staleDatabasePath)), {
        runs: 0,
        jobs: 0,
        attempts: 0
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
