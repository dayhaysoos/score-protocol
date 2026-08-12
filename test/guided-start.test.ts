import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
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
import { join } from "node:path";
import { describe, it } from "node:test";
import { stripVTControlCharacters } from "node:util";

import { Effect, Layer } from "effect";

import { createAcceptedInputPacket } from "../src/fixture-inputs.js";
import { prepareSlice, type SliceDraft } from "../src/plan-intake.js";
import {
  GuidedStartCancelled,
  runGuidedStart,
  type GuidedStartBackend,
  type GuidedStartPrompts
} from "../src/runner/guided-start.js";
import {
  createInquirerGuidedPrompts,
  formatGuidedApplicationSummary,
  formatGuidedConfirmation,
  formatRepositoryDifferenceNotice,
  makeGuidedStartBackend
} from "../src/runner/guided-start-cli.js";
import { formatApplicationSummary } from "../src/runner/application-summary.js";
import { RunId, type AdapterConfiguration } from "../src/runner/domain.js";
import { OpenCodeAdapter } from "../src/runner/open-code-adapter.js";
import { RepositoryDriftError } from "../src/runner/repository-application.js";
import { inspectRun } from "../src/runner/runner.js";
import type { RuntimeAdapterCatalog, RuntimeModel } from "../src/runner/runtime-adapter-catalog.js";
import type { ReviewedChangePlan } from "../src/score-alpha.js";
import { ScoreAlpha } from "../src/score-alpha.js";

function testOpenCodeAdapter(
  input: Pick<typeof OpenCodeAdapter.Service, "invoke">
): typeof OpenCodeAdapter.Service {
  return OpenCodeAdapter.of({
    ...input,
    withRun: (use) => use(input.invoke)
  });
}
import { createFixtureGitRepository } from "./helpers/git-repository.js";

const plans: ReadonlyArray<ReviewedChangePlan> = [
  {
    sliceId: "account-status",
    passId: "hidden-pass-a",
    reviewId: "hidden-review-a",
    logicalTitle: "Account Status",
    label: "Account Status",
    revision: 1,
    revisionCount: 1,
    objective: "Add the account status contract and formatter.",
    files: ["src/schema.ts", "src/account-label.ts"],
    approvalStatus: "needs_approval",
    warningCount: 0,
    digestSet: {
      manifest: { protocol_id: "manifest-a", content_digest: "sha256:manifest-a" },
      compilation_report: { protocol_id: "report-a", content_digest: "sha256:report-a" },
      pass: { protocol_id: "hidden-pass-a", content_digest: "sha256:pass-a" },
      payloads: []
    }
  },
  {
    sliceId: "billing-cleanup",
    passId: "hidden-pass-b",
    reviewId: "hidden-review-b",
    logicalTitle: "Billing Cleanup",
    label: "Billing Cleanup",
    revision: 1,
    revisionCount: 1,
    objective: "Clean up billing types.",
    files: ["src/billing.ts"],
    approvalStatus: "approved",
    warningCount: 0,
    digestSet: {
      manifest: { protocol_id: "manifest-b", content_digest: "sha256:manifest-b" },
      compilation_report: { protocol_id: "report-b", content_digest: "sha256:report-b" },
      pass: { protocol_id: "hidden-pass-b", content_digest: "sha256:pass-b" },
      payloads: []
    }
  }
];

const model: RuntimeModel = {
  key: "opencode/claude-sonnet-4-6",
  label: "Claude Sonnet 4.6",
  sourceLabel: "OpenCode Zen",
  variants: []
};

const variantModel: RuntimeModel = {
  key: "opencode/gpt-5.4",
  label: "GPT-5.4",
  sourceLabel: "OpenCode Zen",
  variants: [
    { id: "low", label: "Low", summaryLabel: "Low reasoning" },
    { id: "fast", label: "Fast", summaryLabel: "Fast reasoning" }
  ]
};

const adapterCatalog: RuntimeAdapterCatalog<AdapterConfiguration> = {
  id: "opencode",
  label: "OpenCode",
  discoverModels: Effect.succeed([model]),
  configurationFor: (selectedModel, variantId) => {
    const [providerId, modelId] = selectedModel.key.split("/");
    assert.ok(providerId);
    assert.ok(modelId);
    return {
      kind: "opencode",
      providerId,
      modelId,
      variantId: variantId ?? null,
      sdkVersion: "0.0.0-next-17111",
      cliVersion: "0.0.0-next-17111"
    };
  }
};

const UNSAFE_TERMINAL_TEXT =
  /[\u0000-\u001F\u007F-\u009F]|\p{Cf}/u;

function readBundle(): unknown {
  return JSON.parse(
    readFileSync(join(process.cwd(), "fixtures", "account-status.bundle.json"), "utf8")
  );
}

