export const RUNNER_CLI_COMMANDS = [
  "list",
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
