import Table from "cli-table3";
import { createLogUpdate } from "log-update";
import stringWidth from "string-width";

import type { RunObservation } from "./domain.js";
import { terminalSafeLine } from "./terminal-safe-line.js";

export type RunProgressObservation = RunObservation;
export type RunProgressStage = RunProgressObservation["files"][number]["stage"];
export type RunProgressPhase = RunProgressObservation["phase"];

export interface RunProgressRenderer {
  readonly update: (observation: RunProgressObservation) => void;
  readonly close: () => void;
}

export interface RunProgressDisplayHeader {
  readonly planLabel?: string;
  readonly modelLabel: string;
  readonly providerLabel: string;
  readonly variantLabel?: string;
}

export interface RunProgressTimer {
  readonly clear: () => void;
  readonly unref?: () => void;
}

export type RunProgressSchedule = (
  callback: () => void,
  intervalMs: number
) => RunProgressTimer;

export type RunProgressTerminal =
  | {
      readonly mode: "tty";
      readonly repaint: (text: string) => void;
      readonly done: () => void;
      readonly width?: () => number;
      readonly animation?: boolean;
    }
  | {
      readonly mode: "append";
      readonly write: (text: string) => void;
      readonly width?: () => number;
    };

export type RunProgressOutputStream = NodeJS.WritableStream & {
  readonly isTTY?: boolean;
  readonly columns?: number;
};

export interface RunProgressRendererOptions {
  readonly header: RunProgressDisplayHeader;
  readonly now: () => number;
  readonly schedule: RunProgressSchedule;
  readonly terminal: RunProgressTerminal;
}

const DEFAULT_TTY_WIDTH = 80;
const DEFAULT_APPEND_WIDTH = 80;
const MAX_TABLE_WIDTH = 120;
const WIDE_TABLE_MIN_WIDTH = 48;
const TTY_ANIMATION_INTERVAL_MS = 100;
const APPEND_HEARTBEAT_INTERVAL_MS = 5_000;
const REDUCED_MOTION_REFRESH_INTERVAL_MS = 5_000;
const STATUS_COLUMN_WIDTH = 17;
const ELAPSED_COLUMN_WIDTH = 7;
const COLUMN_GUTTER_WIDTH = 2;
const TABLE_FIXED_WIDTH =
  STATUS_COLUMN_WIDTH + ELAPSED_COLUMN_WIDTH + COLUMN_GUTTER_WIDTH * 2;
const RUNNER_SPINNER_FRAMES = [
  "⠋",
  "⠙",
  "⠹",
  "⠸",
  "⠼",
  "⠴",
  "⠦",
  "⠧",
  "⠇",
  "⠏"
] as const;
const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: "grapheme"
});

const TABLE_CHARACTERS = {
  top: "",
  "top-mid": "",
  "top-left": "",
  "top-right": "",
  bottom: "",
  "bottom-mid": "",
  "bottom-left": "",
  "bottom-right": "",
  left: "",
  "left-mid": "",
  mid: "─",
  "mid-mid": "  ",
  right: "",
  "right-mid": "",
  middle: "  "
} as const;

function graphemes(value: string): string[] {
  return Array.from(graphemeSegmenter.segment(value), ({ segment }) => segment);
}

function truncateEnd(value: string, maximumWidth: number): string {
  if (maximumWidth <= 0) return "";
  if (stringWidth(value) <= maximumWidth) return value;
  if (maximumWidth === 1) return "…";
  let result = "";
  for (const grapheme of graphemes(value)) {
    if (stringWidth(`${result}${grapheme}…`) > maximumWidth) break;
    result += grapheme;
  }
  return `${result}…`;
}

