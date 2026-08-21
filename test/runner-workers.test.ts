import assert from "node:assert/strict";
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
import { join } from "node:path";
import { describe, it } from "node:test";

import { Effect, Layer } from "effect";
import Database from "better-sqlite3";

import { canonicalJson, sha256Bytes, sha256Json } from "../src/canonical.js";
import { formatRunApplicationSummary } from "../src/runner/application-summary.js";
import { createAcceptedInputPacket } from "../src/fixture-inputs.js";
import { repositoryRevisionContentDigest } from "../src/repository-source-state.js";
import {
  AdapterInvocationError,
  RuntimeAdapter
} from "../src/runner/runtime-adapter.js";
import type { RuntimeAttemptFact } from "../src/runner/runtime-attempt-observation.js";
import {
  enqueueApprovedPlan,
  applyRunCandidates,
  exportRunCandidates,
  inspectRun,
  inspectRunner,
  recoverRun,
  runPendingJobs,
  runPendingJobsAndApply
} from "../src/runner/runner.js";
import {
  JobId,
  RunnerStoreError,
  type RunObservation
} from "../src/runner/domain.js";
import { RunnerStore, RunnerStoreLive } from "../src/runner/runner-store.js";
import { ScoreAlpha } from "../src/score-alpha.js";
import type { ApprovedPassExport } from "../src/score-alpha.js";
import { createFixtureGitRepository } from "./helpers/git-repository.js";

function testRuntimeAdapter(
  input: Pick<typeof RuntimeAdapter.Service, "invoke">
): typeof RuntimeAdapter.Service {
  return RuntimeAdapter.of({
    ...input,
    withRun: (use) => use(input.invoke)
  });
}

function readBundle(): unknown {
  return JSON.parse(
    readFileSync(join(process.cwd(), "fixtures", "account-status.bundle.json"), "utf8")
  );
}

function singleCreateApprovedPlan(): ApprovedPassExport {
  const control = {
    protocol: {
      bundle_schema: "score.compilation-bundle@0.1.0-alpha.5",
      profile: "score.coding@0.1.0-alpha.5",
      canonicalization: "RFC 8785",
      digest_algorithm: "SHA-256"
    },
    target_path: "src/only.ts",
    operation: "create",
    base_revision_id: "source-snapshot-only",
    base_revision_digest: repositoryRevisionContentDigest({
      orderedManifest: []
    }),
    allowed_effects: [{ kind: "create_file", path: "src/only.ts" }]
  };
  const agentInput = {
    target: {
      path: "src/only.ts",
      operation: "create",
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
          target_path: "src/only.ts"
        }
      }
    ],
    declarations: {
      owned: [
        {
          name: "Only",
          declaration: "export interface Only { value: string; }",
          description: "The public value owned by this module."
        }
      ],
      consumed: []
    }
  };
  const payload = { control, agent_input: agentInput };
  return {
    schema: "score.approved-pass-export",
    version: "0.1.0-alpha.6",
    pass_id: "approved-pass",
    publication: {
      review_id: "review",
      decision_id: "decision",
      authority: "test-human-authority",
      decided_at: "2026-08-06T16:20:00.000Z"
    },
    source_snapshot: {
      revision_id: "source-snapshot-only",
      content_digest: repositoryRevisionContentDigest({
        orderedManifest: []
      }),
      files: []
    },
    payloads: [
      {
        payload_id: "payload",
        target_path: "src/only.ts",
        operation: "create",
        control,
        agent_input: agentInput,
        payload,
        control_digest: sha256Json(control),
        agent_input_digest: sha256Json(agentInput),
        payload_digest: sha256Json(payload)
      }
    ]
  };
}

