import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";

import { Effect, Layer } from "effect";

import { canonicalJson, sha256Bytes, sha256Json } from "../src/canonical.js";
import {
  verifyFileCandidateDeclarations
} from "../src/runner/candidate-declaration-gate.js";
import { repositoryRevisionContentDigest } from "../src/repository-source-state.js";
import {
  AttemptId,
  ClaimedJob,
  JobId,
  RunId,
  type CandidateDeclarationFinding
} from "../src/runner/domain.js";
import {
  OPENCODE_CLI_VERSION,
  OPENCODE_V2_CLIENT_VERSION,
  OpenCodeAdapterLive,
  OpenCodeGateway
} from "../src/runner/open-code-adapter.js";
import { formatRunStatus } from "../src/runner/failure-presentation.js";
import {
  AdapterBoundaryError,
  RuntimeAdapter
} from "../src/runner/runtime-adapter.js";
import { RunnerStore, RunnerStoreLive } from "../src/runner/runner-store.js";
import type { ApprovedPassExport } from "../src/score-alpha.js";

const targetPath = "src/account-label.ts";
const label = "export function label(): string;";
const prefix = "export function prefix(): string;";
const validTwoDeclarations =
  'export function prefix(): string { return "Account"; }\n' +
  'export function label(): string { return "Account label"; }\n';
const secondDeclarationDrifts =
  'export function prefix(): string { return "Account"; }\n' +
  "export function label(): number { return 1; }\n";
const digest = /^sha256:[0-9a-f]{64}$/u;

function agentInput(owned: readonly { readonly name: string; readonly declaration: string }[] = [
  { name: "prefix", declaration: prefix },
  { name: "label", declaration: label }
]): string {
  return canonicalJson({
    target: { path: targetPath, operation: "create", state_at_base_revision: "absent" },
    input_bindings: [],
    declarations: {
      owned: owned.map((entry) => ({ ...entry, description: `${entry.name} fixture` })),
      consumed: []
    }
  });
}

function verifierInput(overrides: Partial<Parameters<typeof verifyFileCandidateDeclarations>[0]> = {}) {
  const candidateSource = overrides.candidateSource ?? validTwoDeclarations;
  return {
    targetPath,
    operation: "create" as const,
    agentInputJson: agentInput(),
    packageDigest: sha256Json({ fixture: "candidate-declaration-gate" }),
    candidateSource,
    targetOutputDigest: sha256Bytes(candidateSource),
    ...overrides
  };
}

function findingCodes(findings: readonly CandidateDeclarationFinding[]) {
  return findings.map(({ code, declaration }) => ({ code, declaration }));
}

function job(source = validTwoDeclarations) {
  return ClaimedJob.make({
    jobId: JobId.make("declaration-gate-job"),
    attemptId: AttemptId.make("declaration-gate-attempt"),
    runId: RunId.make("declaration-gate-run"),
    targetPath,
    operation: "create",
    controlJson: canonicalJson({ target_path: targetPath, operation: "create" }),
    agentInputJson: agentInput(),
    packageDigest: sha256Json({ fixture: "candidate-declaration-gate" }),
    adapter: {
      kind: "opencode",
      providerId: "fixture-provider",
      modelId: "fixture-model",
      variantId: null,
      sdkVersion: OPENCODE_V2_CLIENT_VERSION,
      cliVersion: OPENCODE_CLI_VERSION
    },
    // The candidate is written by the fake gateway; retaining this argument makes
    // call sites state the bytes under test rather than relying on a fixture global.
    candidateSource: source
  } as Parameters<typeof ClaimedJob.make>[0]);
}

function runtimeLayer(workspaceParent: string, candidateSource: string, prior?: string) {
  const invoke = (input: Parameters<typeof OpenCodeGateway.Service.invoke>[0]) =>
    Effect.sync(() => {
      const output = join(input.workspacePath, input.targetPath);
      mkdirSync(dirname(output), { recursive: true });
      if (prior !== undefined) writeFileSync(output, prior, "utf8");
      writeFileSync(output, candidateSource, "utf8");
      return { runtimeSessionId: "deterministic-declaration-gate-session" };
    });
  return OpenCodeAdapterLive({ workspaceParent }).pipe(
    Layer.provide(Layer.succeed(OpenCodeGateway, OpenCodeGateway.of({ invoke, withRun: (use) => use(invoke) })))
  );
}

async function invokeAtPublicSeam(workspaceParent: string, source: string, prior?: string) {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        return yield* (yield* RuntimeAdapter).invoke(job(source));
      }).pipe(Effect.provide(runtimeLayer(workspaceParent, source, prior)))
    )
  );
}

