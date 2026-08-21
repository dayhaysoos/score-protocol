import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";

import { Effect, Layer } from "effect";

import {
  OPENCODE_CLI_VERSION,
  OPENCODE_V2_CLIENT_VERSION,
  OpenCodeAdapterLive,
  OpenCodeGateway
} from "../src/runner/open-code-adapter.js";
import { AttemptId, ClaimedJob, JobId, RunId } from "../src/runner/domain.js";
import { RuntimeAdapter } from "../src/runner/runtime-adapter.js";
import { checkAssignedFileDeclaration } from "../src/prototypes/agent-preflight-feedback-model.js";

const targetPath = "src/account-label.ts";
const documentedDeclaration = "export function label(): string;";

function assignedJob() {
  return ClaimedJob.make({
    jobId: JobId.make("job-final-candidate-check"),
    attemptId: AttemptId.make("attempt-final-candidate-check"),
    runId: RunId.make("run-final-candidate-check"),
    targetPath,
    operation: "create",
    controlJson: JSON.stringify({ target_path: targetPath, operation: "create" }),
    agentInputJson: JSON.stringify({
      objective: "Create the assigned label module.",
      target: {
        path: targetPath,
        operation: "create",
        state_at_base_revision: "absent"
      },
      input_bindings: [
        {
          contract_input: "target-state",
          kind: "target_state",
          content: { path: targetPath, state_at_base_revision: "absent" }
        }
      ]
    }),
    packageDigest: "sha256:final-candidate-check",
    adapter: {
      kind: "opencode",
      providerId: "test-provider",
      modelId: "test-model",
      variantId: null,
      sdkVersion: OPENCODE_V2_CLIENT_VERSION,
      cliVersion: OPENCODE_CLI_VERSION
    }
  });
}

function adapterLayer(
  candidateSource: string,
  workspaceParent: string,
  previouslyCheckedSource?: string
) {
  const invoke = (input: Parameters<typeof OpenCodeGateway.Service.invoke>[0]) =>
    Effect.sync(() => {
      const target = join(input.workspacePath, input.targetPath);
      mkdirSync(dirname(target), { recursive: true });
      if (previouslyCheckedSource !== undefined) {
        writeFileSync(target, previouslyCheckedSource, "utf8");
        const priorVerdict = checkAssignedFileDeclaration({
          targetPath,
          baselineSource: "",
          candidateSource: previouslyCheckedSource,
          declarationName: "label",
          documentedDeclaration
        });
        assert.equal(priorVerdict.status, "valid");
      }
      writeFileSync(target, candidateSource, "utf8");
      return { runtimeSessionId: "final-candidate-check-session" };
    });
  return OpenCodeAdapterLive({
    workspaceParent,
    prototypeFinalCandidateCheck: {
      targetPath,
      baselineSource: "",
      declarations: [
        { name: "label", documentedDeclaration }
      ]
    }
  }).pipe(
    Layer.provide(
      Layer.succeed(
        OpenCodeGateway,
        OpenCodeGateway.of({
          invoke,
          withRun: (use) => use(invoke)
        })
      )
    )
  );
}

describe("OpenCode final-candidate declaration check experiment", () => {
  it("accepts valid final bytes without an Agent-side preflight call", async () => {
    const root = mkdtempSync(join(tmpdir(), "score-final-candidate-check-"));
    const workspaceParent = join(root, "workspaces");
    mkdirSync(workspaceParent);
    const candidateSource =
      'export function label(): string { return "Account"; }\n';
    try {
      const candidate = await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function*() {
            return yield* (yield* RuntimeAdapter).invoke(assignedJob());
          }).pipe(Effect.provide(adapterLayer(candidateSource, workspaceParent)))
        )
      );

      assert.equal(candidate.content, candidateSource);
      assert.equal(
        candidate.targetOutputDigest,
        "sha256:3eccef094ef8cd809186251445e2c561984389a0952d7df2a5633e749054fb91"
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects final bytes that drift from the frozen declaration", async () => {
    const root = mkdtempSync(join(tmpdir(), "score-final-candidate-check-"));
    const workspaceParent = join(root, "workspaces");
    mkdirSync(workspaceParent);
    const candidateSource =
      'export function label(): number { return 42; }\n';
    try {
      const error = await Effect.runPromise(
        Effect.flip(
          Effect.scoped(
            Effect.gen(function*() {
              return yield* (yield* RuntimeAdapter).invoke(assignedJob());
            }).pipe(Effect.provide(adapterLayer(candidateSource, workspaceParent)))
          )
        )
      );

      assert.equal(error._tag, "AdapterBoundaryError");
      assert.equal(error.failureEvidence.category, "candidate integrity");
      assert.match(error.message, /EXPORT_SHAPE_MISMATCH/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects an edit made after an earlier valid preflight result", async () => {
    const root = mkdtempSync(join(tmpdir(), "score-final-candidate-check-"));
    const workspaceParent = join(root, "workspaces");
    mkdirSync(workspaceParent);
    const validSource =
      'export function label(): string { return "Account"; }\n';
    const editedSource =
      'export function label(): number { return 42; }\n';
    try {
      const error = await Effect.runPromise(
        Effect.flip(
          Effect.scoped(
            Effect.gen(function*() {
              return yield* (yield* RuntimeAdapter).invoke(assignedJob());
            }).pipe(
              Effect.provide(
                adapterLayer(editedSource, workspaceParent, validSource)
              )
            )
          )
        )
      );

      assert.equal(error.failureEvidence.category, "candidate integrity");
      assert.equal(
        error.targetOutputDigest,
        "sha256:8b019277f6a068cbc036793a46b5655c94afa927bf9164f67472aa6f5b53cc47"
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
