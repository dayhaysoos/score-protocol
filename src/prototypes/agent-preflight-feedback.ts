/**
 * PROTOTYPE — one real Agent with an in-session declaration feedback loop.
 *
 * Runs entirely in the Runtime Adapter's disposable workspace. It does not
 * apply the candidate to this repository.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { Effect } from "effect";

import { checkAssignedFileDeclaration } from "./agent-preflight-feedback-model.js";
import {
  OPENCODE_CLI_VERSION,
  OPENCODE_V2_CLIENT_VERSION,
  OpenCodeRuntimeLive,
  type OpenCodeAgentPreflightAuditRecord
} from "../runner/open-code-adapter.js";
import {
  AttemptId,
  ClaimedJob,
  JobId,
  RunId
} from "../runner/domain.js";
import { RuntimeAdapter } from "../runner/runtime-adapter.js";

const targetPath = "src/declaration-shape.ts";
const baselineSource = readFileSync(targetPath, "utf8");
const slice = JSON.parse(
  readFileSync("score/slices/declaration-shape-normalizer-experiment.json", "utf8")
) as {
  readonly files: ReadonlyArray<{
    readonly path: string;
    readonly owns: ReadonlyArray<{
      readonly name: string;
      readonly declaration: string;
      readonly description: string;
    }>;
  }>;
};
const file = slice.files.find(({ path }) => path === targetPath);
const owned = file?.owns.find(({ name }) => name === "normalizeDeclarationShape");
if (owned === undefined) throw new Error("The reviewed declaration fixture is missing");

const agentInputJson = JSON.stringify({
  objective:
    "Repair the assigned file so normalizeDeclarationShape preserves its current behavior while exposing the exact reviewed inline public declaration.",
  target: {
    path: targetPath,
    operation: "replace",
    state_at_base_revision: "present"
  },
  input_bindings: [
    {
      contract_input: "target-state",
      kind: "target_state",
      content: {
        path: targetPath,
        state_at_base_revision: "present",
        content: baselineSource
      }
    }
  ],
  documented_declarations: {
    owned: [owned],
    consumed: []
  },
  instructions: [
    "Preserve all existing runtime behavior.",
    "The exported normalizeDeclarationShape return type must be the exact complete inline reviewed declaration; do not replace any part of it with a private alias.",
    "Keep every helper private and make no unrelated changes.",
    "Use the assigned-file SCORE preflight before editing and after every edit. Repair any invalid finding before finishing."
  ]
});

const job = ClaimedJob.make({
  jobId: JobId.make("prototype-agent-preflight-job"),
  attemptId: AttemptId.make("prototype-agent-preflight-attempt"),
  runId: RunId.make("prototype-agent-preflight-run"),
  targetPath,
  operation: "replace",
  controlJson: JSON.stringify({ target_path: targetPath, operation: "replace" }),
  agentInputJson,
  packageDigest: "sha256:prototype-agent-preflight",
  adapter: {
    kind: "opencode",
    providerId: "opencode",
    modelId: "gpt-5.6-terra",
    variantId: "medium",
    sdkVersion: OPENCODE_V2_CLIENT_VERSION,
    cliVersion: OPENCODE_CLI_VERSION
  }
});

const command = join(process.cwd(), "node_modules", ".bin", "opencode2");
const mcpCommand = [
  join(process.cwd(), "node_modules", ".bin", "tsx"),
  join(process.cwd(), "src", "prototypes", "agent-preflight-mcp-server.ts")
] as const;
const defaultAuthPath = join(homedir(), ".local", "share", "opencode", "auth.json");
let audit: ReadonlyArray<OpenCodeAgentPreflightAuditRecord> = [];

const candidate = await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function*() {
      return yield* (yield* RuntimeAdapter).invoke(job);
    }).pipe(
      Effect.provide(
        OpenCodeRuntimeLive({
          command,
          workspaceParent: tmpdir(),
          startTimeoutMs: 20_000,
          executionTimeoutMs: 10 * 60_000,
          ...(existsSync(defaultAuthPath) ? { authPath: defaultAuthPath } : {}),
          prototypeAgentPreflight: {
            command: mcpCommand,
            targetPath,
            baselineSource,
            declarationName: owned.name,
            documentedDeclaration: owned.declaration
          },
          prototypeFinalCandidateCheck: {
            targetPath,
            baselineSource,
            declarations: [
              {
                name: owned.name,
                documentedDeclaration: owned.declaration
              }
            ]
          },
          prototypeAutomaticRepair: {
            targetPath,
            baselineSource,
            declarations: [
              {
                name: owned.name,
                documentedDeclaration: owned.declaration
              }
            ],
            maxRepairs: 1
          },
          prototypeAgentPreflightAudit: (records) => {
            audit = records;
          }
        })
      )
    )
  )
);

const independent = checkAssignedFileDeclaration({
  targetPath,
  baselineSource,
  candidateSource: candidate.content,
  declarationName: owned.name,
  documentedDeclaration: owned.declaration
});
const statuses = audit.map(({ status }) => status);
const observedRepairLoop = statuses.includes("invalid") && statuses.at(-1) === "valid";
const successful = observedRepairLoop && independent.status === "valid";

process.stdout.write(
  `${JSON.stringify(
    {
      experiment: "agent-assigned-file-preflight",
      successful,
      model: "opencode/gpt-5.6-terra",
      variant: "medium",
      candidateApplied: false,
      preflightSequence: audit,
      observedRepairLoop,
      independentFinalCheck: independent,
      candidateDigest: candidate.targetOutputDigest
    },
    null,
    2
  )}\n`
);

if (!successful) process.exitCode = 1;