async function invokeFailure(
  workspaceParent: string,
  source: string,
  prior?: string
): Promise<AdapterBoundaryError> {
  try {
    await invokeAtPublicSeam(workspaceParent, source, prior);
  } catch (error) {
    assert.ok(error instanceof AdapterBoundaryError);
    return error;
  }
  throw new Error("Expected the RuntimeAdapter invocation to fail");
}

function approvedPlan(): ApprovedPassExport {
  const sourceDigest = repositoryRevisionContentDigest({ orderedManifest: [] });
  const control = {
    protocol: {
      bundle_schema: "score.compilation-bundle@0.1.0-alpha.5" as const,
      profile: "score.coding@0.1.0-alpha.5" as const,
      canonicalization: "RFC 8785" as const,
      digest_algorithm: "SHA-256" as const
    },
    target_path: targetPath,
    operation: "create" as const,
    base_revision_id: "candidate-gate-source",
    base_revision_digest: sourceDigest,
    allowed_effects: [{ kind: "create_file", path: targetPath }]
  };
  const parsedAgentInput = JSON.parse(agentInput()) as {
    target: { path: string; operation: "create"; state_at_base_revision: string };
    input_bindings: [];
    declarations: {
      owned: Array<{ name: string; declaration: string; description: string }>;
      consumed: [];
    };
  };
  const fullAgentInput = {
    ...parsedAgentInput,
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
    ]
  };
  const payload = { control, agent_input: fullAgentInput };
  return {
    schema: "score.approved-pass-export",
    version: "0.1.0-alpha.6",
    pass_id: "candidate-gate-pass",
    publication: {
      review_id: "candidate-gate-review",
      decision_id: "candidate-gate-decision",
      authority: "test-human-authority",
      decided_at: "2026-08-20T00:00:00.000Z"
    },
    source_snapshot: {
      revision_id: "candidate-gate-source",
      content_digest: sourceDigest,
      files: []
    },
    payloads: [
      {
        payload_id: "candidate-gate-payload",
        target_path: targetPath,
        operation: "create",
        control,
        agent_input: fullAgentInput,
        payload,
        control_digest: sha256Json(control),
        agent_input_digest: sha256Json(fullAgentInput),
        payload_digest: sha256Json(payload)
      }
    ]
  };
}

