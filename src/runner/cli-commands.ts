export const RUNNER_CLI_COMMANDS = [
  "list",
  "approve",
  "enqueue",
  "start",
  "work",
  "recover",
  "status",
  "export-candidates",
  "counts"
] as const;

export type RunnerCliCommand = (typeof RUNNER_CLI_COMMANDS)[number];

const runnerCliCommandSet = new Set<string>(RUNNER_CLI_COMMANDS);

export function isRunnerCliCommand(value: string): value is RunnerCliCommand {
  return runnerCliCommandSet.has(value);
}

export const RUNNER_CLI_USAGE =
  `Usage: score ${RUNNER_CLI_COMMANDS.join("|")} [options]\n`;

export const RUNNER_CLI_HELP: Readonly<Record<RunnerCliCommand, string>> = {
  list: "Usage: score list [--score-db <path>] [--runner-db <path>]\n",
  approve: "Usage: score approve --pass <id> [--score-db <path>]\n",
  enqueue:
    "Usage: score enqueue --pass <id> --provider <id> --model <id> [--variant <id>] [--repo <path>] [--concurrency <n>]\n",
  start:
    "Usage: score start [--repo <path>] [--concurrency <n>]\n" +
    "       score start --pass <id> --provider <id> --model <id> [--variant <id>] [--repo <path>] [--concurrency <n>]\n",
  work: "Usage: score work --run <id>\n",
  recover: "Usage: score recover --run <id>\n",
  status: "Usage: score status [--run <id>]\n",
  "export-candidates": "Usage: score export-candidates --run <id> --destination <path>\n",
  counts: "Usage: score counts [--runner-db <path>]\n"
};