describe("Runner worker pool", () => {
  it("keeps candidate delivery unchanged when nonterminal recording and observer delivery fail or hang", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-no-project-verification-"));
    const repositoryPath = join(directory, "repository");
    const runnerDatabasePath = join(directory, "runner.db");
    const candidate = "export interface Only { this is deliberately invalid TypeScript;\n";
    try {
      mkdirSync(repositoryPath);
      const repositoryRoot = realpathSync(repositoryPath);
      const enqueued = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function*() {
            const store = yield* RunnerStore;
            yield* store.initialize;
            return yield* store.enqueue({
              approvedPlan: singleCreateApprovedPlan(),
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
            });
          }).pipe(Effect.provide(RunnerStoreLive(runnerDatabasePath)))
        )
      );
      const database = new Database(runnerDatabasePath);
      database.exec(`CREATE TRIGGER reject_candidate_ready_observation
        BEFORE UPDATE OF observed_stage ON runner_attempts
        WHEN NEW.observed_stage = 'candidate ready'
        BEGIN
          SELECT RAISE(ABORT, 'synthetic nonterminal observation failure');
        END`);
      database.close();
      const adapterLayer = Layer.succeed(
        RuntimeAdapter,
        testRuntimeAdapter({
          invoke: (_job, reporter) =>
            Effect.gen(function*() {
              const report = (fact: RuntimeAttemptFact) =>
                reporter === undefined
                  ? Effect.void
                  : reporter.report(fact).pipe(Effect.catchCause(() => Effect.void));
              yield* report({
                kind: "runtime_session_created",
                runtimeSessionId: "no-project-verification-session"
              });
              yield* report({
                kind: "agent_input_admitted",
                runtimeSessionId: "no-project-verification-session"
              });
              yield* report({
                kind: "workspace_inspection_started",
                runtimeSessionId: "no-project-verification-session"
              });
              return {
                content: candidate,
                runtimeSessionId: "no-project-verification-session",
                targetOutputState: "present",
                targetOutputDigest: sha256Bytes(candidate)
              };
            })
        })
      );
      const observations: RunObservation[] = [];

      const completed = await Effect.runPromise(
        runPendingJobsAndApply(runnerDatabasePath, enqueued.runId, {
          observer: {
            update: (observation) => {
              observations.push(observation);
              if (observation.files.every((file) => file.stage === "waiting")) {
                throw new Error("synthetic observer failure");
              }
              if (observation.phase === "applied") return Effect.never;
              return new Promise<void>(() => undefined);
            }
          }
        }).pipe(
          Effect.provide(adapterLayer)
        )
      );

      assert.equal(completed.state, "completed");
      assert.equal(completed.applicationState, "applied");
      assert.equal(observations[0]?.files[0]?.stage, "waiting");
      assert.ok(observations.some((observation) => observation.files[0]?.stage === "Agent working"));
      assert.equal(completed.observation.phase, "applied");
      assert.equal(readFileSync(join(repositoryRoot, "src", "only.ts"), "utf8"), candidate);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("fails closed when adapter-wide terminal failure evidence cannot be retained", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-terminal-adapter-evidence-"));
    const runnerDatabasePath = join(directory, "runner.db");
    try {
      const enqueued = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function*() {
            const store = yield* RunnerStore;
            yield* store.initialize;
            return yield* store.enqueue({
              approvedPlan: singleCreateApprovedPlan(),
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
          }).pipe(Effect.provide(RunnerStoreLive(runnerDatabasePath)))
        )
      );
      const database = new Database(runnerDatabasePath);
      database.exec(`CREATE TRIGGER reject_run_failure_evidence
        BEFORE UPDATE OF run_failure_category ON runner_runs
        WHEN NEW.run_failure_category IS NOT NULL
        BEGIN
          SELECT RAISE(ABORT, 'synthetic terminal evidence persistence failure');
        END`);
      database.close();
      const adapterFailure = new AdapterInvocationError({
        jobId: JobId.make("adapter-run-scope"),
        message: "Synthetic adapter-wide startup failure",
        failureEvidence: {
          category: "runtime",
          stage: null,
          name: null,
          status: null,
          statusCode: null,
          reason: "Synthetic adapter-wide startup failure"
        },
        targetOutputState: "not observed"
      });
      const adapterLayer = Layer.succeed(
        RuntimeAdapter,
        RuntimeAdapter.of({
          invoke: () => Effect.fail(adapterFailure),
          withRun: () => Effect.fail(adapterFailure)
        })
      );

      const error = await Effect.runPromise(
        Effect.flip(
          runPendingJobs(runnerDatabasePath, enqueued.runId).pipe(
            Effect.provide(adapterLayer)
          )
        )
      );
      assert.equal(error._tag, "RunnerStoreError");
      assert.equal(error.operation, "recordRunFailure");
      const inspection = new Database(runnerDatabasePath, { readonly: true });
      const retained = inspection
        .prepare(
          `SELECT run_failure_category AS failureCategory,
                  run_failure_message AS failureMessage, terminal_at AS terminalAt
           FROM runner_runs WHERE run_id = ?`
        )
        .get(enqueued.runId);
      inspection.close();
      assert.deepEqual(retained, {
        failureCategory: null,
        failureMessage: null,
        terminalAt: null
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("never renders raw adapter-wide failure prose through RunnerStoreError", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-safe-adapter-error-"));
    const runnerDatabasePath = join(directory, "runner.db");
    try {
      const enqueued = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function*() {
            const store = yield* RunnerStore;
            yield* store.initialize;
            return yield* store.enqueue({
              approvedPlan: singleCreateApprovedPlan(),
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
          }).pipe(Effect.provide(RunnerStoreLive(runnerDatabasePath)))
        )
      );
      const rawFailure = new AdapterInvocationError({
        jobId: JobId.make("adapter-run-scope-private"),
        message:
          "Provider failed with ghp_abcdefghijklmnopqrstuvwxyz1234567890; " +
          'raw_metadata={"private":true,"tenant":"secret"}',
        failureEvidence: {
          category: "runtime",
          stage: null,
          name: null,
          status: null,
          statusCode: null,
          reason:
            "Provider failed with ghp_abcdefghijklmnopqrstuvwxyz1234567890; " +
            'raw_metadata={"private":true,"tenant":"secret"}'
        },
        targetOutputState: "not observed"
      });
      const adapterLayer = Layer.succeed(
        RuntimeAdapter,
        RuntimeAdapter.of({
          invoke: () => Effect.fail(rawFailure),
          withRun: () => Effect.fail(rawFailure)
        })
      );

      const error = await Effect.runPromise(
        Effect.flip(
          runPendingJobs(runnerDatabasePath, enqueued.runId).pipe(
            Effect.provide(adapterLayer)
          )
        )
      );
      assert.equal(error._tag, "RunnerStoreError");
      assert.equal(error.operation, "runAdapter");
      assert.equal(
        error.message,
        "Runtime failure. Inspect Runner status for retained evidence."
      );
      assert.doesNotMatch(
        error.message,
        /ghp_|raw_metadata|private|tenant|secret/iu
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("never applies when target-drift failure evidence cannot be retained", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-terminal-drift-evidence-"));
    const repositoryPath = join(directory, "repository");
    const runnerDatabasePath = join(directory, "runner.db");
    const manualContent = "export const manuallyAdded = true;\n";
    try {
      mkdirSync(repositoryPath);
      const repositoryRoot = realpathSync(repositoryPath);
      const enqueued = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function*() {
            const store = yield* RunnerStore;
            yield* store.initialize;
            return yield* store.enqueue({
              approvedPlan: singleCreateApprovedPlan(),
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
            });
          }).pipe(Effect.provide(RunnerStoreLive(runnerDatabasePath)))
        )
      );
      const adapterLayer = Layer.succeed(
        RuntimeAdapter,
        testRuntimeAdapter({
          invoke: () =>
            Effect.succeed({
              content: "export const generated = true;\n",
              runtimeSessionId: "target-drift-session"
            })
        })
      );
      await Effect.runPromise(
        runPendingJobs(runnerDatabasePath, enqueued.runId).pipe(
          Effect.provide(adapterLayer)
        )
      );
      mkdirSync(join(repositoryRoot, "src"));
      const targetPath = join(repositoryRoot, "src", "only.ts");
      writeFileSync(targetPath, manualContent, "utf8");
      const database = new Database(runnerDatabasePath);
      database.exec(`CREATE TRIGGER reject_run_failure_evidence
        BEFORE UPDATE OF run_failure_category ON runner_runs
        WHEN NEW.run_failure_category IS NOT NULL
        BEGIN
          SELECT RAISE(ABORT, 'synthetic terminal evidence persistence failure');
        END`);
      database.close();

      const error = await Effect.runPromise(
        Effect.flip(applyRunCandidates(runnerDatabasePath, enqueued.runId))
      );
      assert.ok(error instanceof RunnerStoreError);
      assert.equal(error._tag, "RunnerStoreError");
      assert.equal(error.operation, "recordRunFailure");
      assert.equal(readFileSync(targetPath, "utf8"), manualContent);
      const inspection = new Database(runnerDatabasePath, { readonly: true });
      const retained = inspection
        .prepare(
          `SELECT application_state AS applicationState,
                  run_failure_category AS failureCategory,
                  run_failure_message AS failureMessage, terminal_at AS terminalAt
           FROM runner_runs WHERE run_id = ?`
        )
        .get(enqueued.runId);
      inspection.close();
      assert.deepEqual(retained, {
        applicationState: "not_applied",
        failureCategory: null,
        failureMessage: null,
        terminalAt: null
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("refuses preexisting alpha.4 Jobs before claim or agent execution", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-legacy-policy-"));
    const repositoryPath = join(directory, "repository");
    const runnerDatabasePath = join(directory, "runner.db");
    try {
      mkdirSync(repositoryPath);
      const repositoryRoot = realpathSync(repositoryPath);
      const enqueued = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function*() {
            const store = yield* RunnerStore;
            yield* store.initialize;
            return yield* store.enqueue({
              approvedPlan: singleCreateApprovedPlan(),
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
            });
          }).pipe(Effect.provide(RunnerStoreLive(runnerDatabasePath)))
        )
      );

      const database = new Database(runnerDatabasePath);
      const frozen = database
        .prepare(
          `SELECT control_json AS controlJson, agent_input_json AS agentInputJson,
                  package_json AS packageJson
           FROM runner_jobs WHERE run_id = ?`
        )
        .get(enqueued.runId) as {
        controlJson: string;
        agentInputJson: string;
        packageJson: string;
      };
      const control = JSON.parse(frozen.controlJson) as Record<string, unknown> & {
        protocol: Record<string, unknown>;
      };
      control.protocol.bundle_schema = "score.compilation-bundle@0.1.0-alpha.4";
      control.protocol.profile = "score.coding@0.1.0-alpha.4";
      control.project_settings_digest = "sha256:legacy-project-settings";
      const agentInput = JSON.parse(frozen.agentInputJson) as Record<string, unknown>;
      agentInput.project_settings = { language: "typescript" };
      const packageEnvelope = JSON.parse(frozen.packageJson) as Record<string, unknown>;
      packageEnvelope.control = control;
      packageEnvelope.agent_input = agentInput;
      database.exec("DROP TRIGGER runner_jobs_reject_frozen_package_update");
      database
        .prepare(
          `UPDATE runner_jobs
           SET control_json = ?, agent_input_json = ?, package_json = ?,
               control_digest = ?, agent_input_digest = ?, package_digest = ?
           WHERE run_id = ?`
        )
        .run(
          canonicalJson(control),
          canonicalJson(agentInput),
          canonicalJson(packageEnvelope),
          sha256Json(control),
          sha256Json(agentInput),
          sha256Json(packageEnvelope),
          enqueued.runId
        );
      database.close();

      const claimError = await Effect.runPromise(
        Effect.flip(
          Effect.scoped(
            Effect.gen(function*() {
              const store = yield* RunnerStore;
              yield* store.initialize;
              return yield* store.claimNext(enqueued.runId);
            }).pipe(Effect.provide(RunnerStoreLive(runnerDatabasePath)))
          )
        )
      );
      assert.equal(claimError._tag, "RunnerStoreError");
      assert.equal(claimError.operation, "claimNext");
      assert.match(claimError.message, /unsupported frozen Agent Package protocol.*alpha\.5/i);

      let invocationCount = 0;
      const adapterLayer = Layer.succeed(
        RuntimeAdapter,
        testRuntimeAdapter({
          invoke: () =>
            Effect.sync(() => {
              invocationCount += 1;
              return {
                content: "opaque legacy candidate\n",
                runtimeSessionId: "must-not-run"
              };
            })
        })
      );
      const runError = await Effect.runPromise(
        Effect.flip(
          runPendingJobs(runnerDatabasePath, enqueued.runId).pipe(
            Effect.provide(adapterLayer)
          )
        )
      );
      assert.equal(runError._tag, "RunnerStoreError");
      assert.equal(runError.operation, "beginWork");
      assert.match(runError.message, /unsupported frozen Agent Package protocol.*alpha\.5/i);
      assert.equal(invocationCount, 0);

      const inspection = new Database(runnerDatabasePath, { readonly: true });
      assert.deepEqual(
        inspection.prepare("SELECT state FROM runner_runs WHERE run_id = ?").get(enqueued.runId),
        { state: "pending" }
      );
      assert.deepEqual(
        inspection.prepare("SELECT state FROM runner_jobs WHERE run_id = ?").get(enqueued.runId),
        { state: "pending" }
      );
      assert.deepEqual(inspection.prepare("SELECT COUNT(*) AS count FROM runner_attempts").get(), {
        count: 0
      });
      inspection.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects removed Project Settings and legacy declaration metadata at enqueue", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-legacy-fields-"));
    const repositoryPath = join(directory, "repository");
    const runnerDatabasePath = join(directory, "runner.db");
    try {
      mkdirSync(repositoryPath);
      const repositoryRoot = realpathSync(repositoryPath);
      const mutations = [
        {
          message: /Agent Input contains removed Project Settings/i,
          apply: (plan: ApprovedPassExport) => {
            const payload = plan.payloads[0] as unknown as Record<string, unknown>;
            const agentInput = payload.agent_input as Record<string, unknown>;
            agentInput.project_settings = { language: "typescript" };
          }
        },
        {
          message: /documented declaration.*exactly name, declaration, and description/i,
          apply: (plan: ApprovedPassExport) => {
            const payload = plan.payloads[0] as unknown as Record<string, unknown>;
            const agentInput = payload.agent_input as Record<string, unknown>;
            const declarations = agentInput.declarations as {
              owned: Array<Record<string, unknown>>;
            };
            declarations.owned[0]!.declaration_id = "legacy-declaration";
          }
        },
        {
          message: /Run Rules contain removed Project Settings/i,
          apply: (plan: ApprovedPassExport) => {
            const payload = plan.payloads[0] as unknown as Record<string, unknown>;
            const control = payload.control as Record<string, unknown>;
            control.project_settings_digest = "sha256:legacy-project-settings";
          }
        },
        {
          message: /Source Snapshot contains removed Project Settings/i,
          apply: (plan: ApprovedPassExport) => {
            const snapshot = plan.source_snapshot as unknown as Record<string, unknown>;
            snapshot.project_settings = { language: "typescript" };
          }
        }
      ] as const;

      for (const mutation of mutations) {
        const approvedPlan = structuredClone(singleCreateApprovedPlan());
        mutation.apply(approvedPlan);
        const payload = approvedPlan.payloads[0] as unknown as Record<string, unknown>;
        const control = payload.control;
        const agentInput = payload.agent_input;
        payload.payload = { control, agent_input: agentInput };
        payload.control_digest = sha256Json(control);
        payload.agent_input_digest = sha256Json(agentInput);
        payload.payload_digest = sha256Json(payload.payload);

        const error = await Effect.runPromise(
          Effect.flip(
            Effect.scoped(
              Effect.gen(function*() {
                const store = yield* RunnerStore;
                yield* store.initialize;
                return yield* store.enqueue({
                  approvedPlan,
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
                });
              }).pipe(Effect.provide(RunnerStoreLive(runnerDatabasePath)))
            )
          )
        );
        assert.equal(error._tag, "AdapterCompatibilityError");
        assert.match(error.message, mutation.message);
      }

      assert.deepEqual(await Effect.runPromise(inspectRunner(runnerDatabasePath)), {
        runs: 0,
        jobs: 0,
        attempts: 0
      });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("exports a complete candidate set without running project TypeScript verification", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-export-no-verification-"));
    const runnerDatabasePath = join(directory, "runner.db");
    const candidate =
      'import type { ExternalValue } from "@project/dependency";\n' +
      "export interface Only { value: string; }\n";
    try {
      const enqueued = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function*() {
            const store = yield* RunnerStore;
            yield* store.initialize;
            return yield* store.enqueue({
              approvedPlan: singleCreateApprovedPlan(),
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
          }).pipe(Effect.provide(RunnerStoreLive(runnerDatabasePath)))
        )
      );
      const adapterLayer = Layer.succeed(
        RuntimeAdapter,
        testRuntimeAdapter({
          invoke: () =>
            Effect.succeed({
              content: candidate,
              runtimeSessionId: "export-no-verification-session"
            })
        })
      );

      const completed = await Effect.runPromise(
        runPendingJobs(runnerDatabasePath, enqueued.runId).pipe(
          Effect.provide(adapterLayer)
        )
      );
      assert.equal(completed.state, "completed");
      const database = new Database(runnerDatabasePath);
      assert.throws(
        () =>
          database
            .prepare("UPDATE runner_jobs SET agent_input_json = '{}' WHERE run_id = ?")
            .run(enqueued.runId),
        /runner Job package is frozen/
      );
      database.close();

      const candidateDirectory = join(directory, "candidates");
      assert.deepEqual(
        await Effect.runPromise(
          exportRunCandidates(runnerDatabasePath, enqueued.runId, candidateDirectory)
        ),
        { destinationPath: candidateDirectory, fileCount: 1 }
      );
      assert.equal(readFileSync(join(candidateDirectory, "src", "only.ts"), "utf8"), candidate);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("exports candidate content without interpreting declaration ownership", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-declarations-"));
    const runnerDatabasePath = join(directory, "runner.db");
    try {
      const enqueued = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function*() {
            const store = yield* RunnerStore;
            yield* store.initialize;
            return yield* store.enqueue({
              approvedPlan: singleCreateApprovedPlan(),
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
          }).pipe(Effect.provide(RunnerStoreLive(runnerDatabasePath)))
        )
      );
      const candidate =
        "export interface Only { value: string; }\nexport function duplicate(): void {}\n";
      const adapterLayer = Layer.succeed(
        RuntimeAdapter,
        testRuntimeAdapter({
          invoke: () =>
            Effect.succeed({
              content: candidate,
              runtimeSessionId: "declaration-session"
            })
        })
      );

      const completed = await Effect.runPromise(
        runPendingJobs(runnerDatabasePath, enqueued.runId).pipe(
          Effect.provide(adapterLayer)
        )
      );

      assert.equal(completed.state, "completed");
      assert.equal(completed.jobs[0]?.state, "succeeded");
      const candidateDirectory = join(directory, "candidates");
      assert.deepEqual(
        await Effect.runPromise(
          exportRunCandidates(runnerDatabasePath, enqueued.runId, candidateDirectory)
        ),
        { destinationPath: candidateDirectory, fileCount: 1 }
      );
      assert.equal(readFileSync(join(candidateDirectory, "src", "only.ts"), "utf8"), candidate);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("surfaces candidate persistence failure without rewriting it as an adapter failure", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-persistence-"));
    const runnerDatabasePath = join(directory, "runner.db");
    try {
      const enqueued = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function*() {
            const store = yield* RunnerStore;
            yield* store.initialize;
            return yield* store.enqueue({
              approvedPlan: singleCreateApprovedPlan(),
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
          }).pipe(Effect.provide(RunnerStoreLive(runnerDatabasePath)))
        )
      );
      const database = new Database(runnerDatabasePath);
      database.exec(`CREATE TRIGGER reject_candidate_persistence
        BEFORE UPDATE OF state ON runner_attempts
        WHEN NEW.state = 'succeeded'
        BEGIN
          SELECT RAISE(ABORT, 'synthetic candidate persistence failure');
        END`);
      database.close();
      const adapterLayer = Layer.succeed(
        RuntimeAdapter,
        testRuntimeAdapter({
          invoke: () =>
            Effect.succeed({
              content: "export interface Only { value: string; }\n",
              runtimeSessionId: "persistence-session"
            })
        })
      );

      const error = await Effect.runPromise(
        Effect.flip(
          runPendingJobs(runnerDatabasePath, enqueued.runId).pipe(
            Effect.provide(adapterLayer)
          )
        )
      );
      assert.equal(error._tag, "RunnerStoreError");
      assert.equal(error.operation, "completeSuccess");
      const inspection = new Database(runnerDatabasePath, { readonly: true });
      const attempt = inspection
        .prepare("SELECT state, failure_tag FROM runner_attempts")
        .get() as { state: string; failure_tag: string | null };
      const job = inspection.prepare("SELECT state FROM runner_jobs").get() as {
        state: string;
      };
      inspection.close();
      assert.deepEqual(attempt, { state: "running", failure_tag: null });
      assert.equal(job.state, "running");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it(
    "runs independent Jobs concurrently and retains one failure without cancelling its sibling",
    { timeout: 5_000 },
    async () => {
      const directory = mkdtempSync(join(tmpdir(), "score-runner-workers-"));
      const scoreDatabasePath = join(directory, "score.db");
      const runnerDatabasePath = join(directory, "runner.db");
      try {
        const repositoryRoot = createFixtureGitRepository(directory);
        const score = ScoreAlpha.open(scoreDatabasePath);
        score.initializeAcceptedInputs(createAcceptedInputPacket());
        const submitted = score.submitCompilation(readBundle(), {
          compiler_name: "codex-existing-agent",
          model_id: "openai/gpt-5",
          received_at: "2026-08-06T16:00:00.000Z",
          label: "runner-workers"
        });
        assert.ok(submitted.manifest_id);
        const review = score.prepareReview(
          submitted.manifest_id ?? "",
          "2026-08-06T16:01:00.000Z"
        );
        score.decidePublication({
          review_id: review.review_id,
          authority: "test-human-authority",
          decided_at: "2026-08-06T16:02:00.000Z",
          decision: "approve",
          expected_digest_set: review.digest_set,
          warning_waivers: [],
          rationale: "Synthetic approval in an isolated worker test database."
        });
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
            maxConcurrency: 2
          })
        );

        let active = 0;
        let maximumActive = 0;
        let started = 0;
        let runScopes = 0;
        let runScopeReleased = false;
        const claimedVariants: Array<string | null> = [];
        const claimedJobs: Array<{
          readonly attemptId: string;
          readonly controlJson: string;
          readonly agentInputJson: string;
          readonly packageDigest: string;
          readonly adapter: unknown;
        }> = [];
        const observations: RunObservation[] = [];
        let releaseBarrier: (() => void) | undefined;
        const barrier = new Promise<void>((resolve) => {
          releaseBarrier = resolve;
        });
        let releaseFirstWorking: (() => void) | undefined;
        const firstWorking = new Promise<void>((resolve) => {
          releaseFirstWorking = resolve;
        });
        const invoke: typeof RuntimeAdapter.Service["invoke"] = (job, reporter) =>
              Effect.tryPromise({
                try: async () => {
                  const report = async (fact: RuntimeAttemptFact) => {
                    await Effect.runPromise(
                      (reporter?.report(fact) ?? Effect.void).pipe(
                        Effect.catchCause(() => Effect.void)
                      )
                    );
                  };
                  claimedVariants.push(job.adapter.variantId);
                  claimedJobs.push({
                    attemptId: job.attemptId,
                    controlJson: job.controlJson,
                    agentInputJson: job.agentInputJson,
                    packageDigest: job.packageDigest,
                    adapter: job.adapter
                  });
                  active += 1;
                  maximumActive = Math.max(maximumActive, active);
                  started += 1;
                  if (started === 2) releaseBarrier?.();
                  if (job.targetPath === "src/schema.ts") await firstWorking;
                  const runtimeSessionId = `synthetic-${job.targetPath}`;
                  await report({ kind: "runtime_session_created", runtimeSessionId });
                  await report({ kind: "agent_input_admitted", runtimeSessionId });
                  if (job.targetPath === "src/account-label.ts") releaseFirstWorking?.();
                  await barrier;
                  await report({
                    kind: "workspace_inspection_started",
                    runtimeSessionId
                  });
                  active -= 1;
                  if (job.targetPath === "src/schema.ts") {
                    throw new AdapterInvocationError({
                      jobId: job.jobId,
                      message: "Synthetic provider interruption",
                      failureEvidence: {
                        category: "interruption",
                        stage: null,
                        name: "AbortError",
                        status: "aborted",
                        statusCode: null,
                        reason: "Synthetic provider interruption"
                      },
                      runtimeSessionId: "synthetic-interrupted-session",
                      targetOutputState: "not observed"
                    });
                  }
                  return {
                    content:
                      'import type { Account } from "./schema.js";\n\nexport function formatAccountLabel(account: Account): string {\n  return `${account.name} [${account.status}]`;\n}\n',
                    runtimeSessionId: "synthetic-session"
                  };
                },
                catch: (cause) =>
                  cause instanceof AdapterInvocationError
                    ? cause
                    : new AdapterInvocationError({
                        jobId: job.jobId,
                        message: cause instanceof Error ? cause.message : String(cause),
                        failureEvidence: {
                          category: "runtime",
                          stage: null,
                          name: null,
                          status: null,
                          statusCode: null,
                          reason: cause instanceof Error ? cause.message : String(cause)
                        },
                        targetOutputState: "not observed"
                      })
              });
        const adapterLayer = Layer.succeed(
          RuntimeAdapter,
          RuntimeAdapter.of({
            invoke,
            withRun: (use) =>
              Effect.acquireUseRelease(
                Effect.sync(() => {
                  runScopes += 1;
                }),
                () => use(invoke),
                () =>
                  Effect.sync(() => {
                    runScopeReleased = true;
                  })
              )
          })
        );

        const completed = await Effect.runPromise(
          runPendingJobsAndApply(runnerDatabasePath, enqueued.runId, {
            observer: { update: (observation) => observations.push(observation) }
          }).pipe(
            Effect.provide(adapterLayer)
          )
        );

        assert.equal(maximumActive, 2);
        assert.ok(
          observations[0]?.files.every((file) => file.stage === "waiting"),
          "every Job should be visible as waiting before the first claim"
        );
        assert.ok(
          observations.some((observation) => {
            const account = observation.files.find(
              (file) => file.targetPath === "src/account-label.ts"
            );
            const schema = observation.files.find(
              (file) => file.targetPath === "src/schema.ts"
            );
            return (
              account?.stage === "Agent working" &&
              (schema?.stage === "waiting" || schema?.stage === "starting")
            );
          }),
          "concurrent Jobs should advance independently in the live read model"
        );
        assert.equal(runScopes, 1);
        assert.equal(runScopeReleased, true);
        assert.deepEqual(claimedVariants, ["fast", "fast"]);
        assert.equal(claimedJobs.length, 2);
        for (const job of claimedJobs) {
          assert.notEqual(job.attemptId, "");
          assert.match(job.controlJson, /score\.compilation-bundle@0\.1\.0-alpha\.5/);
          assert.match(job.agentInputJson, /score\.coding\.filesystem\.single-target/);
          assert.match(job.packageDigest, /^sha256:[a-f0-9]{64}$/u);
          assert.deepEqual(job.adapter, {
            kind: "opencode",
            providerId: "test-provider",
            modelId: "test-model",
            variantId: "fast",
            sdkVersion: "0.0.0-next-17111",
            cliVersion: "0.0.0-next-17111"
          });
        }
        assert.equal(completed.state, "completed_with_failures");
        assert.deepEqual(
          completed.jobs.map((job) => [job.targetPath, job.state]),
          [
            ["src/account-label.ts", "succeeded"],
            ["src/schema.ts", "failed"]
          ]
        );
        const interrupted = completed.observation.files.find(
          (file) => file.targetPath === "src/schema.ts"
        );
        assert.equal(interrupted?.failureCategory, "interruption");
        assert.equal(interrupted?.runtimeSessionId, "synthetic-interrupted-session");
        assert.deepEqual(interrupted?.terminalOutcome, {
          kind: "interruption",
          status: "aborted",
          statusCode: null,
          name: "AbortError"
        });
        assert.equal(interrupted?.targetOutputState, "not observed");
        assert.equal(completed.observation.phase, "not applied");
        assert.equal(completed.observation.application.filesApplied, false);
        assert.deepEqual(observations.at(-1), completed.observation);
        assert.deepEqual(await Effect.runPromise(inspectRunner(runnerDatabasePath)), {
          runs: 1,
          jobs: 2,
          attempts: 2
        });
        const reopened = await Effect.runPromise(
          inspectRun(runnerDatabasePath, enqueued.runId)
        );
        assert.deepEqual(reopened, completed);
        assert.deepEqual(reopened.observation, observations.at(-1));
        assert.equal(
          readFileSync(join(repositoryRoot, "src/schema.ts"), "utf8"),
          createAcceptedInputPacket().repository_revision.files[0]?.content
        );
        assert.equal(existsSync(join(repositoryRoot, "src/account-label.ts")), false);
        const candidateDirectory = join(directory, "candidate-files");
        assert.deepEqual(
          await Effect.runPromise(
            exportRunCandidates(
              runnerDatabasePath,
              enqueued.runId,
              candidateDirectory
            )
          ),
          { destinationPath: candidateDirectory, fileCount: 1 }
        );
        assert.equal(
          readFileSync(join(candidateDirectory, "src/account-label.ts"), "utf8"),
          'import type { Account } from "./schema.js";\n\nexport function formatAccountLabel(account: Account): string {\n  return `${account.name} [${account.status}]`;\n}\n'
        );
        assert.equal(existsSync(join(candidateDirectory, "src/schema.ts")), false);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  );

  it("retains bounded sanitized evidence from an unfamiliar failing tool without storing rejected bytes", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-tool-failure-evidence-"));
    const runnerDatabasePath = join(directory, "runner.db");
    const rejectedContent = "export const rejectedCandidate = true;\n";
    const rejectedDigest = sha256Bytes(rejectedContent);
    try {
      const enqueued = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function*() {
            const store = yield* RunnerStore;
            yield* store.initialize;
            return yield* store.enqueue({
              approvedPlan: singleCreateApprovedPlan(),
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
          }).pipe(Effect.provide(RunnerStoreLive(runnerDatabasePath)))
        )
      );
      const adapterLayer = Layer.succeed(
        RuntimeAdapter,
        testRuntimeAdapter({
          invoke: (job) =>
            Effect.fail(
              new AdapterInvocationError({
                jobId: job.jobId,
                message:
                  "Contract inspection found 2 invalid exports; " +
                  "Authorization: Bearer fixture-tool-secret; " +
                  'arguments={\"path\":\"/Users/example/private/repo/src/only.ts\"}; ' +
                  'output={\"candidate\":\"private raw output\"}',
                failureEvidence: {
                  category: "tool",
                  stage: null,
                  name: "contract-inspector",
                  status: "error",
                  statusCode: 422,
                  reason:
                    "Contract inspection found 2 invalid exports; " +
                    "Authorization: Bearer fixture-tool-secret; " +
                    'arguments={"path":"/Users/example/private/repo/src/only.ts"}; ' +
                    'output={"candidate":"private raw output"}'
                },
                runtimeSessionId: "tool-failure-session",
                targetOutputState: "different",
                targetOutputDigest: rejectedDigest,
                diagnosticContent: rejectedContent
              })
            )
        })
      );

      const completed = await Effect.runPromise(
        runPendingJobs(runnerDatabasePath, enqueued.runId).pipe(
          Effect.provide(adapterLayer)
        )
      );
      const failed = completed.observation.files[0];
      assert.ok(failed);
      assert.equal(failed.failureCategory, "tool");
      assert.equal(failed.failureStage, "starting");
      assert.equal(failed.terminalOutcome?.name, "contract-inspector");
      assert.equal(failed.terminalOutcome?.status, "error");
      assert.equal(failed.terminalOutcome?.statusCode, 422);
      assert.match(failed.failureMessage ?? "", /Contract inspection found 2 invalid exports/u);
      assert.equal(failed.targetOutputState, "different");
      assert.equal(failed.rejectedOutputDigest, rejectedDigest);
      assert.deepEqual(failed.failureEvidence, {
        category: "tool",
        stage: "starting",
        name: "contract-inspector",
        status: "error",
        statusCode: 422,
        reason:
          "Contract inspection found 2 invalid exports; [REDACTED CREDENTIAL]; [REDACTED DATA]; [REDACTED DATA]"
      });

      const summary = formatRunApplicationSummary(completed);
      assert.match(summary, /^src\/only\.ts failed$/mu);
      assert.match(summary, /^Tool: contract-inspector$/mu);
      assert.match(summary, /^Reason: Contract inspection found 2 invalid exports;/mu);
      assert.match(summary, /^Stage: Starting$/mu);
      assert.match(summary, /^Candidate output: Changed, but rejected$/mu);
      assert.match(summary, new RegExp(`^Next: npm run runner -- retry --run ${enqueued.runId}$`, "mu"));
      assert.doesNotMatch(
        summary,
        /fixture-tool-secret|private raw output|arguments|\/Users\/example|rejectedCandidate/iu
      );

      const database = new Database(runnerDatabasePath, { readonly: true });
      const attempt = database
        .prepare(
          `SELECT candidate_content AS candidateContent,
                  failure_message AS failureMessage,
                  terminal_outcome_json AS terminalOutcomeJson,
                  failure_evidence_json AS failureEvidenceJson,
                  rejected_output_digest AS rejectedOutputDigest
           FROM runner_attempts`
        )
        .get() as {
          candidateContent: string | null;
          failureMessage: string | null;
          terminalOutcomeJson: string | null;
          failureEvidenceJson: string | null;
          rejectedOutputDigest: string | null;
        };
      database.close();
      assert.equal(attempt.candidateContent, null);
      assert.equal(attempt.rejectedOutputDigest, rejectedDigest);
      const durableEvidence = JSON.stringify(attempt);
      assert.doesNotMatch(
        durableEvidence,
        /fixture-tool-secret|private raw output|arguments|\/Users\/example|rejectedCandidate/iu
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("requires explicit recovery instead of re-delivering an ambiguous Attempt", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-recovery-"));
    const scoreDatabasePath = join(directory, "score.db");
    const runnerDatabasePath = join(directory, "runner.db");
    try {
      const repositoryRoot = createFixtureGitRepository(directory);
      const score = ScoreAlpha.open(scoreDatabasePath);
      score.initializeAcceptedInputs(createAcceptedInputPacket());
      const submitted = score.submitCompilation(readBundle(), {
        compiler_name: "codex-existing-agent",
        model_id: "openai/gpt-5",
        received_at: "2026-08-06T16:10:00.000Z",
        label: "runner-recovery"
      });
      assert.ok(submitted.manifest_id);
      const review = score.prepareReview(
        submitted.manifest_id ?? "",
        "2026-08-06T16:11:00.000Z"
      );
      score.decidePublication({
        review_id: review.review_id,
        authority: "test-human-authority",
        decided_at: "2026-08-06T16:12:00.000Z",
        decision: "approve",
        expected_digest_set: review.digest_set,
        warning_waivers: [],
        rationale: "Synthetic approval in an isolated recovery test database."
      });
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
            variantId: null,
            sdkVersion: "0.0.0-next-17111",
            cliVersion: "0.0.0-next-17111"
          },
          maxConcurrency: 1
        })
      );
      const abandoned = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function*() {
            const store = yield* RunnerStore;
            yield* store.initialize;
            return yield* store.claimNext(enqueued.runId);
          }).pipe(Effect.provide(RunnerStoreLive(runnerDatabasePath)))
        )
      );
      assert.equal(abandoned?.targetPath, "src/account-label.ts");

      let invocationCount = 0;
      const adapterLayer = Layer.succeed(
        RuntimeAdapter,
        testRuntimeAdapter({
          invoke: () =>
            Effect.sync(() => {
              invocationCount += 1;
              return {
                content:
                  'export interface Account {\n  id: string;\n  name: string;\n  status: "active" | "suspended";\n}\n',
                runtimeSessionId: "recovery-session"
              };
            })
        })
      );
      const blocked = await Effect.runPromise(
        Effect.flip(
          runPendingJobs(runnerDatabasePath, enqueued.runId).pipe(
            Effect.provide(adapterLayer)
          )
        )
      );
      assert.equal(blocked._tag, "RunRecoveryRequired");
      assert.equal(invocationCount, 0);

      assert.equal(
        await Effect.runPromise(recoverRun(runnerDatabasePath, enqueued.runId)),
        1
      );
      assert.ok(abandoned);
      const staleCompletion = await Effect.runPromise(
        Effect.flip(
          Effect.scoped(
            Effect.gen(function*() {
              const store = yield* RunnerStore;
              yield* store.initialize;
              return yield* store.completeSuccess({
                job: abandoned,
                content: "stale candidate\n",
                runtimeSessionId: "stale-session"
              });
            }).pipe(Effect.provide(RunnerStoreLive(runnerDatabasePath)))
          )
        )
      );
      assert.equal(staleCompletion._tag, "RunnerStoreError");
      assert.match(staleCompletion.message, /no longer running/);
      const completed = await Effect.runPromise(
        runPendingJobs(runnerDatabasePath, enqueued.runId).pipe(
          Effect.provide(adapterLayer)
        )
      );
      assert.equal(invocationCount, 1);
      assert.equal(completed.state, "completed_with_failures");
      assert.deepEqual(
        completed.jobs.map((job) => [job.targetPath, job.state]),
        [
          ["src/account-label.ts", "needs_attention"],
          ["src/schema.ts", "succeeded"]
        ]
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("round-trips authoritative OpenCode and Pi identities through the cli_version slot", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-adapter-identities-"));
    const runnerDatabasePath = join(directory, "runner.db");
    try {
      const enqueue = (adapter: Parameters<typeof RunnerStore.Service["enqueue"]>[0]["adapter"]) =>
        Effect.scoped(
          Effect.gen(function*() {
            const store = yield* RunnerStore;
            yield* store.initialize;
            return yield* store.enqueue({
              approvedPlan: singleCreateApprovedPlan(),
              repositoryRoot: directory,
              adapter,
              maxConcurrency: 1
            });
          }).pipe(Effect.provide(RunnerStoreLive(runnerDatabasePath)))
        );
      const historical = await Effect.runPromise(
        enqueue({
          kind: "opencode",
          providerId: "historical-provider",
          modelId: "historical-model",
          variantId: null,
          sdkVersion: "historical-sdk",
          cliVersion: "historical-cli"
        })
      );
      const current = await Effect.runPromise(
        enqueue({
          kind: "opencode",
          providerId: "current-provider",
          modelId: "current-model",
          variantId: null,
          sdkVersion: "current-sdk",
          cliVersion: "current-cli"
        })
      );
      const pi = await Effect.runPromise(
        enqueue({
          kind: "pi",
          providerId: "pi-provider",
          modelId: "pi-model",
          variantId: null,
          sdkVersion: "pi-sdk",
          workerProtocolVersion: "pi-worker@1"
        })
      );
      const database = new Database(runnerDatabasePath, { readonly: true });
      const rawRows = database.prepare(
        `SELECT run_id AS runId, adapter_kind AS adapterKind, variant_id AS variantId,
                cli_version AS cliVersion
         FROM runner_runs ORDER BY created_at, rowid`
      ).all();
      database.close();
      assert.deepEqual(rawRows, [
        { runId: historical.runId, adapterKind: "opencode", variantId: null, cliVersion: "historical-cli" },
        { runId: current.runId, adapterKind: "opencode", variantId: null, cliVersion: "current-cli" },
        { runId: pi.runId, adapterKind: "pi", variantId: null, cliVersion: "pi-worker@1" }
      ]);
      const historicalSnapshot = await Effect.runPromise(
        inspectRun(runnerDatabasePath, historical.runId)
      );
      const currentSnapshot = await Effect.runPromise(
        inspectRun(runnerDatabasePath, current.runId)
      );
      const piSnapshot = await Effect.runPromise(
        inspectRun(runnerDatabasePath, pi.runId)
      );
      assert.deepEqual(historicalSnapshot.adapter, {
        kind: "opencode", providerId: "historical-provider", modelId: "historical-model",
        variantId: null, sdkVersion: "historical-sdk", cliVersion: "historical-cli"
      });
      assert.deepEqual(currentSnapshot.adapter, {
        kind: "opencode", providerId: "current-provider", modelId: "current-model",
        variantId: null, sdkVersion: "current-sdk", cliVersion: "current-cli"
      });
      assert.deepEqual(piSnapshot.adapter, {
        kind: "pi", providerId: "pi-provider", modelId: "pi-model",
        variantId: null, sdkVersion: "pi-sdk", workerProtocolVersion: "pi-worker@1"
      });
      assert.deepEqual(historicalSnapshot.observation.runtimeVersion, {
        sdkVersion: "historical-sdk",
        cliVersion: "historical-cli"
      });
      assert.deepEqual(currentSnapshot.observation.runtimeVersion, {
        sdkVersion: "current-sdk",
        cliVersion: "current-cli"
      });
      assert.deepEqual(piSnapshot.observation.runtimeVersion, {
        sdkVersion: "pi-sdk",
        workerProtocolVersion: "pi-worker@1"
      });
      assert.equal("cliVersion" in piSnapshot.observation.runtimeVersion, false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects incompatible or malformed adapter selections before RuntimeAdapter input delivery", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-runner-adapter-gate-"));
      const runnerDatabasePath = join(directory, "runner.db");
    try {
      const incompatible = structuredClone(singleCreateApprovedPlan());
      const payload = incompatible.payloads[0] as unknown as Record<string, unknown>;
      const agentInput = payload.agent_input as {
        required_capabilities: Array<{ configuration: { allowed_operations: string[] } }>;
      };
      agentInput.required_capabilities[0]!.configuration.allowed_operations = ["shell"];
      payload.payload = { control: payload.control, agent_input: agentInput };
      payload.agent_input_digest = sha256Json(agentInput);
      payload.payload_digest = sha256Json(payload.payload);
      const incompatibleError = await Effect.runPromise(Effect.flip(
        Effect.scoped(Effect.gen(function*() {
          const store = yield* RunnerStore;
          yield* store.initialize;
          return yield* store.enqueue({
            approvedPlan: incompatible,
            repositoryRoot: directory,
            adapter: { kind: "pi", providerId: "pi", modelId: "model", variantId: null, sdkVersion: "sdk", workerProtocolVersion: "worker@1" },
            maxConcurrency: 1
          });
        }).pipe(Effect.provide(RunnerStoreLive(runnerDatabasePath))))
      ));
      assert.equal(incompatibleError._tag, "AdapterCompatibilityError");

      const malformedErrors: Array<{ readonly _tag: string }> = [];
      for (const adapter of [
        JSON.parse('{"kind":"unknown","providerId":"x"}'),
        JSON.parse('{"kind":"pi","providerId":"x","modelId":"y","variantId":null,"sdkVersion":"z"}')
      ]) {
        malformedErrors.push(await Effect.runPromise(Effect.flip(
        Effect.scoped(Effect.gen(function*() {
          const store = yield* RunnerStore;
          yield* store.initialize;
          return yield* store.enqueue({
            approvedPlan: singleCreateApprovedPlan(), repositoryRoot: directory,
            adapter, maxConcurrency: 1
          });
        }).pipe(Effect.provide(RunnerStoreLive(runnerDatabasePath))))
        )));
      }
      malformedErrors.forEach((error) => assert.equal(error._tag, "AdapterCompatibilityError"));

      const pi = await Effect.runPromise(Effect.scoped(Effect.gen(function*() {
        const store = yield* RunnerStore;
        yield* store.initialize;
        return yield* store.enqueue({
          approvedPlan: singleCreateApprovedPlan(), repositoryRoot: directory,
          adapter: { kind: "pi", providerId: "pi", modelId: "model", variantId: null, sdkVersion: "sdk", workerProtocolVersion: "worker@1" },
          maxConcurrency: 1
        });
      }).pipe(Effect.provide(RunnerStoreLive(runnerDatabasePath)))));
      let inputDeliveries = 0;
      const runtime = Layer.succeed(RuntimeAdapter, testRuntimeAdapter({
        invoke: (job, reporter) => {
          assert.equal(job.adapter.kind, "pi");
          void reporter;
          inputDeliveries += 1;
          return Effect.succeed({
            content: "export interface Only { value: string; }\n",
            runtimeSessionId: "pi-runtime-session"
          });
        }
      }));
      const completed = await Effect.runPromise(runPendingJobs(runnerDatabasePath, pi.runId).pipe(Effect.provide(runtime)));
      assert.equal(inputDeliveries, 1);
      assert.equal(completed.state, "completed");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
