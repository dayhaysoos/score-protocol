#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseJsonNoDuplicateKeys } from "./canonical.js";
import type { PrepareChangeResult } from "./change-authoring.js";
import type { ReviewDigestSet, ReviewSnapshot } from "./score-alpha.js";
import { terminalSafeJson } from "./runner/terminal-safe-json.js";
import {
  isRunnerCliCommand,
  RUNNER_CLI_COMMANDS
} from "./runner/cli-commands.js";

const CHANGE_USAGE = "Usage: score change --input -\n";
const CHANGE_HELP =
  CHANGE_USAGE +
  "       score change --schema\n\n" +
  "Prepares an immutable HTML review only; it does not approve, run, or apply the Change.\n" +
  "Omit change_id for a new Change. Reuse SCORE's returned changeId as change_id for a complete revision.\n";
const SCORE_USAGE =
  "Usage: score change --input -\n" +
  "       score change --schema\n" +
  "       score skill [score-authoring|how-to-score] [--path]\n" +
  "       score doctor [--json]\n" +
  `       score ${RUNNER_CLI_COMMANDS.join("|")} [options]\n`;
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SKILLS = {
  "score-authoring": join(PACKAGE_ROOT, "skills", "score-authoring", "SKILL.md"),
  "how-to-score": join(PACKAGE_ROOT, "skills", "how-to-score", "SKILL.md")
} as const;

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requiredOption(name: string): string {
  const value = option(name);
  if (!value) throw new Error(`Missing required --${name} option`);
  return value;
}

function writeCompactJson(value: unknown): void {
  process.stdout.write(`${terminalSafeJson(value)}\n`);
}

function runSkillCommand(args: ReadonlyArray<string>): void {
  const pathOnly = args.includes("--path");
  const names = args.filter((arg) => arg !== "--path");
  if (names.length > 1 || args.some((arg) => arg !== "--path" && !(arg in SKILLS))) {
    process.stderr.write("Usage: score skill [score-authoring|how-to-score] [--path]\n");
    process.exitCode = 64;
    return;
  }
  const name = (names[0] ?? "score-authoring") as keyof typeof SKILLS;
  const path = SKILLS[name];
  process.stdout.write(pathOnly ? `${path}\n` : readFileSync(path, "utf8"));
}

async function importWithExperimentalWarningsDisabled<T>(
  load: () => Promise<T>
): Promise<T> {
  const emitWarning = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...args: ReadonlyArray<unknown>) => {
    const options = args[0];
    const type =
      typeof options === "string"
        ? options
        : typeof options === "object" && options !== null && "type" in options
          ? options.type
          : undefined;
    if (type === "ExperimentalWarning") return;
    Reflect.apply(emitWarning, process, [warning, ...args]);
  }) as typeof process.emitWarning;
  try {
    return await load();
  } finally {
    process.emitWarning = emitWarning;
  }
}

function invalidJsonInput(): PrepareChangeResult {
  return {
    status: "invalid",
    findings: [
      {
        code: "CHANGE_JSON_INVALID",
        location: "/",
        message: "Change input must be one valid JSON object with no duplicate keys",
        detail: {},
        machineRepairable: true
      }
    ]
  };
}

async function runChangeCommand(args: ReadonlyArray<string>): Promise<void> {
  if (args.length === 1 && args[0] === "--help") {
    process.stdout.write(CHANGE_HELP);
    return;
  }
  if (args.length === 1 && args[0] === "--schema") {
    const { CHANGE_DRAFT_SCHEMA } = await import("./change-authoring.js");
    writeCompactJson(CHANGE_DRAFT_SCHEMA);
    return;
  }
  if (args.length !== 2 || args[0] !== "--input" || args[1] !== "-") {
    process.stderr.write(CHANGE_USAGE);
    process.exitCode = 64;
    return;
  }

  let changeDraft: unknown;
  try {
    changeDraft = parseJsonNoDuplicateKeys(readFileSync(0, "utf8"));
  } catch {
    writeCompactJson(invalidJsonInput());
    process.exitCode = 2;
    return;
  }

  const { prepareChange } = await import("./change-authoring.js");
  const result = prepareChange({ projectRoot: process.cwd(), changeDraft });
  writeCompactJson(result);
  if (result.status === "invalid") process.exitCode = 2;
}

async function runLegacyAlphaCommand(command: string): Promise<boolean> {
  const databasePath = join(process.cwd(), "output", "score.db");
  if (command === "reproduce") {
    const { reproduceDraft } = await import("./workflow.js");
    const result = reproduceDraft();
    process.stdout.write(`${terminalSafeJson(result, 2)}\n`);
    return true;
  }
  if (command === "inspect") {
    const { ScoreAlpha } = await import("./score-alpha.js");
    const score = ScoreAlpha.open(databasePath);
    try {
      process.stdout.write(`${terminalSafeJson(score.inspectViews(), 2)}\n`);
    } finally {
      score.close();
    }
    return true;
  }
  if (command === "approve") {
    const { ScoreAlpha } = await import("./score-alpha.js");
    const authority = requiredOption("authority");
    const rationale = option("rationale") ?? "Approved through the local CLI.";
    const snapshot = JSON.parse(
      readFileSync(join(process.cwd(), "output", "publication-review.snapshot.json"), "utf8")
    ) as ReviewSnapshot;
    const digestSet = JSON.parse(
      readFileSync(join(process.cwd(), "output", "digest-set.json"), "utf8")
    ) as ReviewDigestSet;
    const score = ScoreAlpha.open(databasePath);
    try {
      const decision = score.decidePublication({
        review_id: snapshot.review_id,
        authority,
        decided_at: new Date().toISOString(),
        decision: "approve",
        expected_digest_set: digestSet,
        warning_waivers: [],
        rationale
      });
      process.stdout.write(`${terminalSafeJson(decision, 2)}\n`);
    } finally {
      score.close();
    }
    return true;
  }
  if (command === "export") {
    const { ScoreAlpha } = await import("./score-alpha.js");
    const passId = requiredOption("pass");
    const score = ScoreAlpha.open(databasePath);
    try {
      const exported = score.exportApprovedPass(passId);
      const path = join(process.cwd(), "output", "approved-payloads.json");
      writeFileSync(path, `${JSON.stringify(exported, null, 2)}\n`, "utf8");
      process.stdout.write(`${path}\n`);
    } finally {
      score.close();
    }
    return true;
  }
  return false;
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === "doctor") {
    const { runDoctorCli } = await importWithExperimentalWarningsDisabled(
      () => import("./doctor-cli.js")
    );
    process.exitCode = await runDoctorCli(process.argv.slice(3));
    return;
  }
  if (command === "change") {
    await runChangeCommand(process.argv.slice(3));
    return;
  }
  if (command === "skill") {
    runSkillCommand(process.argv.slice(3));
    return;
  }
  if (command === "--help" || command === "-h" || command === undefined) {
    process.stdout.write(SCORE_USAGE);
    return;
  }
  if (isRunnerCliCommand(command)) {
    const { runRunnerCli } = await importWithExperimentalWarningsDisabled(
      () => import("./runner/cli.js")
    );
    await runRunnerCli();
    return;
  }
  if (await runLegacyAlphaCommand(command)) return;
  process.stderr.write(SCORE_USAGE);
  process.exitCode = 64;
}

main().catch(() => {
  process.stderr.write("SCORE could not complete the command. No unreviewed work was applied.\n");
  process.exitCode = 1;
});