describe("guided Runner start", () => {
  it("keeps a fast searchable model choice bound to the model shown as selected", async () => {
    const script = `
      import { createInquirerGuidedPrompts } from "./src/runner/guided-start-cli.ts";
      const nemotron = {
        key: "opencode/nemotron",
        label: "Nemotron",
        sourceLabel: "OpenCode Zen",
        variants: []
      };
      const terra = {
        key: "opencode/terra",
        label: "GPT-5.6 Terra",
        sourceLabel: "OpenCode Zen",
        variants: [{ id: "medium", label: "Medium", summaryLabel: "Medium reasoning" }]
      };
      const selected = await createInquirerGuidedPrompts().selectModel(
        { label: "OpenCode" },
        [nemotron, terra]
      );
      process.stdout.write("\\nRESULT:" + selected.key + "\\n");
    `;
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", script],
      { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] }
    );
    let stdout = "";
    let stderr = "";
    let submitted = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (!submitted && stdout.includes("GPT-5.6 Terra")) {
        submitted = true;
        child.stdin.write("Terra\r");
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error(`guided model prompt timed out\nstdout:\n${stdout}\nstderr:\n${stderr}`));
      }, 10_000);
      child.once("error", reject);
      child.once("exit", (code) => {
        clearTimeout(timeout);
        resolve(code);
      });
    });

    assert.equal(exitCode, 0, stderr);
    assert.equal(submitted, true);
    assert.match(stdout, /✔ Which OpenCode model should run it\? GPT-5\.6 Terra/u);
    assert.match(stdout, /RESULT:opencode\/terra/u);
  });

  it("asks again instead of guessing when a fast search still has several matches", async () => {
    const script = `
      import { createInquirerGuidedPrompts } from "./src/runner/guided-start-cli.ts";
      const models = [
        { key: "opencode/nemotron", label: "Nemotron", sourceLabel: "OpenCode Zen", variants: [] },
        { key: "opencode/terra", label: "GPT-5.6 Terra", sourceLabel: "OpenCode Zen", variants: [] },
        { key: "opencode/terra-mini", label: "Terra Mini", sourceLabel: "OpenCode Zen", variants: [] }
      ];
      const selected = await createInquirerGuidedPrompts().selectModel(
        { label: "OpenCode" },
        models
      );
      process.stdout.write("\\nRESULT:" + selected.key + "\\n");
    `;
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", script],
      { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] }
    );
    let stdout = "";
    let stderr = "";
    let firstSubmitted = false;
    let retrySubmitted = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (!firstSubmitted && stdout.includes("Terra Mini")) {
        firstSubmitted = true;
        child.stdin.write("Terra\u001b[B\r");
      } else if (
        firstSubmitted &&
        !retrySubmitted &&
        stdout.includes("Search results changed before selection completed")
      ) {
        retrySubmitted = true;
        child.stdin.write("Mini\r");
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error(`guided model retry timed out\nstdout:\n${stdout}\nstderr:\n${stderr}`));
      }, 10_000);
      child.once("error", reject);
      child.once("exit", (code) => {
        clearTimeout(timeout);
        resolve(code);
      });
    });

    assert.equal(exitCode, 0, stderr);
    assert.equal(firstSubmitted, true);
    assert.equal(retrySubmitted, true);
    assert.match(stdout, /✔ Which OpenCode model should run it\? Terra Mini/u);
    assert.match(stdout, /RESULT:opencode\/terra-mini/u);
  });

  it("asks again when a stale highlighted model still belongs to the newest result set", async () => {
    const script = `
      import { createInquirerGuidedPrompts } from "./src/runner/guided-start-cli.ts";
      const models = [
        { key: "opencode/nemotron", label: "Nemotron", sourceLabel: "OpenCode Zen", variants: [] },
        { key: "opencode/terra", label: "GPT-5.6 Terra", sourceLabel: "OpenCode Zen", variants: [] }
      ];
      const selected = await createInquirerGuidedPrompts().selectModel(
        { label: "OpenCode" },
        models
      );
      process.stdout.write("\\nRESULT:" + selected.key + "\\n");
    `;
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", script],
      { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] }
    );
    let stdout = "";
    let stderr = "";
    let firstSubmitted = false;
    let retrySubmitted = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (!firstSubmitted && stdout.includes("GPT-5.6 Terra")) {
        firstSubmitted = true;
        child.stdin.write("\u001b[BZen\r");
      } else if (
        firstSubmitted &&
        !retrySubmitted &&
        stdout.includes("Search results changed before selection completed")
      ) {
        retrySubmitted = true;
        child.stdin.write("Terra\r");
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error(`guided overlapping-result retry timed out\nstdout:\n${stdout}\nstderr:\n${stderr}`));
      }, 10_000);
      child.once("error", reject);
      child.once("exit", (code) => {
        clearTimeout(timeout);
        resolve(code);
      });
    });

    assert.equal(exitCode, 0, stderr);
    assert.equal(firstSubmitted, true);
    assert.equal(retrySubmitted, true);
    assert.match(stdout, /✔ Which OpenCode model should run it\? GPT-5\.6 Terra/u);
    assert.match(stdout, /RESULT:opencode\/terra/u);
  });

  it("asks again instead of accepting a stale model when a fast search has no matches", async () => {
    const script = `
      import { createInquirerGuidedPrompts } from "./src/runner/guided-start-cli.ts";
      const models = [
        { key: "opencode/nemotron", label: "Nemotron", sourceLabel: "OpenCode Zen", variants: [] },
        { key: "opencode/terra", label: "GPT-5.6 Terra", sourceLabel: "OpenCode Zen", variants: [] }
      ];
      const selected = await createInquirerGuidedPrompts().selectModel(
        { label: "OpenCode" },
        models
      );
      process.stdout.write("\\nRESULT:" + selected.key + "\\n");
    `;
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", script],
      { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] }
    );
    let stdout = "";
    let stderr = "";
    let firstSubmitted = false;
    let retrySubmitted = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (!firstSubmitted && stdout.includes("GPT-5.6 Terra")) {
        firstSubmitted = true;
        child.stdin.write("zzzz\r");
      } else if (
        firstSubmitted &&
        !retrySubmitted &&
        stdout.includes("Search results changed before selection completed")
      ) {
        retrySubmitted = true;
        child.stdin.write("Terra\r");
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error(`guided empty-result retry timed out\nstdout:\n${stdout}\nstderr:\n${stderr}`));
      }, 10_000);
      child.once("error", reject);
      child.once("exit", (code) => {
        clearTimeout(timeout);
        resolve(code);
      });
    });

    assert.equal(exitCode, 0, stderr);
    assert.equal(firstSubmitted, true);
    assert.equal(retrySubmitted, true);
    assert.match(stdout, /RESULT:opencode\/terra/u);
    assert.doesNotMatch(stdout, /RESULT:opencode\/nemotron/u);
  });

  it("shows the selected variant in confirmation", () => {
    const low = variantModel.variants[0]!;
    assert.equal(
      formatGuidedConfirmation({
        adapterCatalog,
        planLabel: "Dependable in-memory to-do app",
        model: variantModel,
        variant: low,
        willApprove: false
      }),
      "Run and apply Dependable in-memory to-do app with GPT-5.4 · OpenCode Zen · Low reasoning?"
    );
    assert.equal(
      formatGuidedConfirmation({
        adapterCatalog,
        planLabel: "Dependable in-memory to-do app",
        model: variantModel,
        variant: null,
        willApprove: false
      }),
      "Run and apply Dependable in-memory to-do app with GPT-5.4 · OpenCode Zen · OpenCode default?"
    );
    assert.equal(
      formatRepositoryDifferenceNotice([
        { kind: "missing", path: "src/App.tsx" },
        { kind: "changed", path: "src/todo.ts" },
        { kind: "occupied", path: "src/App.test.tsx" }
      ]),
      "Repository warning\n" +
        "  These planned files differ from their original reviewed source state.\n" +
        "  • src/App.tsx · missing; will be recreated\n" +
        "  • src/todo.ts · changed since the plan\n" +
        "  • src/App.test.tsx · exists; will be replaced\n" +
        "Continuing lets SCORE replace or recreate these files if they remain unchanged while agents run.\n\n"
    );
  });

  it("keeps untrusted confirmation and drift text bounded to terminal-safe lines", () => {
    const maliciousCatalog = {
      ...adapterCatalog,
      label: "Open\u001B]0;forged catalog title\u0007Code\nCatalog\u202E"
    };
    const maliciousVariant = {
      id: "unsafe",
      label: "Medium\u009B2J\nvariant\u2066",
      summaryLabel: "Medium\u001BPforged device status\u001B\\ reasoning\u200B"
    };
    const maliciousModel: RuntimeModel = {
      key: "opencode/unsafe",
      label: `GPT\u001B[2J\nModel ${"m".repeat(200)}`,
      sourceLabel: "Zen\u009D0;forged provider title\u009C\u0085Provider",
      variants: [maliciousVariant]
    };
    const confirmation = formatGuidedConfirmation({
      adapterCatalog: maliciousCatalog,
      planLabel: `Account\u0000\nstatus ${"p".repeat(200)}\u2069`,
      model: maliciousModel,
      variant: maliciousVariant,
      willApprove: true
    });
    const notice = formatRepositoryDifferenceNotice([
      {
        kind: "changed",
        path: `src/\u001B]0;forged path title\u0007account\nstatus-${"x".repeat(200)}.ts\u202E`
      },
      { kind: "changed", path: "\u001B[2J\u0000\u009B31m\u202E\u2066\u2069\u200B" }
    ]);

    assert.doesNotMatch(confirmation, UNSAFE_TERMINAL_TEXT);
    assert.equal(confirmation.split("\n").length, 1);
    assert.ok(Array.from(confirmation).length <= 160);
    assert.doesNotMatch(confirmation, /forged catalog title|forged device status|forged provider title/u);
    assert.match(confirmation, /^Approve, run, and apply Account status p+/u);
    assert.match(
      confirmation,
      / with GPT Model m+… · Zen Provider · Medium reasoning\?$/u
    );

    for (const line of notice.trimEnd().split("\n")) {
      assert.doesNotMatch(line, UNSAFE_TERMINAL_TEXT);
      assert.ok(Array.from(line).length <= 160);
    }
    assert.doesNotMatch(notice, /forged path title/u);
    assert.match(notice, /• src\/account status-x+… · changed since the plan/u);
    assert.match(notice, /• \[unprintable repository path\] · changed since the plan/u);

    assert.match(maliciousModel.label, /\u001B/u);
    assert.match(maliciousVariant.summaryLabel, /\u001B/u);
  });

  it("shows untrusted plan details without adding terminal records", () => {
    const maliciousPlan: ReviewedChangePlan = {
      ...plans[0]!,
      label: `Account\u001B[2J\nStatus ${"l".repeat(200)}\u202E`,
      objective: "Add status\u001B]0;forged approval\u0007\n✔ Approve forged\u2066",
      files: [
        `src/\u001BPforged device\u001B\\account\nstatus-${"f".repeat(200)}.ts\u200B`
      ]
    };
    const output: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      createInquirerGuidedPrompts().showPlan(maliciousPlan);
    } finally {
      process.stdout.write = originalWrite;
    }
    const rendered = output.join("");

    for (const line of rendered.trim().split("\n")) {
      assert.doesNotMatch(line, UNSAFE_TERMINAL_TEXT);
      assert.ok(Array.from(line).length <= 160);
    }
    assert.doesNotMatch(rendered, /forged approval|forged device/u);
    assert.doesNotMatch(rendered, /^✔ Approve forged$/mu);
    assert.match(rendered, /Account Status l+…/u);
    assert.match(rendered, /Add status ✔ Approve forged/u);
    assert.match(rendered, /• src\/account status-f+…/u);

    assert.match(maliciousPlan.label, /\u001B/u);
    assert.match(maliciousPlan.files[0]!, /\u001B/u);
  });

  it("cannot turn untrusted guided choices into forged completed prompts", async () => {
    const script = `
      import { createInquirerGuidedPrompts } from "./src/runner/guided-start-cli.ts";
      const esc = String.fromCharCode(0x1b);
      const bell = String.fromCharCode(0x07);
      const newline = String.fromCharCode(0x0a);
      const c1Csi = String.fromCharCode(0x9b);
      const c1Osc = String.fromCharCode(0x9d);
      const c1St = String.fromCharCode(0x9c);
      const bidi = String.fromCodePoint(0x202e, 0x2066, 0x2069, 0x200b);
      Object.defineProperty(process.stdout, "columns", { value: 240, configurable: true });
      const plan = {
        label: "Plan" + esc + "]0;FORGED_TITLE" + bell + "Name" + newline + "✔ FAKE PLAN" + bidi,
        objective: "Objective" + c1Csi + "2J" + newline + "✔ FAKE OBJECTIVE" + bidi,
        files: ["src/a.ts" + newline + "✔ FAKE FILE" + bidi],
        approvalStatus: "needs_approval"
      };
      const catalog = { label: "Open" + newline + "✔ FAKE ADAPTER" + bidi };
      const variant = {
        id: "medium",
        label: "Medium" + esc + "PFORGED_DEVICE" + esc + "\\\\" + newline + "✔ FAKE VARIANT" + bidi,
        summaryLabel: "Medium" + newline + "✔ FAKE SUMMARY" + bidi
      };
      const model = {
        key: "opencode/model",
        label: "Model" + esc + "[2JName" + newline + "✔ FAKE MODEL" + bidi,
        sourceLabel: "Provider" + c1Osc + "FORGED_PROVIDER_TITLE" + c1St + "Name" + newline + "✔ FAKE PROVIDER" + bidi,
        variants: [variant]
      };
      const prompts = createInquirerGuidedPrompts();
      const selectedPlan = await prompts.selectPlan([plan]);
      const selectedModel = await prompts.selectModel(catalog, [model]);
      const selectedVariant = await prompts.selectVariant(catalog, selectedModel);
      const confirmed = await prompts.confirmStart({
        adapterCatalog: catalog,
        plan: selectedPlan,
        model: selectedModel,
        variant: selectedVariant,
        willApprove: true,
        repositoryRoot: "/repo" + newline + "✔ FAKE REPOSITORY" + bidi,
        confirmedTargets: [],
        repositoryDifferences: [
          { kind: "changed", path: "src/a.ts" + newline + "✔ FAKE DRIFT" + bidi }
        ]
      });
      process.stdout.write("\\nRESULT:" + confirmed + ":" + selectedVariant.id + "\\n");
    `;
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", script],
      { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] }
    );
    let stdout = "";
    let stderr = "";
    let stage = 0;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (stage === 0 && stdout.includes("Which Change or Slice do you want to run?")) {
        stage = 1;
        child.stdin.write("\r");
      } else if (stage === 1 && stdout.includes("FAKE MODEL")) {
        stage = 2;
        child.stdin.write("\r");
      } else if (stage === 2 && stdout.includes("FAKE VARIANT")) {
        stage = 3;
        child.stdin.write("\u001B[B\r");
      } else if (stage === 3 && stdout.includes("Approve, run, and apply")) {
        stage = 4;
        child.stdin.write("\r");
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error(`guided injection prompt timed out\nstdout:\n${stdout}\nstderr:\n${stderr}`));
      }, 10_000);
      child.once("error", reject);
      child.once("exit", (code) => {
        clearTimeout(timeout);
        resolve(code);
      });
    });
    const visible = stripVTControlCharacters(stdout).replace(/\r/gu, "");

    assert.equal(exitCode, 0, stderr);
    assert.equal(stage, 4);
    assert.doesNotMatch(stdout, /\u001B\]0;FORGED_TITLE|\u001B\[2J|\u001BPFORGED_DEVICE/u);
    assert.doesNotMatch(stdout, /[\u0000\u0007\u0085\u009B\u009C\u009D]|\p{Cf}/u);
    assert.doesNotMatch(
      visible,
      /^(?:✔ FAKE PLAN|✔ FAKE OBJECTIVE|✔ FAKE MODEL|✔ FAKE VARIANT|✔ FAKE REPOSITORY|✔ FAKE FILE|✔ FAKE DRIFT)$/mu
    );
    assert.match(visible, /PlanName ✔ FAKE PLAN/u);
    assert.match(visible, /Objective ✔ FAKE OBJECTIVE/u);
    assert.match(visible, /ModelName ✔ FAKE MODEL/u);
    assert.match(visible, /ProviderName ✔ FAKE PROVIDER/u);
    assert.match(visible, /Repository\n  \/repo ✔ FAKE REPOSITORY/u);
    assert.match(visible, /• src\/a\.ts ✔ FAKE FILE/u);
    assert.match(visible, /• src\/a\.ts ✔ FAKE DRIFT · changed since the plan/u);
    assert.match(
      visible,
      /✔ Approve, run, and apply PlanName ✔ FAKE PLAN with ModelName ✔ FAKE MODEL · ProviderName ✔ FAKE PROVIDER · Medium ✔ FAKE SUM…\? Yes/u
    );
    assert.match(visible, /RESULT:true:medium/u);
  });

  it("states only that generated candidates were applied", () => {
    assert.equal(
      formatApplicationSummary({
        applicationState: "applied",
        candidateCount: 4,
        repositoryRoot: "/workspace/todo"
      }),
      "\nAll 4 candidates were generated and applied to /workspace/todo.\n"
    );
    assert.equal(
      formatApplicationSummary({
        applicationState: "applied",
        candidateCount: 1,
        repositoryRoot: "/workspace/one-file"
      }),
      "\nThe candidate was generated and applied to /workspace/one-file.\n"
    );
    assert.equal(
      formatGuidedApplicationSummary({
        applicationState: "applied",
        candidateCount: 1,
        repositoryRoot: "/workspace\n✔ FORGED COMPLETION\u202E"
      }),
      "\nThe candidate was generated and applied to /workspace ✔ FORGED COMPLETION.\n"
    );
  });

  it("validates the selected repository before model discovery or Plan Approval", async () => {
    const events: string[] = [];
    const approvals: string[] = [];
    const guardedCatalog: RuntimeAdapterCatalog<AdapterConfiguration> = {
      ...adapterCatalog,
      discoverModels: Effect.sync(() => {
        events.push("models");
        return [model];
      })
    };
    const prompts: GuidedStartPrompts = {
      selectPlan: async (options) => {
        events.push("select-plan");
        return options[0]!;
      },
      showPlan: () => events.push("show-plan"),
      selectModel: async () => {
        events.push("select-model");
        return model;
      },
      confirmStart: async () => {
        events.push("confirm");
        return true;
      }
    };
    const backend: GuidedStartBackend = {
      listPlans: async () => plans,
      prepareRepository: async () => {
        events.push("prepare-repository");
        throw new RepositoryDriftError([
          { kind: "missing", path: "src/schema.ts" },
          { kind: "unexpected", path: "README.md" }
        ]);
      },
      approve: async (plan) => {
        approvals.push(plan.label);
      },
      start: async () => {
        events.push("start");
        throw new Error("unreachable");
      }
    };

    await assert.rejects(
      runGuidedStart({ backend, prompts, adapterCatalog: guardedCatalog }),
      RepositoryDriftError
    );
    assert.deepEqual(events, ["select-plan", "show-plan", "prepare-repository"]);
    assert.deepEqual(approvals, []);
  });

  it("asks for an advertised variant and carries one selection through confirmation and start", async () => {
    const events: string[] = [];
    const starts: Array<{ model: RuntimeModel; variant: unknown }> = [];
    const variantCatalog: RuntimeAdapterCatalog<AdapterConfiguration> = {
      ...adapterCatalog,
      discoverModels: Effect.succeed([variantModel])
    };
    const prompts: GuidedStartPrompts = {
      selectPlan: async (options) => options[0]!,
      showPlan: () => undefined,
      selectModel: async () => variantModel,
      selectVariant: async (_catalog, selectedModel) => {
        events.push(`variant:${selectedModel.label}`);
        return selectedModel.variants[0]!;
      },
      confirmStart: async (input) => {
        events.push(`confirm:${input.variant?.summaryLabel}`);
        return true;
      }
    };
    const backend: GuidedStartBackend = {
      listPlans: async () => plans,
      prepareRepository: async () => ({
        repositoryRoot: "/workspace/account-status",
        confirmedTargets: [],
        repositoryDifferences: []
      }),
      approve: async () => undefined,
      start: async (input) => {
        starts.push({ model: input.model, variant: input.variant });
        return { runId: RunId.make("run-variant"), state: "completed" };
      }
    };

    await runGuidedStart({ backend, prompts, adapterCatalog: variantCatalog });

    assert.deepEqual(events, ["variant:GPT-5.4", "confirm:Low reasoning"]);
    assert.deepEqual(starts, [{ model: variantModel, variant: variantModel.variants[0] }]);
  });

  it("lets an explicit variant bypass the guided variant question", async () => {
    let variantQuestions = 0;
    let startedVariant: unknown;
    const variantCatalog: RuntimeAdapterCatalog<AdapterConfiguration> = {
      ...adapterCatalog,
      discoverModels: Effect.succeed([variantModel])
    };
    const prompts: GuidedStartPrompts = {
      selectPlan: async (options) => options[0]!,
      showPlan: () => undefined,
      selectModel: async () => variantModel,
      selectVariant: async () => {
        variantQuestions += 1;
        return null;
      },
      confirmStart: async () => true
    };
    const backend: GuidedStartBackend = {
      listPlans: async () => plans,
      prepareRepository: async () => ({
        repositoryRoot: "/workspace/account-status",
        confirmedTargets: [],
        repositoryDifferences: []
      }),
      approve: async () => undefined,
      start: async (input) => {
        startedVariant = input.variant;
        return { runId: RunId.make("run-explicit-variant"), state: "completed" };
      }
    };

    await runGuidedStart({
      backend,
      prompts,
      adapterCatalog: variantCatalog,
      variantOverride: "fast"
    });

    assert.equal(variantQuestions, 0);
    assert.deepEqual(startedVariant, variantModel.variants[1]);
  });

  it("keeps the guided runtime default as no explicit variant", async () => {
    let confirmedVariant: unknown = "not-confirmed";
    let startedVariant: unknown = "not-started";
    const variantCatalog: RuntimeAdapterCatalog<AdapterConfiguration> = {
      ...adapterCatalog,
      discoverModels: Effect.succeed([variantModel])
    };
    const prompts: GuidedStartPrompts = {
      selectPlan: async (options) => options[0]!,
      showPlan: () => undefined,
      selectModel: async () => variantModel,
      selectVariant: async () => null,
      confirmStart: async (input) => {
        confirmedVariant = input.variant;
        return true;
      }
    };
    const backend: GuidedStartBackend = {
      listPlans: async () => plans,
      prepareRepository: async () => ({
        repositoryRoot: "/workspace/account-status",
        confirmedTargets: [],
        repositoryDifferences: []
      }),
      approve: async () => undefined,
      start: async (input) => {
        startedVariant = input.variant;
        return { runId: RunId.make("run-default-variant"), state: "completed" };
      }
    };

    await runGuidedStart({ backend, prompts, adapterCatalog: variantCatalog });

    assert.equal(confirmedVariant, null);
    assert.equal(startedVariant, null);
  });

  it("warns about repository differences and starts from the exact target state the user confirmed", async () => {
    const confirmedTargets = [
      {
        targetPath: "src/schema.ts",
        state: "file" as const,
        contentDigest: "sha256:current-schema"
      },
      { targetPath: "src/account-label.ts", state: "absent" as const }
    ];
    const repositoryDifferences = [
      { kind: "changed" as const, path: "src/schema.ts" },
      { kind: "occupied" as const, path: "src/account-label.ts" }
    ];
    let confirmationInput: Parameters<GuidedStartPrompts["confirmStart"]>[0] | undefined;
    let startInput: Parameters<GuidedStartBackend["start"]>[0] | undefined;
    const prompts: GuidedStartPrompts = {
      selectPlan: async (options) => options[0]!,
      showPlan: () => undefined,
      selectModel: async () => model,
      confirmStart: async (input) => {
        confirmationInput = input;
        return true;
      }
    };
    const backend: GuidedStartBackend = {
      listPlans: async () => plans,
      prepareRepository: async () => ({
        repositoryRoot: "/workspace/account-status",
        confirmedTargets,
        repositoryDifferences
      }),
      approve: async () => undefined,
      start: async (input) => {
        startInput = input;
        return { runId: RunId.make("run-confirmed-targets"), state: "completed" };
      }
    };

    await runGuidedStart({ backend, prompts, adapterCatalog });

    assert.deepEqual(confirmationInput?.confirmedTargets, confirmedTargets);
    assert.deepEqual(confirmationInput?.repositoryDifferences, repositoryDifferences);
    assert.deepEqual(startInput?.confirmedTargets, confirmedTargets);
  });

  it("starts nothing when a target changes during guided confirmation", async () => {
    let preparation = 0;
    let approved = false;
    let started = false;
    const prompts: GuidedStartPrompts = {
      selectPlan: async (options) => options[0]!,
      showPlan: () => undefined,
      selectModel: async () => model,
      confirmStart: async () => true
    };
    const backend: GuidedStartBackend = {
      listPlans: async () => plans,
      prepareRepository: async () => ({
        repositoryRoot: "/workspace/account-status",
        confirmedTargets:
          preparation++ === 0
            ? [{ targetPath: "src/schema.ts", state: "absent" as const }]
            : [
                {
                  targetPath: "src/schema.ts",
                  state: "file" as const,
                  contentDigest: "sha256:appeared"
                }
              ],
        repositoryDifferences: []
      }),
      approve: async () => {
        approved = true;
      },
      start: async () => {
        started = true;
        return { runId: RunId.make("unreachable"), state: "completed" };
      }
    };

    await assert.rejects(
      runGuidedStart({ backend, prompts, adapterCatalog }),
      /Repository targets changed during guided confirmation/
    );
    assert.equal(approved, false);
    assert.equal(started, false);
  });

  it("rejects an unadvertised explicit variant before confirmation, approval, or start", async () => {
    const events: string[] = [];
    const variantCatalog: RuntimeAdapterCatalog<AdapterConfiguration> = {
      ...adapterCatalog,
      discoverModels: Effect.succeed([variantModel])
    };
    const prompts: GuidedStartPrompts = {
      selectPlan: async (options) => options[0]!,
      showPlan: () => undefined,
      selectModel: async () => variantModel,
      selectVariant: async () => {
        events.push("variant-question");
        return null;
      },
      confirmStart: async () => {
        events.push("confirm");
        return true;
      }
    };
    const backend: GuidedStartBackend = {
      listPlans: async () => plans,
      prepareRepository: async () => ({
        repositoryRoot: "/workspace/account-status",
        confirmedTargets: [],
        repositoryDifferences: []
      }),
      approve: async () => {
        events.push("approve");
      },
      start: async () => {
        events.push("start");
        return { runId: RunId.make("unreachable"), state: "completed" };
      }
    };

    await assert.rejects(
      runGuidedStart({
        backend,
        prompts,
        adapterCatalog: variantCatalog,
        variantOverride: "turbo"
      }),
      /does not advertise variant turbo/
    );
    assert.deepEqual(events, []);
  });

  it("persists and forwards a guided variant while atomically applying every candidate", async () => {
    const root = mkdtempSync(join(tmpdir(), "score-guided-no-export-"));
    const scoreDatabasePath = join(root, "score.db");
    const runnerDatabasePath = join(root, "runner.db");
    try {
      const repositoryRoot = createFixtureGitRepository(root);
      const score = ScoreAlpha.open(scoreDatabasePath);
      score.initializeAcceptedInputs(createAcceptedInputPacket());
      const submitted = score.submitCompilation(readBundle(), {
        compiler_name: "codex-existing-agent",
        model_id: "openai/gpt-5",
        received_at: "2026-08-07T15:00:00.000Z",
        label: "guided-no-export"
      });
      assert.ok(submitted.manifest_id);
      const review = score.prepareReview(
        submitted.manifest_id,
        "2026-08-07T15:01:00.000Z"
      );
      score.decidePublication({
        review_id: review.review_id,
        authority: "test-human-authority",
        decided_at: "2026-08-07T15:02:00.000Z",
        decision: "approve",
        expected_digest_set: review.digest_set,
        warning_waivers: [],
        rationale: "Synthetic approval in an isolated guided Runner test."
      });
      score.close();

      const plan = ScoreAlpha.listReviewedChangePlans(scoreDatabasePath)[0];
      assert.ok(plan);
      const claimedVariants: Array<string | null> = [];
      const progressOutput: string[] = [];
      let progressClears = 0;
      const runtimeLayer = Layer.succeed(
        OpenCodeAdapter,
        testOpenCodeAdapter({
          invoke: (job) => {
            claimedVariants.push(job.variantId);
            return Effect.succeed({
              content:
                job.targetPath === "src/schema.ts"
                  ? 'import type { ExternalAccount } from "@project/dependency";\n\nexport interface Account {\n  id: string;\n  name: string;\n  status: "active" | "suspended";\n}\n'
                  : 'import type { Account } from "./schema.js";\n\nexport function formatAccountLabel(account: Account): string {\n  return `${account.name} [${account.status}]`;\n}\n',
              runtimeSessionId: `synthetic-${job.targetPath}`,
              targetOutputState:
                job.targetPath === "src/schema.ts" ? "different" : "present"
            });
          }
        })
      );
      const backend = makeGuidedStartBackend({
        scoreDatabasePath,
        runnerDatabasePath,
        invokingDirectory: repositoryRoot,
        adapterCatalog,
        runtimeLayer,
        progress: {
          now: () => Date.parse("2026-08-11T18:00:00.000Z"),
          schedule: () => ({
            clear: () => {
              progressClears += 1;
            }
          }),
          terminal: {
            mode: "append",
            write: (text) => progressOutput.push(text)
          }
        }
      });
      writeFileSync(
        join(repositoryRoot, "src/schema.ts"),
        "// current schema differs from the original plan\n",
        "utf8"
      );
      writeFileSync(
        join(repositoryRoot, "src/account-label.ts"),
        "// a create target is already occupied\n",
        "utf8"
      );
      const preparedRepository = await backend.prepareRepository(plan);
      assert.deepEqual(preparedRepository.repositoryDifferences, [
        { kind: "occupied", path: "src/account-label.ts" },
        { kind: "changed", path: "src/schema.ts" }
      ]);

      const result = await backend.start({
        plan,
        model: variantModel,
        variant: variantModel.variants[0]!,
        concurrency: 2,
        repositoryRoot,
        confirmedTargets: preparedRepository.confirmedTargets
      });

      assert.equal(result.state, "completed");
      assert.deepEqual(Object.keys(result).toSorted(), ["runId", "state"]);
      assert.deepEqual(readdirSync(root).toSorted(), [
        "repository",
        "runner.db",
        "score.db",
        "score.db-shm",
        "score.db-wal"
      ]);

      assert.equal(
        readFileSync(join(repositoryRoot, "src/schema.ts"), "utf8"),
        'import type { ExternalAccount } from "@project/dependency";\n\nexport interface Account {\n  id: string;\n  name: string;\n  status: "active" | "suspended";\n}\n'
      );
      assert.equal(
        readFileSync(join(repositoryRoot, "src/account-label.ts"), "utf8"),
        'import type { Account } from "./schema.js";\n\nexport function formatAccountLabel(account: Account): string {\n  return `${account.name} [${account.status}]`;\n}\n'
      );
      assert.match(
        execFileSync("git", ["-C", repositoryRoot, "diff", "--", "src/schema.ts"], {
          encoding: "utf8"
        }),
        /status: "active" \| "suspended"/
      );
      assert.match(
        execFileSync("git", ["-C", repositoryRoot, "status", "--short"], {
          encoding: "utf8"
        }),
        /\?\? src\/account-label\.ts/
      );
      const storedRun = await Effect.runPromise(inspectRun(runnerDatabasePath, result.runId));
      assert.equal(storedRun.applicationState, "applied");
      assert.equal(storedRun.adapter.variantId, "low");
      assert.deepEqual(storedRun.acceptedMissingReplacementPaths, []);
      assert.deepEqual(storedRun.confirmedTargets, preparedRepository.confirmedTargets);
      assert.deepEqual(claimedVariants, ["low", "low"]);
      assert.equal(storedRun.repositoryRoot, realpathSync(repositoryRoot));
      assert.ok(storedRun.appliedAt);
      assert.equal(
        storedRun.observation.files.find((file) => file.targetPath === "src/schema.ts")
          ?.targetOutputState,
        "different"
      );
      assert.equal(
        storedRun.observation.files.find(
          (file) => file.targetPath === "src/account-label.ts"
        )?.targetOutputState,
        "present"
      );
      assert.match(
        progressOutput.join(""),
        /Running Account Status two-file change\nOpenCode Zen · GPT-5\.4 · Low reasoning · Run [0-9a-f]{8}/u
      );
      assert.match(progressOutput.join(""), /src\/schema\.ts/u);
      assert.match(progressOutput.join(""), /src\/account-label\.ts/u);
      assert.equal(progressClears, 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("applies declared targets when live read-only context changes during execution", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "score-guided-readonly-context-"));
    const scoreDatabasePath = join(projectRoot, ".score", "score.db");
    const runnerDatabasePath = join(projectRoot, ".score", "runner.db");
    try {
      mkdirSync(join(projectRoot, "src"), { recursive: true });
      writeFileSync(join(projectRoot, "package.json"), '{"type":"module"}\n', "utf8");
      writeFileSync(
        join(projectRoot, "tsconfig.json"),
        '{"compilerOptions":{"module":"NodeNext","moduleResolution":"NodeNext","target":"ES2024","strict":true,"skipLibCheck":true,"types":[]},"include":["src/**/*.ts"]}\n',
        "utf8"
      );
      writeFileSync(
        join(projectRoot, "src", "schema.ts"),
        "export interface Account { id: string; }\n",
        "utf8"
      );
      writeFileSync(
        join(projectRoot, "src", "example.ts"),
        'export const exampleAccountId: string = "a-1";\n',
        "utf8"
      );
      const sliceDraft: SliceDraft = {
        slice_id: "frozen-context",
        title: "Frozen Context",
        objective: "Add account status while using one frozen example as context.",
        requirements: ["Account exposes an active or suspended status."],
        files: [
          {
            path: "src/schema.ts",
            operation: "modify",
            task: "Add status to Account.",
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
            context: [
              {
                path: "src/example.ts",
                purpose: "Preserve the existing example shape while adding status."
              }
            ],
            skills: [],
            constraints: []
          }
        ]
      };
      const prepared = prepareSlice({ projectRoot, sliceDraft });
      assert.equal(prepared.status, "review_ready");
      const score = ScoreAlpha.open(scoreDatabasePath);
      const pendingPlan = ScoreAlpha.listReviewedChangePlans(scoreDatabasePath)[0];
      assert.ok(pendingPlan);
      score.decidePublication({
        review_id: pendingPlan.reviewId,
        authority: "test-human-authority",
        decided_at: "2026-08-07T16:00:00.000Z",
        decision: "approve",
        expected_digest_set: pendingPlan.digestSet,
        warning_waivers: [],
        rationale: "Synthetic approval for the read-only context drift boundary."
      });
      score.close();
      const plan = ScoreAlpha.listReviewedChangePlans(scoreDatabasePath)[0];
      assert.ok(plan);
      const runtimeLayer = Layer.succeed(
        OpenCodeAdapter,
        testOpenCodeAdapter({
          invoke: () =>
            Effect.sync(() => {
              rmSync(join(projectRoot, "src", "example.ts"));
              return {
                content:
                  'export interface Account { id: string; status: "active" | "suspended"; }\n',
                runtimeSessionId: "synthetic-readonly-context"
              };
            })
        })
      );
      const backend = makeGuidedStartBackend({
        scoreDatabasePath,
        runnerDatabasePath,
        invokingDirectory: projectRoot,
        adapterCatalog,
        runtimeLayer
      });
      const preparedRepository = await backend.prepareRepository(plan);

      const result = await backend.start({
        plan,
        model,
        variant: null,
        concurrency: 1,
        repositoryRoot: projectRoot,
        confirmedTargets: preparedRepository.confirmedTargets
      });

      assert.equal(result.state, "completed");
      const storedRun = await Effect.runPromise(inspectRun(runnerDatabasePath, result.runId));
      assert.equal(storedRun.applicationState, "applied");
      assert.equal(existsSync(join(projectRoot, "src", "example.ts")), false);
      assert.match(readFileSync(join(projectRoot, "src", "schema.ts"), "utf8"), /status/);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("applies nothing when the repository drifts after execution starts", async () => {
    const root = mkdtempSync(join(tmpdir(), "score-guided-drift-"));
    const scoreDatabasePath = join(root, "score.db");
    const runnerDatabasePath = join(root, "runner.db");
    const repositoryRoot = createFixtureGitRepository(root);
    try {
      const score = ScoreAlpha.open(scoreDatabasePath);
      score.initializeAcceptedInputs(createAcceptedInputPacket());
      const submitted = score.submitCompilation(readBundle(), {
        compiler_name: "codex-existing-agent",
        model_id: "openai/gpt-5",
        received_at: "2026-08-07T15:10:00.000Z",
        label: "guided-drift"
      });
      assert.ok(submitted.manifest_id);
      const review = score.prepareReview(
        submitted.manifest_id,
        "2026-08-07T15:11:00.000Z"
      );
      score.decidePublication({
        review_id: review.review_id,
        authority: "test-human-authority",
        decided_at: "2026-08-07T15:12:00.000Z",
        decision: "approve",
        expected_digest_set: review.digest_set,
        warning_waivers: [],
        rationale: "Synthetic approval in a repository drift test."
      });
      score.close();
      const plan = ScoreAlpha.listReviewedChangePlans(scoreDatabasePath)[0];
      assert.ok(plan);
      const runtimeLayer = Layer.succeed(
        OpenCodeAdapter,
        testOpenCodeAdapter({
          invoke: (job) =>
            Effect.sync(() => {
              if (job.targetPath === "src/schema.ts") {
                writeFileSync(
                  join(repositoryRoot, "src/schema.ts"),
                  "// user edit while agents were running\n",
                  "utf8"
                );
              }
              return {
                content:
                  job.targetPath === "src/schema.ts"
                    ? 'export interface Account {\n  id: string;\n  name: string;\n  status: "active" | "suspended";\n}\n'
                    : 'import type { Account } from "./schema.js";\n\nexport function formatAccountLabel(account: Account): string {\n  return `${account.name} [${account.status}]`;\n}\n',
                runtimeSessionId: `synthetic-${job.targetPath}`
              };
            })
        })
      );
      const backend = makeGuidedStartBackend({
        scoreDatabasePath,
        runnerDatabasePath,
        invokingDirectory: repositoryRoot,
        adapterCatalog,
        runtimeLayer
      });
      const preparedRepository = await backend.prepareRepository(plan);

      await assert.rejects(
        backend.start({
          plan,
          model,
          variant: null,
          concurrency: 1,
          repositoryRoot,
          confirmedTargets: preparedRepository.confirmedTargets
        }),
        (error: unknown) => {
          assert.ok(error instanceof RepositoryDriftError);
          assert.deepEqual(error.findings, [{ kind: "changed", path: "src/schema.ts" }]);
          assert.equal(error.repositoryRoot, realpathSync(repositoryRoot));
          return true;
        }
      );
      assert.equal(
        readFileSync(join(repositoryRoot, "src/schema.ts"), "utf8"),
        "// user edit while agents were running\n"
      );
      assert.equal(existsSync(join(repositoryRoot, "src/account-label.ts")), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("selects a titled plan, approves it without asking for rationale, selects an adapter model, and defaults concurrency to five", async () => {
    const events: string[] = [];
    const approvals: string[] = [];
    const starts: Array<{
      plan: ReviewedChangePlan;
      model: RuntimeModel;
      concurrency: number;
      repositoryRoot: string;
    }> = [];
    const prompts: GuidedStartPrompts = {
      selectPlan: async (options) => {
        events.push(`plans:${options.map((option) => option.label).join(",")}`);
        return options[0]!;
      },
      showPlan: (plan) => {
        events.push(`show:${plan.label}:${plan.files.join(",")}`);
      },
      selectModel: async (_adapterCatalog, models) => {
        events.push(`models:${models.map((option) => option.label).join(",")}`);
        return models[0]!;
      },
      selectVariant: async () => {
        throw new Error("A model without variants must skip the variant question");
      },
      confirmStart: async (input) => {
        events.push(`confirm:${input.plan.label}:${input.model.label}:${input.willApprove}`);
        return true;
      }
    };
    const backend: GuidedStartBackend = {
      listPlans: async () => plans,
      prepareRepository: async (plan) => {
        events.push(`repository:${plan.label}`);
        return {
          repositoryRoot: "/workspace/account-status",
          confirmedTargets: [],
          repositoryDifferences: []
        };
      },
      approve: async (plan) => {
        approvals.push(plan.label);
      },
      start: async (input) => {
        starts.push(input);
        return {
          runId: RunId.make("run-a"),
          state: "completed"
        };
      }
    };
    const result = await runGuidedStart({
      backend,
      prompts,
      adapterCatalog
    });

    assert.deepEqual(events, [
      "plans:Account Status,Billing Cleanup",
      "show:Account Status:src/schema.ts,src/account-label.ts",
      "repository:Account Status",
      "models:Claude Sonnet 4.6",
      "confirm:Account Status:Claude Sonnet 4.6:true",
      "repository:Account Status"
    ]);
    assert.deepEqual(approvals, ["Account Status"]);
    assert.deepEqual(starts, [
      {
        plan: plans[0],
        model,
        variant: null,
        concurrency: 5,
        repositoryRoot: "/workspace/account-status",
        confirmedTargets: []
      }
    ]);
    assert.deepEqual(result, {
      runId: RunId.make("run-a"),
      state: "completed"
    });
  });

  it("treats a declined confirmation as a clean cancellation before approval", async () => {
    const approvals: string[] = [];
    let started = false;
    const prompts: GuidedStartPrompts = {
      selectPlan: async (options) => options[0]!,
      showPlan: () => undefined,
      selectModel: async (_adapterCatalog, models) => models[0]!,
      confirmStart: async () => false
    };
    const backend: GuidedStartBackend = {
      listPlans: async () => plans,
      prepareRepository: async () => ({
        repositoryRoot: "/workspace/account-status",
        confirmedTargets: [],
        repositoryDifferences: []
      }),
      approve: async (plan) => {
        approvals.push(plan.label);
      },
      start: async () => {
        started = true;
        throw new Error("unreachable");
      }
    };
    await assert.rejects(
      runGuidedStart({ backend, prompts, adapterCatalog }),
      GuidedStartCancelled
    );
    assert.deepEqual(approvals, []);
    assert.equal(started, false);
  });
});