function truncateMiddle(value: string, maximumWidth: number): string {
  if (maximumWidth <= 0) return "";
  if (stringWidth(value) <= maximumWidth) return value;
  if (maximumWidth === 1) return "…";

  const segments = graphemes(value);
  const availableWidth = maximumWidth - 1;
  const prefixBudget = Math.max(1, Math.floor(availableWidth * 0.4));
  let prefix = "";
  let prefixEnd = 0;
  while (prefixEnd < segments.length) {
    const next = `${prefix}${segments[prefixEnd]}`;
    if (stringWidth(next) > prefixBudget) break;
    prefix = next;
    prefixEnd += 1;
  }

  const suffixBudget = availableWidth - stringWidth(prefix);
  let suffix = "";
  let suffixStart = segments.length;
  while (suffixStart > prefixEnd) {
    const next = `${segments[suffixStart - 1]}${suffix}`;
    if (stringWidth(next) > suffixBudget) break;
    suffix = next;
    suffixStart -= 1;
  }

  return `${prefix}…${suffix}`;
}

function wrapDisplay(value: string, maximumWidth: number): string[] {
  if (value.length === 0) return [];
  const lines: string[] = [];
  let line = "";
  for (const grapheme of graphemes(value)) {
    if (stringWidth(grapheme) > maximumWidth) {
      if (line.length > 0) {
        lines.push(line);
        line = "";
      }
      lines.push(truncateEnd(grapheme, maximumWidth));
      continue;
    }
    if (stringWidth(`${line}${grapheme}`) > maximumWidth) {
      lines.push(line);
      line = grapheme;
    } else {
      line += grapheme;
    }
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

function normalizeWidth(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(1, Math.min(MAX_TABLE_WIDTH, Math.floor(value)));
}

function terminalWidth(
  terminal: RunProgressTerminal,
  fallback: number
): number {
  try {
    return normalizeWidth(terminal.width?.(), fallback);
  } catch {
    return fallback;
  }
}

export const scheduleRunProgressRefresh: RunProgressSchedule = (callback, intervalMs) => {
  const timer = setInterval(callback, intervalMs);
  return {
    clear: () => clearInterval(timer),
    unref: () => timer.unref()
  };
};

export function createRunProgressTerminal(
  stream: RunProgressOutputStream = process.stdout
): RunProgressTerminal {
  if (stream.isTTY === true) {
    const repaint = createLogUpdate(stream, { showCursor: true });
    return {
      mode: "tty",
      repaint: (text) => repaint(text),
      done: () => repaint.done(),
      width: () => normalizeWidth(stream.columns, DEFAULT_TTY_WIDTH),
      animation:
        process.env.TERM !== "dumb" &&
        process.env.CI === undefined &&
        process.env.SCORE_REDUCED_MOTION !== "1"
    };
  }
  return {
    mode: "append",
    write: (text) => {
      stream.write(text);
    },
    width: () => normalizeWidth(stream.columns, DEFAULT_APPEND_WIDTH)
  };
}

function elapsed(startedAt: string, endedAt: number): string {
  const seconds = Math.max(0, Math.floor((endedAt - Date.parse(startedAt)) / 1_000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function marker(stage: RunProgressStage): string {
  switch (stage) {
    case "waiting":
      return "○";
    case "succeeded":
      return "✓";
    case "failed":
      return "×";
    case "needs attention":
      return "!";
    default:
      return "●";
  }
}

function headerLines(
  header: RunProgressDisplayHeader,
  observation: RunProgressObservation,
  width: number
): string[] {
  const planLabel =
    header.planLabel === undefined ? undefined : terminalSafeLine(header.planLabel);
  const heading =
    planLabel === undefined || planLabel.length === 0 ? "Running" : `Running ${planLabel}`;
  const runtimeIdentity = [
    terminalSafeLine(header.providerLabel),
    terminalSafeLine(header.modelLabel),
    header.variantLabel === undefined ? undefined : terminalSafeLine(header.variantLabel),
    `Run ${observation.runId.slice(0, 8)}`
  ].filter((value): value is string => value !== undefined && value.length > 0);
  const metadata = runtimeIdentity.join(" · ");
  return stringWidth(metadata) <= width
    ? [truncateEnd(heading, width), metadata]
    : [
        ...wrapDisplay(heading, width),
        ...runtimeIdentity.flatMap((value) => wrapDisplay(value, width))
      ];
}

function phaseLabel(phase: RunProgressPhase): string {
  return `${phase[0]?.toUpperCase() ?? ""}${phase.slice(1)}`;
}

function completedCount(observation: RunProgressObservation): number {
  return observation.files.filter(
    (file) =>
      file.stage === "succeeded" ||
      file.stage === "failed" ||
      file.stage === "needs attention"
  ).length;
}

function applicationLabel(observation: RunProgressObservation): string {
  switch (observation.application.state) {
    case "not_applied":
      return "Nothing applied";
    case "applying":
      return "Atomic application in progress; final outcome pending";
    case "applied":
      return "All candidates applied";
    case "apply_failed":
      return "Application failed; inspect status";
  }
}

function targetLabel(
  file: RunProgressObservation["files"][number]
): string {
  const projectedTarget = terminalSafeLine(file.targetPath);
  return projectedTarget.length > 0
    ? projectedTarget
    : `[unprintable target; Job ${file.jobId}]`;
}

function fileElapsed(
  file: RunProgressObservation["files"][number],
  now: number
): string {
  if (file.claimedAt === null) return "—";
  return elapsed(
    file.claimedAt,
    file.terminalAt === null ? now : Date.parse(file.terminalAt)
  );
}

function statusLabel(file: RunProgressObservation["files"][number]): string {
  return `${marker(file.stage)} ${file.stage}`;
}

function wideFileTable(
  files: ReadonlyArray<RunProgressObservation["files"][number]>,
  now: number,
  width: number,
  includeHeader: boolean
): string {
  const fileWidth = width - TABLE_FIXED_WIDTH;
  const projectedRows = files.map((file) => {
    const target = truncateMiddle(targetLabel(file), fileWidth);
    return {
      target,
      placeholder: "x".repeat(stringWidth(target)),
      status: statusLabel(file),
      elapsed: fileElapsed(file, now)
    };
  });
  const table = new Table({
    ...(includeHeader ? { head: ["FILE", "STATUS", "ELAPSED"] } : {}),
    chars: TABLE_CHARACTERS,
    colWidths: [fileWidth, STATUS_COLUMN_WIDTH, ELAPSED_COLUMN_WIDTH],
    colAligns: ["left", "left", "right"],
    truncate: "…",
    wordWrap: false,
    style: {
      head: [],
      border: [],
      compact: true,
      "padding-left": 0,
      "padding-right": 0
    }
  });
  for (const row of projectedRows) {
    table.push([row.placeholder, row.status, row.elapsed]);
  }
  const lines = table.toString().split("\n");
  const firstRowIndex = includeHeader ? 2 : 0;
  for (const [index, row] of projectedRows.entries()) {
    const lineIndex = firstRowIndex + index;
    const line = lines[lineIndex];
    if (line === undefined || !line.startsWith(row.placeholder)) {
      throw new Error("Table renderer returned an unexpected row shape");
    }
    lines[lineIndex] = `${row.target}${line.slice(row.placeholder.length)}`;
  }
  return lines.join("\n");
}

function narrowFileTable(
  files: ReadonlyArray<RunProgressObservation["files"][number]>,
  now: number,
  width: number,
  includeHeader: boolean
): string {
  const lines = includeHeader
    ? [truncateEnd("FILES", width), "─".repeat(width)]
    : [];
  for (const file of files) {
    lines.push(truncateMiddle(targetLabel(file), width));
    lines.push(
      truncateEnd(`  ${statusLabel(file)} · ${fileElapsed(file, now)}`, width)
    );
  }
  return lines.join("\n");
}

function fileTable(
  files: ReadonlyArray<RunProgressObservation["files"][number]>,
  now: number,
  width: number,
  includeHeader: boolean
): string {
  return width >= WIDE_TABLE_MIN_WIDTH
    ? wideFileTable(files, now, width, includeHeader)
    : narrowFileTable(files, now, width, includeHeader);
}

function runStateLabel(observation: RunProgressObservation): string {
  return `${phaseLabel(observation.phase)} · ${completedCount(observation)}/${observation.files.length} complete`;
}

function runElapsed(observation: RunProgressObservation, now: number): string {
  return elapsed(
    observation.createdAt,
    observation.terminalAt === null ? now : Date.parse(observation.terminalAt)
  );
}

function wrapWords(value: string, width: number): string[] {
  if (width <= 0) return [""];
  const lines: string[] = [];
  let line = "";
  for (const word of value.split(" ")) {
    const candidate = line.length === 0 ? word : `${line} ${word}`;
    if (stringWidth(candidate) <= width) {
      line = candidate;
      continue;
    }
    if (line.length > 0) lines.push(line);
    line = stringWidth(word) <= width ? word : truncateEnd(word, width);
  }
  if (line.length > 0 || lines.length === 0) lines.push(line);
  return lines;
}

function labeledLines(
  label: "RUN" | "APPLY",
  value: string,
  width: number,
  runIndicator?: string
): string[] {
  const prefix =
    label === "RUN"
      ? runIndicator === undefined
        ? "RUN    "
        : `RUN  ${runIndicator} `
      : "APPLY  ";
  const contentWidth = Math.max(1, width - stringWidth(prefix));
  return wrapWords(value, contentWidth).map((line, index) =>
    truncateEnd(`${index === 0 ? prefix : " ".repeat(prefix.length)}${line}`, width)
  );
}

function runOutput(
  observation: RunProgressObservation,
  now: number,
  width: number,
  runIndicator?: string
): string[] {
  if (width < WIDE_TABLE_MIN_WIDTH) {
    const detail = `${completedCount(observation)}/${observation.files.length} complete · ${runElapsed(observation, now)} elapsed`;
    return [
      ...labeledLines("RUN", phaseLabel(observation.phase), width, runIndicator),
      ...wrapWords(detail, Math.max(1, width - 7)).map((line) =>
        truncateEnd(`       ${line}`, width)
      )
    ];
  }
  return labeledLines(
    "RUN",
    `${runStateLabel(observation)} · ${runElapsed(observation, now)} elapsed`,
    width,
    runIndicator
  );
}

function applicationOutput(
  observation: RunProgressObservation,
  width: number
): string[] {
  return labeledLines("APPLY", applicationLabel(observation), width);
}

function initialOutput(
  header: RunProgressDisplayHeader,
  observation: RunProgressObservation,
  now: number,
  width: number,
  runIndicator?: string
): string {
  const lines = [
    ...headerLines(header, observation, width),
    "",
    fileTable(observation.files, now, width, true),
    "",
    ...runOutput(observation, now, width, runIndicator),
    ...applicationOutput(observation, width)
  ];
  return `${lines.join("\n")}\n`;
}

function runnerIndicator(
  terminal: RunProgressTerminal,
  observation: RunProgressObservation,
  animationFrame: number
): string | undefined {
  if (terminal.mode !== "tty" || observation.terminalAt !== null) return undefined;
  if (terminal.animation === false) return "•";
  return RUNNER_SPINNER_FRAMES[animationFrame % RUNNER_SPINNER_FRAMES.length];
}

function ignoreTerminalFailure(action: () => void): void {
  try {
    action();
  } catch {
    // Rendering is best-effort and never participates in Runner outcomes.
  }
}

function appendHeartbeatOutput(
  observation: RunProgressObservation,
  now: number,
  width: number
): string {
  return `${[
    truncateEnd(
      `ALIVE  ${runElapsed(observation, now)} elapsed · ${completedCount(observation)}/${observation.files.length} complete · ${observation.phase}`,
      width
    ),
    truncateEnd("       Stages unchanged; not model progress", width)
  ].join("\n")}\n`;
}

export function createRunProgressRenderer(
  options: RunProgressRendererOptions
): RunProgressRenderer {
  let latestSequence = -1;
  let latest: RunProgressObservation | undefined;
  let timer: RunProgressTimer | undefined;
  let closed = false;
  let appendWidth: number | undefined;
  let animationFrame = 0;
  const terminal = options.terminal;
  const currentWidth = () => {
    if (terminal.mode === "tty") {
      return terminalWidth(terminal, DEFAULT_TTY_WIDTH);
    }
    appendWidth ??= terminalWidth(terminal, DEFAULT_APPEND_WIDTH);
    return appendWidth;
  };
  const refresh = () => {
    ignoreTerminalFailure(() => {
      const observation = latest;
      if (closed || observation === undefined) return;
      const now = options.now();
      const width = currentWidth();
      if (terminal.mode === "append") {
        terminal.write(appendHeartbeatOutput(observation, now, width));
      } else {
        if (terminal.animation !== false && observation.terminalAt === null) {
          animationFrame = (animationFrame + 1) % RUNNER_SPINNER_FRAMES.length;
        }
        terminal.repaint(
          initialOutput(
            options.header,
            observation,
            now,
            width,
            runnerIndicator(terminal, observation, animationFrame)
          ).trimEnd()
        );
      }
    });
  };
  return {
    update: (observation) => {
      if (closed) return;
      if (observation.sequence <= latestSequence) return;
      latestSequence = observation.sequence;
      const previousObservation = latest;
      latest = observation;
      ignoreTerminalFailure(() => {
        if (terminal.mode === "append") {
          const now = options.now();
          const width = currentWidth();
          if (previousObservation === undefined) {
            terminal.write(initialOutput(options.header, observation, now, width));
          } else {
            const previousFiles = new Map(
              previousObservation.files.map(
                (file) => [file.targetPath, file] as const
              )
            );
            const changedFiles = observation.files.filter((file) => {
              const previous = previousFiles.get(file.targetPath);
              return (
                previous === undefined ||
                previous.stage !== file.stage ||
                previous.claimedAt !== file.claimedAt ||
                previous.terminalAt !== file.terminalAt
              );
            });
            const lines = [
              ...(changedFiles.length === 0
                ? []
                : [fileTable(changedFiles, now, width, false)]),
              ...(runStateLabel(previousObservation) === runStateLabel(observation)
                ? []
                : runOutput(observation, now, width)),
              ...(applicationLabel(previousObservation) === applicationLabel(observation)
                ? []
                : applicationOutput(observation, width))
            ];
            if (lines.length > 0) {
              terminal.write(`${lines.join("\n")}\n`);
            }
          }
        } else {
          const width = currentWidth();
          terminal.repaint(
            initialOutput(
              options.header,
              observation,
              options.now(),
              width,
              runnerIndicator(terminal, observation, animationFrame)
            ).trimEnd()
          );
        }
      });
      if (timer === undefined) {
        ignoreTerminalFailure(() => {
          const intervalMs =
            terminal.mode === "append"
              ? APPEND_HEARTBEAT_INTERVAL_MS
              : terminal.animation === false
                ? REDUCED_MOTION_REFRESH_INTERVAL_MS
                : TTY_ANIMATION_INTERVAL_MS;
          const scheduled = options.schedule(refresh, intervalMs);
          timer = scheduled;
          scheduled.unref?.();
        });
      }
    },
    close: () => {
      if (closed) return;
      closed = true;
      ignoreTerminalFailure(() => {
        timer?.clear();
      });
      if (terminal.mode === "tty") {
        ignoreTerminalFailure(() => {
          terminal.done();
        });
      }
    }
  };
}