describe("File candidate declaration gate", () => {
  it("binds a two-declaration candidate and identifies only a drifting second declaration", () => {
    const valid = verifyFileCandidateDeclarations(verifierInput());
    assert.equal(valid.status, "valid");
    assert.deepEqual(valid.findings, []);
    assert.match(valid.candidateDigest, digest);
    assert.match(valid.bindingDigest, digest);
    assert.match(valid.verdictDigest, digest);

    const invalid = verifyFileCandidateDeclarations(
      verifierInput({ candidateSource: secondDeclarationDrifts, targetOutputDigest: sha256Bytes(secondDeclarationDrifts) })
    );
    assert.equal(invalid.status, "invalid");
    assert.deepEqual(findingCodes(invalid.findings), [
      { code: "EXPORT_SHAPE_MISMATCH", declaration: "label" }
    ]);
    assert.match(invalid.candidateDigest, digest);
    assert.match(invalid.bindingDigest ?? "", digest);
    assert.match(invalid.verdictDigest ?? "", digest);
  });

  it("rejects frozen-input substitutions, duplicate ownership, and unverified output bytes", () => {
    const cases = [
      [
        verifierInput({ agentInputJson: "{not json" }),
        "MALFORMED_AGENT_INPUT"
      ],
      [
        verifierInput({
          agentInputJson: canonicalJson({
            target: { path: "src/other.ts", operation: "create", state_at_base_revision: "absent" },
            declarations: { owned: [{ name: "label", declaration: label }], consumed: [] }
          })
        }),
        "FROZEN_TARGET_MISMATCH"
      ],
      [
        verifierInput({
          agentInputJson: agentInput([
            { name: "label", declaration: label },
            { name: "label", declaration: label }
          ])
        }),
        "DUPLICATE_OWNED_DECLARATION"
      ],
      [verifierInput({ targetOutputDigest: sha256Bytes("other bytes\n") }), "TARGET_OUTPUT_DIGEST_MISMATCH"]
    ] as const;

    for (const [input, expected] of cases) {
      const result = verifyFileCandidateDeclarations(input);
      assert.equal(result.status, "invalid");
      assert.ok(result.findings.some((finding) => finding.code === expected));
      assert.match(result.candidateDigest, digest);
      if (result.bindingDigest !== null) assert.match(result.bindingDigest, digest);
      if (result.verdictDigest !== null) assert.match(result.verdictDigest, digest);
    }
  });

  it("returns not_applicable for no owned declarations and is byte deterministic", () => {
    const input = verifierInput({ agentInputJson: agentInput([]) });
    const first = verifyFileCandidateDeclarations(input);
    const second = verifyFileCandidateDeclarations({ ...input });
    assert.deepEqual(second, first);
    assert.equal(canonicalJson(second), canonicalJson(first));
    assert.equal(first.status, "not_applicable");
    assert.deepEqual(first.findings, []);
    assert.equal(first.bindingDigest, null);
    assert.equal(first.verdictDigest, null);
    assert.match(first.candidateDigest, digest);
  });

  it("enforces final bytes at the public RuntimeAdapter seam, independently of prototype feedback", async () => {
    const root = mkdtempSync(join(tmpdir(), "score-declaration-gate-runtime-"));
    const workspaceParent = join(root, "workspaces");
    mkdirSync(workspaceParent);
    try {
      const accepted = await invokeAtPublicSeam(workspaceParent, validTwoDeclarations);
      assert.equal(accepted.content, validTwoDeclarations);
      assert.match(accepted.targetOutputDigest ?? "", digest);

      const invalid = await invokeFailure(workspaceParent, secondDeclarationDrifts);
      assert.equal(invalid._tag, "AdapterBoundaryError");
      assert.equal(invalid.failureEvidence.category, "candidate integrity");
      assert.match(invalid.message, /label/u);
      assert.match(invalid.message, /EXPORT_SHAPE_MISMATCH/u);

      // `prior` is deliberately valid.  The adapter must inspect the final write,
      // not accept any earlier Agent-side/prototype feedback about those bytes.
      const edited = await invokeFailure(
        workspaceParent,
        secondDeclarationDrifts,
        validTwoDeclarations
      );
      assert.equal(edited.failureEvidence.category, "candidate integrity");
      assert.equal(edited.targetOutputDigest, sha256Bytes(secondDeclarationDrifts));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("persists only safe declaration evidence and formats an actionable rejected-output failure", async () => {
    const directory = mkdtempSync(join(tmpdir(), "score-declaration-gate-store-"));
    const databasePath = join(directory, "runner.db");
    const rejectedSource = secondDeclarationDrifts + "// prompt: private prompt text\n";
    const rejectedDigest = sha256Bytes(rejectedSource);
    const safeFindings = [{
      code: "EXPORT_SHAPE_MISMATCH",
      declaration: "label",
      message: "The final export does not reproduce the approved declaration."
    }] as const;
    try {
      const first = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const store = yield* RunnerStore;
        yield* store.initialize;
        const queued = yield* store.enqueue({ approvedPlan: approvedPlan(), repositoryRoot: directory, adapter: job().adapter, maxConcurrency: 1 });
        yield* store.beginWork(queued.runId);
        const claimed = yield* store.claimNext(queued.runId);
        assert.ok(claimed);
        yield* store.completeFailure({
          job: claimed,
          failureEvidence: {
            category: "candidate integrity",
            stage: "checking output",
            name: "label",
            status: "error",
            statusCode: null,
            reason: "EXPORT_SHAPE_MISMATCH",
            declarationVerification: {
              findings: safeFindings,
              bindingDigest: sha256Json({ binding: true }),
              candidateDigest: rejectedDigest,
              verdictDigest: sha256Json({ verdict: true })
            }
          },
          targetOutputState: "different", targetOutputDigest: rejectedDigest,
          diagnosticContent: rejectedSource + " token=private-secret /private/tmp/absolute-path"
        });
        return yield* store.inspectRun(queued.runId);
      }).pipe(Effect.provide(RunnerStoreLive(databasePath)))));
      const reopened = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const store = yield* RunnerStore;
        yield* store.initialize;
        return yield* store.inspectRun(first.runId);
      }).pipe(Effect.provide(RunnerStoreLive(databasePath)))));
      const file = reopened.observation.files[0];
      assert.ok(file);
      assert.deepEqual(reopened.observation, first.observation);
      const serialized = JSON.stringify(reopened);
      assert.match(serialized, /EXPORT_SHAPE_MISMATCH/u);
      assert.match(serialized, /sha256:[0-9a-f]{64}/u);
      assert.doesNotMatch(serialized, /private prompt|private-secret|absolute-path|secondDeclarationDrifts|\/private\/tmp/u);
      const human = formatRunStatus(reopened);
      assert.match(human, /label/u);
      assert.match(human, /EXPORT_SHAPE_MISMATCH/u);
      assert.match(human, /sha256:/u);
      assert.match(human, /Changed, but rejected/u);
      assert.match(human, /retry/u);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
