import assert from "node:assert/strict";
import { describe, it } from "node:test";
import stringWidth from "string-width";

import {
  createRunProgressTerminal,
  createRunProgressRenderer,
  type RunProgressObservation,
  type RunProgressSchedule,
  type RunProgressTerminal
} from "../src/runner/run-progress-renderer.js";
import { AttemptId, JobId, RunId } from "../src/runner/domain.js";

const STARTED_AT = "2026-08-11T12:00:00.000Z";
const WIDE_WIDTH = 80;

function observation(
  overrides: Partial<RunProgressObservation> = {}
): RunProgressObservation {
  return {
    runId: RunId.make("25cb4508-0000-4000-8000-000000000000"),
    providerId: "opencode",
    modelId: "gpt-5.6-luna",
    variantId: "medium",
    runtimeVersion: {
      sdkVersion: "0.0.0-next-17111",
      cliVersion: "0.0.0-next-17111"
    },
    createdAt: STARTED_AT,
    lastObservedAt: STARTED_AT,
    terminalAt: null,
    sequence: 1,
    phase: "generating candidates",
    failureCategory: null,
    failureMessage: null,
    application: {
      state: "not_applied",
      appliedAt: null,
      filesApplied: false
    },
    files: [
      {
        runId: RunId.make("25cb4508-0000-4000-8000-000000000000"),
        jobId: JobId.make("25cb4508-0000-4000-8000-000000000001"),
        attemptId: null,
        targetPath: "src/App.tsx",
        operation: "replace",
        agentInputDigest: "sha256:app",
        stage: "waiting",
        source: "runner",
        observedAt: STARTED_AT,
        claimedAt: null,
        terminalAt: null,
        sequence: 0,
        runtimeSessionId: null,
        failureCategory: null,
        failureMessage: null,
        failureStage: null,
        terminalOutcome: null,
        targetOutputState: "not observed",
        rejectedOutputDigest: null,
        rejectedOutputPath: null
      },
      {
        runId: RunId.make("25cb4508-0000-4000-8000-000000000000"),
        jobId: JobId.make("25cb4508-0000-4000-8000-000000000002"),
        attemptId: null,
        targetPath: "src/components/TaskList.tsx",
        operation: "create",
        agentInputDigest: "sha256:task-list",
        stage: "waiting",
        source: "runner",
        observedAt: STARTED_AT,
        claimedAt: null,
        terminalAt: null,
        sequence: 0,
        runtimeSessionId: null,
        failureCategory: null,
        failureMessage: null,
        failureStage: null,
        terminalOutcome: null,
        targetOutputState: "not observed",
        rejectedOutputDigest: null,
        rejectedOutputPath: null
      }
    ],
    ...overrides
  };
}

function inertSchedule(): RunProgressSchedule {
  return () => ({ clear: () => undefined, unref: () => undefined });
}

const UNSAFE_TERMINAL_CONTROL =
  /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]|\p{Cf}/u;

function assertLinesFit(frame: string, width: number): void {
  for (const line of frame.trimEnd().split("\n")) {
    assert.ok(
      stringWidth(line) <= width,
      `expected ${JSON.stringify(line)} to fit ${width} cells, got ${stringWidth(line)}`
    );
  }
}

function wideRow(file: string, status: string, elapsed: string): string {
  const fileWidth = WIDE_WIDTH - 28;
  return `${file.padEnd(fileWidth)}  ${status.padEnd(17)}  ${elapsed.padStart(7)}`;
}

function wideHeader(): string {
  return wideRow("FILE", "STATUS", "ELAPSED");
}

function wideDivider(): string {
  return `${"─".repeat(WIDE_WIDTH - 28)}  ${"─".repeat(17)}  ${"─".repeat(7)}`;
}

const maliciousHeader = {
  planLabel: `Focus\u001B[2J\nBoard ${"p".repeat(256)}`,
  modelLabel: "GPT\u001B]0;forged window title\u0007\r\n\u202ELuna\u2066\u2069",
  providerLabel: "Open\u009B31mCode\tProvider\u0085Label",
  variantLabel: "Medium\u001BPforged device control\u001B\\\u0000Variant"
} as const;

function maliciousObservation(): RunProgressObservation {
  const initial = observation();
  return {
    ...initial,
    files: [
      {
        ...initial.files[0]!,
        targetPath: `src/\u001B[31mred\u001B[0m\nforged-line-${"x".repeat(256)}.tsx`
      },
      {
        ...initial.files[1]!,
        targetPath: "src/\u009B2JTask\t\u202EList.tsx\u2066\u2069\u0085forged-line"
      }
    ]
  };
}

function assertMaliciousProjectionIsSafe(
  frame: string,
  width = WIDE_WIDTH
): void {
  const lines = frame.trimEnd().split("\n");
  for (const line of lines) assert.doesNotMatch(line, UNSAFE_TERMINAL_CONTROL);
  assertLinesFit(frame, width);
  assert.match(lines[0]!, /^Running Focus Board p+/u);
  assert.match(frame, /GPT Luna/u);
  assert.match(frame, /OpenCode Provider Label/u);
  assert.match(frame, /Medium Variant/u);
  assert.match(frame, /Run 25cb4508/u);
  assert.doesNotMatch(frame, /forged window title|forged device control/u);
  assert.match(frame, /^FILE\s+STATUS\s+ELAPSED$/mu);
  const longPathRow = lines.find((line) => line.startsWith("src/red"));
  assert.ok(longPathRow);
  assert.match(longPathRow, /…/u);
  assert.match(longPathRow, /\s+○ waiting\s+—$/u);
  assert.match(frame, /^src\/Task List\.tsx forged-line\s+○ waiting\s+—$/mu);
  assert.doesNotMatch(frame, new RegExp(`p{200}|x{200}`, "u"));
  assert.match(frame, /…/u);
  assert.match(
    frame,
    /^RUN(?: {4}| {2}⠋ )Generating candidates · 0\/2 complete/uim
  );
  assert.match(frame, /^APPLY\s+Nothing applied$/mu);
}

describe("Run progress renderer", () => {
  it("shows every File Job filename-first before execution begins", () => {
    const output: string[] = [];
    const terminal: RunProgressTerminal = {
      mode: "append",
      width: () => WIDE_WIDTH,
      write: (text) => output.push(text)
    };
    const renderer = createRunProgressRenderer({
      header: {
        planLabel: "Focus Board",
        modelLabel: "GPT-5.6 Luna",
        providerLabel: "OpenCode",
        variantLabel: "Medium"
      },
      now: () => Date.parse(STARTED_AT),
      schedule: inertSchedule(),
      terminal
    });

    renderer.update(observation());

    assert.equal(
      output.join(""),
      [
        "Running Focus Board",
        "OpenCode · GPT-5.6 Luna · Medium · Run 25cb4508",
        "",
        wideHeader(),
        wideDivider(),
        wideRow("src/App.tsx", "○ waiting", "—"),
        wideRow("src/components/TaskList.tsx", "○ waiting", "—"),
        "",
        "RUN    Generating candidates · 0/2 complete · 00:00 elapsed",
        "APPLY  Nothing applied",
        ""
      ].join("\n")
    );
    assertLinesFit(output.join(""), WIDE_WIDTH);
  });

  it("reports application state without implying an in-flight or failed mutation rolled back", () => {
    const cases: ReadonlyArray<{
      readonly state: RunProgressObservation["application"]["state"];
      readonly filesApplied: boolean | null;
      readonly expected: string;
    }> = [
      {
        state: "not_applied",
        filesApplied: false,
        expected: "Nothing applied"
      },
      {
        state: "applying",
        filesApplied: null,
        expected: "Atomic application in progress; final outcome pending"
      },
      {
        state: "applied",
        filesApplied: true,
        expected: "All candidates applied"
      },
      {
        state: "apply_failed",
        filesApplied: null,
        expected: "Application failed; inspect status"
      }
    ];

    for (const testCase of cases) {
      const output: string[] = [];
      const renderer = createRunProgressRenderer({
        header: { modelLabel: "GPT-5.6 Luna", providerLabel: "OpenCode" },
        now: () => Date.parse(STARTED_AT),
        schedule: inertSchedule(),
        terminal: {
          mode: "append",
          width: () => WIDE_WIDTH,
          write: (text) => output.push(text)
        }
      });

      renderer.update(
        observation({
          application: {
            state: testCase.state,
            appliedAt: testCase.state === "applied" ? STARTED_AT : null,
            filesApplied: testCase.filesApplied
          }
        })
      );

      assert.match(output.join(""), new RegExp(testCase.expected, "u"));
    }
  });

  it("appends only the File Job whose stage changed", () => {
    const output: string[] = [];
    let now = Date.parse(STARTED_AT);
    const renderer = createRunProgressRenderer({
      header: {
        modelLabel: "GPT-5.6 Luna",
        providerLabel: "OpenCode",
        variantLabel: "Medium"
      },
      now: () => now,
      schedule: inertSchedule(),
      terminal: {
        mode: "append",
        width: () => WIDE_WIDTH,
        write: (text) => output.push(text)
      }
    });
    const initial = observation();
    renderer.update(initial);

    now += 5_000;
    const appWorking = observation({
      sequence: 2,
      lastObservedAt: "2026-08-11T12:00:05.000Z",
      files: [
        {
          ...initial.files[0]!,
          attemptId: AttemptId.make("25cb4508-0000-4000-8000-000000000010"),
          stage: "Agent working",
          observedAt: "2026-08-11T12:00:05.000Z",
          claimedAt: STARTED_AT,
          sequence: 2,
          runtimeSessionId: "session-app"
        },
        initial.files[1]!
      ]
    });
    renderer.update(appWorking);

    now += 5_000;
    renderer.update(
      observation({
        sequence: 3,
        lastObservedAt: "2026-08-11T12:00:10.000Z",
        files: [
          appWorking.files[0]!,
          {
            ...initial.files[1]!,
            attemptId: AttemptId.make("25cb4508-0000-4000-8000-000000000011"),
            stage: "candidate ready",
            observedAt: "2026-08-11T12:00:10.000Z",
            claimedAt: STARTED_AT,
            sequence: 3,
            runtimeSessionId: "session-task-list"
          }
        ]
      })
    );

    assert.equal(output.length, 3);
    assert.equal(
      output[1],
      `${wideRow("src/App.tsx", "● Agent working", "00:05")}\n`
    );
    assert.doesNotMatch(output[1]!, /TaskList/u);
    assert.equal(
      output[2],
      `${wideRow("src/components/TaskList.tsx", "● candidate ready", "00:10")}\n`
    );
    assert.doesNotMatch(output[2]!, /App\.tsx/u);
    assertLinesFit(output.slice(1).join(""), WIDE_WIDTH);
  });

  it("appends changed Runner facts without repeating unchanged File Jobs", () => {
    const output: string[] = [];
    const renderer = createRunProgressRenderer({
      header: { modelLabel: "GPT-5.6 Luna", providerLabel: "OpenCode" },
      now: () => Date.parse(STARTED_AT),
      schedule: inertSchedule(),
      terminal: {
        mode: "append",
        width: () => WIDE_WIDTH,
        write: (text) => output.push(text)
      }
    });

    renderer.update(observation());
    renderer.update(
      observation({
        sequence: 2,
        phase: "applying all candidates",
        application: {
          state: "applying",
          appliedAt: null,
          filesApplied: null
        }
      })
    );

    assert.equal(output.length, 2);
    assert.equal(
      output[1],
      "RUN    Applying all candidates · 0/2 complete · 00:00 elapsed\n" +
        "APPLY  Atomic application in progress; final outcome pending\n"
    );
    assert.doesNotMatch(output[1]!, /src\//u);
  });

  it("uses an append-only five-second heartbeat without spinner log flooding", () => {
    const output: string[] = [];
    let now = Date.parse(STARTED_AT);
    let heartbeat: (() => void) | undefined;
    let intervalMs = 0;
    const renderer = createRunProgressRenderer({
      header: { modelLabel: "GPT-5.6 Luna", providerLabel: "OpenCode" },
      now: () => now,
      schedule: (callback, interval) => {
        heartbeat = callback;
        intervalMs = interval;
        return { clear: () => undefined, unref: () => undefined };
      },
      terminal: {
        mode: "append",
        width: () => WIDE_WIDTH,
        write: (text) => output.push(text)
      }
    });
    renderer.update(observation());
    assert.equal(output.length, 1);
    assert.match(
      output[0]!,
      /^RUN    Generating candidates · 0\/2 complete · 00:00 elapsed$/mu
    );
    assert.doesNotMatch(output[0]!, /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/u);
    output.length = 0;

    now += 5_000;
    assert.ok(heartbeat);
    heartbeat();

    assert.equal(intervalMs, 5_000);
    assert.deepEqual(output, [
      "ALIVE  00:05 elapsed · 0/2 complete · generating candidates\n" +
        "       Stages unchanged; not model progress\n"
    ]);
    assertLinesFit(output.join(""), WIDE_WIDTH);
  });

  it("repaints observations immediately and advances one global spinner every 100ms", () => {
    const frames: string[] = [];
    let animationTick: (() => void) | undefined;
    let intervalMs = 0;
    let schedules = 0;
    const renderer = createRunProgressRenderer({
      header: { modelLabel: "GPT-5.6 Luna", providerLabel: "OpenCode" },
      now: () => Date.parse(STARTED_AT),
      schedule: (callback, interval) => {
        animationTick = callback;
        intervalMs = interval;
        schedules += 1;
        return { clear: () => undefined, unref: () => undefined };
      },
      terminal: {
        mode: "tty",
        animation: true,
        width: () => WIDE_WIDTH,
        repaint: (frame) => frames.push(frame),
        done: () => undefined
      }
    });
    const initial = observation();

    renderer.update(initial);

    assert.equal(frames.length, 1);
    assert.equal(intervalMs, 100);
    assert.equal(schedules, 1);
    assert.match(
      frames[0]!,
      /^RUN  ⠋ Generating candidates · 0\/2 complete · 00:00 elapsed$/mu
    );
    assert.ok(animationTick);

    renderer.update(
      observation({
        sequence: 2,
        files: [
          {
            ...initial.files[0]!,
            stage: "Agent working",
            claimedAt: STARTED_AT,
            sequence: 2
          },
          initial.files[1]!
        ]
      })
    );

    assert.equal(frames.length, 2);
    assert.equal(schedules, 1);
    assert.match(frames[1]!, /^RUN  ⠋ Generating candidates/uim);
    assert.ok(
      frames[1]!
        .split("\n")
        .includes(wideRow("src/App.tsx", "● Agent working", "00:00"))
    );

    const spinner = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    for (const marker of [...spinner.slice(1), spinner[0]!]) {
      animationTick();
      const frame = frames.at(-1)!;
      assert.match(frame, new RegExp(`^RUN  ${marker} Generating candidates`, "mu"));
      assert.ok(
        frame
          .split("\n")
          .includes(wideRow("src/App.tsx", "● Agent working", "00:00"))
      );
      assert.equal(stringWidth(marker), 1);
    }
    assert.equal(frames.length, 12);
  });

  it("keeps every per-file marker static while the Run spinner advances", () => {
    const frames: string[] = [];
    let animationTick: (() => void) | undefined;
    const initial = observation();
    const files: RunProgressObservation["files"] = [
      initial.files[0]!,
      {
        ...initial.files[1]!,
        targetPath: "src/Starting.tsx",
        stage: "starting",
        claimedAt: STARTED_AT
      },
      {
        ...initial.files[1]!,
        targetPath: "src/Working.tsx",
        stage: "Agent working",
        claimedAt: STARTED_AT
      },
      {
        ...initial.files[1]!,
        targetPath: "src/Succeeded.tsx",
        stage: "succeeded",
        claimedAt: STARTED_AT,
        terminalAt: STARTED_AT
      },
      {
        ...initial.files[1]!,
        targetPath: "src/Failed.tsx",
        stage: "failed",
        claimedAt: STARTED_AT,
        terminalAt: STARTED_AT
      },
      {
        ...initial.files[1]!,
        targetPath: "src/Attention.tsx",
        stage: "needs attention",
        claimedAt: STARTED_AT,
        terminalAt: STARTED_AT
      }
    ];
    const renderer = createRunProgressRenderer({
      header: { modelLabel: "GPT-5.6 Luna", providerLabel: "OpenCode" },
      now: () => Date.parse(STARTED_AT),
      schedule: (callback) => {
        animationTick = callback;
        return { clear: () => undefined, unref: () => undefined };
      },
      terminal: {
        mode: "tty",
        animation: true,
        width: () => WIDE_WIDTH,
        repaint: (frame) => frames.push(frame),
        done: () => undefined
      }
    });
    renderer.update(observation({ files }));
    assert.ok(animationTick);
    animationTick();

    const expectedRows = [
      wideRow("src/App.tsx", "○ waiting", "—"),
      wideRow("src/Starting.tsx", "● starting", "00:00"),
      wideRow("src/Working.tsx", "● Agent working", "00:00"),
      wideRow("src/Succeeded.tsx", "✓ succeeded", "00:00"),
      wideRow("src/Failed.tsx", "× failed", "00:00"),
      wideRow("src/Attention.tsx", "! needs attention", "00:00")
    ];
    for (const frame of frames) {
      const lines = frame.split("\n");
      for (const row of expectedRows) assert.ok(lines.includes(row));
    }
    assert.match(frames[0]!, /^RUN  ⠋ /mu);
    assert.match(frames[1]!, /^RUN  ⠙ /mu);
  });

  it("uses a static Run marker and five-second refresh when animation is disabled", () => {
    const frames: string[] = [];
    let refresh: (() => void) | undefined;
    let intervalMs = 0;
    let now = Date.parse(STARTED_AT);
    const renderer = createRunProgressRenderer({
      header: { modelLabel: "GPT-5.6 Luna", providerLabel: "OpenCode" },
      now: () => now,
      schedule: (callback, interval) => {
        refresh = callback;
        intervalMs = interval;
        return { clear: () => undefined, unref: () => undefined };
      },
      terminal: {
        mode: "tty",
        animation: false,
        width: () => WIDE_WIDTH,
        repaint: (frame) => frames.push(frame),
        done: () => undefined
      }
    });
    renderer.update(observation());

    assert.equal(frames.length, 1);
    assert.equal(intervalMs, 5_000);
    assert.match(
      frames[0]!,
      /^RUN  • Generating candidates · 0\/2 complete · 00:00 elapsed$/mu
    );
    assert.doesNotMatch(frames[0]!, /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/u);

    now += 5_000;
    assert.ok(refresh);
    refresh();
    assert.equal(frames.length, 2);
    assert.match(
      frames[1]!,
      /^RUN  • Generating candidates · 0\/2 complete · 00:05 elapsed$/mu
    );
  });

  it("repaints one compact stable frame in a TTY", () => {
    const frames: string[] = [];
    let now = Date.parse(STARTED_AT);
    const renderer = createRunProgressRenderer({
      header: {
        planLabel: "Focus Board",
        modelLabel: "GPT-5.6 Luna",
        providerLabel: "OpenCode"
      },
      now: () => now,
      schedule: inertSchedule(),
      terminal: {
        mode: "tty",
        width: () => WIDE_WIDTH,
        repaint: (frame) => frames.push(frame),
        done: () => undefined
      }
    });
    const initial = observation();
    renderer.update(initial);
    now += 3_000;
    renderer.update(
      observation({
        sequence: 2,
        files: [
          {
            ...initial.files[0]!,
            stage: "starting",
            claimedAt: STARTED_AT,
            observedAt: "2026-08-11T12:00:03.000Z",
            sequence: 2
          },
          initial.files[1]!
        ]
      })
    );

    assert.equal(frames.length, 2);
    assert.equal(frames[1]?.match(/src\/App\.tsx/gu)?.length, 1);
    assert.equal(frames[1]?.match(/src\/components\/TaskList\.tsx/gu)?.length, 1);
    assert.match(
      frames[1]!,
      /^OpenCode · GPT-5\.6 Luna · Run 25cb4508$/mu
    );
    assert.match(frames[1]!, new RegExp(`^${wideHeader()}$`, "mu"));
    assert.match(
      frames[1]!,
      new RegExp(`^${wideRow("src/App.tsx", "● starting", "00:03")}$`, "mu")
    );
    assert.match(
      frames[1]!,
      /^RUN  ⠋ Generating candidates · 0\/2 complete · 00:03 elapsed$/mu
    );
    assert.match(frames[1]!, /^APPLY\s+Nothing applied$/mu);
    assertLinesFit(frames[1]!, WIDE_WIDTH);
  });

  it("uses a controlled stacked layout below 48 columns", () => {
    const frames: string[] = [];
    const width = 47;
    const renderer = createRunProgressRenderer({
      header: {
        planLabel: "Focus Board",
        modelLabel: "GPT-5.6 Luna",
        providerLabel: "OpenCode",
        variantLabel: "Medium"
      },
      now: () => Date.parse(STARTED_AT),
      schedule: inertSchedule(),
      terminal: {
        mode: "tty",
        width: () => width,
        repaint: (frame) => frames.push(frame),
        done: () => undefined
      }
    });

    renderer.update(observation());

    assert.equal(frames.length, 1);
    assert.doesNotMatch(frames[0]!, /^FILE\s+STATUS\s+ELAPSED$/mu);
    assert.match(frames[0]!, /^FILES$/mu);
    assert.match(frames[0]!, /^src\/App\.tsx\n  ○ waiting · —$/mu);
    assert.match(
      frames[0]!,
      /^src\/components\/TaskList\.tsx\n  ○ waiting · —$/mu
    );
    assert.match(
      frames[0]!,
      /^RUN  ⠋ Generating candidates\n\s+0\/2 complete · 00:00 elapsed$/mu
    );
    assert.match(frames[0]!, /^APPLY\s+Nothing applied$/mu);
    assertLinesFit(frames[0]!, width);
  });

  it("keeps the three columns at the 48-column threshold", () => {
    const frames: string[] = [];
    const width = 48;
    const renderer = createRunProgressRenderer({
      header: { modelLabel: "GPT-5.6 Luna", providerLabel: "OpenCode" },
      now: () => Date.parse(STARTED_AT),
      schedule: inertSchedule(),
      terminal: {
        mode: "tty",
        width: () => width,
        repaint: (frame) => frames.push(frame),
        done: () => undefined
      }
    });

    renderer.update(observation());

    assert.match(frames[0]!, /^FILE\s+STATUS\s+ELAPSED$/mu);
    const tableLines = frames[0]!
      .split("\n")
      .filter(
        (line) =>
          line.startsWith("FILE") ||
          line.startsWith("─") ||
          line.includes("○ waiting")
      );
    assert.equal(tableLines.length, 4);
    for (const line of tableLines) assert.equal(stringWidth(line), width);
    assertLinesFit(frames[0]!, width);
  });

  it("wraps complete Runner identity fields even at tiny TTY widths", () => {
    for (const width of [1, 8, 11, 20]) {
      const frames: string[] = [];
      const renderer = createRunProgressRenderer({
        header: {
          modelLabel: "Model",
          providerLabel: "Provider",
          variantLabel: "Variant"
        },
        now: () => Date.parse(STARTED_AT),
        schedule: inertSchedule(),
        terminal: {
          mode: "tty",
          width: () => width,
          repaint: (frame) => frames.push(frame),
          done: () => undefined
        }
      });

      renderer.update(observation());

      assert.equal(frames.length, 1);
      assertLinesFit(frames[0]!, width);
      const lines = frames[0]!.split("\n");
      const headerEnd = lines.indexOf("");
      assert.notEqual(headerEnd, -1);
      const header = lines.slice(0, headerEnd).join("\n");
      const concatenatedIdentity = header.replace(/[\s·]/gu, "");
      assert.doesNotMatch(header, /…/u);
      assert.match(concatenatedIdentity, /Provider/u);
      assert.match(concatenatedIdentity, /Model/u);
      assert.match(concatenatedIdentity, /Variant/u);
      assert.match(concatenatedIdentity, /Run25cb4508/u);
    }
  });

  it("samples current TTY width on heartbeat and switches layouts after resize", () => {
    const frames: string[] = [];
    let width = WIDE_WIDTH;
    let heartbeat: (() => void) | undefined;
    const renderer = createRunProgressRenderer({
      header: {
        planLabel: "Focus Board",
        modelLabel: "GPT-5.6 Luna",
        providerLabel: "OpenCode",
        variantLabel: "Medium"
      },
      now: () => Date.parse(STARTED_AT),
      schedule: (callback) => {
        heartbeat = callback;
        return { clear: () => undefined, unref: () => undefined };
      },
      terminal: {
        mode: "tty",
        width: () => width,
        repaint: (frame) => frames.push(frame),
        done: () => undefined
      }
    });
    renderer.update(observation());

    width = 40;
    assert.ok(heartbeat);
    heartbeat();
    width = 96;
    heartbeat();

    assert.equal(frames.length, 3);
    assert.match(frames[0]!, /^FILE\s+STATUS\s+ELAPSED$/mu);
    assert.doesNotMatch(frames[1]!, /^FILE\s+STATUS\s+ELAPSED$/mu);
    assert.match(frames[1]!, /^FILES$/mu);
    assert.match(frames[1]!, /^Run 25cb4508$/mu);
    assertLinesFit(frames[1]!, 40);
    assert.match(frames[2]!, /^FILE\s+STATUS\s+ELAPSED$/mu);
    const resizedHeader = frames[2]!
      .split("\n")
      .find((line) => line.startsWith("FILE"));
    assert.ok(resizedHeader);
    assert.equal(stringWidth(resizedHeader), 96);
    assertLinesFit(frames[2]!, 96);
  });

  it("aligns Unicode paths by display cells and middle-truncates them", () => {
    const frames: string[] = [];
    const width = 60;
    const initial = observation();
    const renderer = createRunProgressRenderer({
      header: { modelLabel: "GPT-5.6 Luna", providerLabel: "OpenCode" },
      now: () => Date.parse(STARTED_AT),
      schedule: inertSchedule(),
      terminal: {
        mode: "tty",
        width: () => width,
        repaint: (frame) => frames.push(frame),
        done: () => undefined
      }
    });

    renderer.update(
      observation({
        files: [
          {
            ...initial.files[0]!,
            targetPath: "src/🫨/測試/e\u0301/🚀/元件/非常長的任務清單檔案.tsx"
          },
          initial.files[1]!
        ]
      })
    );

    const rows = frames[0]!
      .split("\n")
      .filter((line) => line.includes("○ waiting"));
    assert.equal(rows.length, 2);
    const unicodeRow = rows.find((line) => line.startsWith("src/🫨/"));
    assert.ok(unicodeRow);
    assert.match(unicodeRow, /….*\.tsx\s+○ waiting/u);
    for (const row of rows) {
      assert.equal(stringWidth(row), width);
      const statusOffset = row.indexOf("○ waiting");
      assert.notEqual(statusOffset, -1);
      assert.equal(stringWidth(row.slice(0, statusOffset)), width - 26);
    }
    assertLinesFit(frames[0]!, width);
  });

  it("freezes append-mode columns at their initial width", () => {
    const output: string[] = [];
    let width = WIDE_WIDTH;
    const initial = observation();
    const renderer = createRunProgressRenderer({
      header: { modelLabel: "GPT-5.6 Luna", providerLabel: "OpenCode" },
      now: () => Date.parse(STARTED_AT) + 5_000,
      schedule: inertSchedule(),
      terminal: {
        mode: "append",
        width: () => width,
        write: (text) => output.push(text)
      }
    });
    renderer.update(initial);

    width = 47;
    renderer.update(
      observation({
        sequence: 2,
        files: [
          {
            ...initial.files[0]!,
            stage: "Agent working",
            claimedAt: STARTED_AT,
            sequence: 2
          },
          initial.files[1]!
        ]
      })
    );

    assert.equal(output.length, 2);
    assert.equal(
      output[1],
      `${wideRow("src/App.tsx", "● Agent working", "00:05")}\n`
    );
    assert.equal(stringWidth(output[1]!.trimEnd()), WIDE_WIDTH);
  });

  it("projects malicious labels and paths into one bounded terminal-safe TTY frame", () => {
    const frames: string[] = [];
    const renderer = createRunProgressRenderer({
      header: maliciousHeader,
      now: () => Date.parse(STARTED_AT),
      schedule: inertSchedule(),
      terminal: {
        mode: "tty",
        width: () => WIDE_WIDTH,
        repaint: (frame) => frames.push(frame),
        done: () => undefined
      }
    });

    renderer.update(maliciousObservation());

    assert.equal(frames.length, 1);
    assertMaliciousProjectionIsSafe(frames[0]!);
  });

  it("ignores observations whose global sequence is stale", () => {
    const output: string[] = [];
    const renderer = createRunProgressRenderer({
      header: { modelLabel: "GPT-5.6 Luna", providerLabel: "OpenCode" },
      now: () => Date.parse(STARTED_AT),
      schedule: inertSchedule(),
      terminal: { mode: "append", write: (text) => output.push(text) }
    });
    const initial = observation({ sequence: 2 });
    renderer.update(initial);
    renderer.update(
      observation({
        sequence: 1,
        phase: "application failed",
        files: initial.files.map((file) => ({ ...file, stage: "failed" as const }))
      })
    );

    assert.equal(output.length, 1);
    assert.doesNotMatch(output[0]!, /failed/iu);
  });

  it("closes its heartbeat and finalizes the TTY frame exactly once", () => {
    const frames: string[] = [];
    let heartbeat: (() => void) | undefined;
    let clears = 0;
    let unrefs = 0;
    let done = 0;
    const renderer = createRunProgressRenderer({
      header: { modelLabel: "GPT-5.6 Luna", providerLabel: "OpenCode" },
      now: () => Date.parse(STARTED_AT),
      schedule: (callback) => {
        heartbeat = callback;
        return {
          clear: () => {
            clears += 1;
          },
          unref: () => {
            unrefs += 1;
          }
        };
      },
      terminal: {
        mode: "tty",
        repaint: (frame) => frames.push(frame),
        done: () => {
          done += 1;
        }
      }
    });
    renderer.update(observation());
    const finalFrame = frames.at(-1);

    renderer.close();
    renderer.close();
    heartbeat?.();

    assert.equal(unrefs, 1);
    assert.equal(clears, 1);
    assert.equal(done, 1);
    assert.equal(frames.at(-1), finalFrame);
  });

  it("uses plain append-only writes without cursor bytes for a non-TTY stream", () => {
    const output: string[] = [];
    const stream = {
      isTTY: false,
      write: (text: string) => {
        output.push(text);
        return true;
      }
    } as unknown as NodeJS.WriteStream;
    const renderer = createRunProgressRenderer({
      header: { modelLabel: "GPT-5.6 Luna", providerLabel: "OpenCode" },
      now: () => Date.parse(STARTED_AT),
      schedule: inertSchedule(),
      terminal: createRunProgressTerminal(stream)
    });

    renderer.update(observation());

    assert.doesNotMatch(output.join(""), /\u001B/u);
    assert.match(output.join(""), /^src\/App\.tsx\s+○ waiting\s+—$/mu);
  });

  it("reads terminal columns dynamically from a TTY stream", () => {
    const stream = {
      isTTY: true,
      columns: 72,
      write: () => true
    } as unknown as NodeJS.WriteStream;
    const terminal = createRunProgressTerminal(stream);

    assert.equal(terminal.mode, "tty");
    assert.equal(terminal.width?.(), 72);
    Object.assign(stream, { columns: 40 });
    assert.equal(terminal.width?.(), 40);
  });

  it("disables TTY animation for CI, dumb terminals, and reduced motion", () => {
    const stream = {
      isTTY: true,
      columns: WIDE_WIDTH,
      write: () => true
    } as unknown as NodeJS.WriteStream;
    const originalCI = process.env.CI;
    const originalTerm = process.env.TERM;
    const originalReducedMotion = process.env.SCORE_REDUCED_MOTION;
    const assertAnimation = (expected: boolean) => {
      const terminal = createRunProgressTerminal(stream);
      if (terminal.mode !== "tty") assert.fail("expected a TTY terminal");
      assert.equal(terminal.animation, expected);
    };

    try {
      delete process.env.CI;
      process.env.TERM = "xterm-256color";
      delete process.env.SCORE_REDUCED_MOTION;
      assertAnimation(true);

      process.env.CI = "1";
      assertAnimation(false);

      delete process.env.CI;
      process.env.TERM = "dumb";
      assertAnimation(false);

      process.env.TERM = "xterm-256color";
      process.env.SCORE_REDUCED_MOTION = "1";
      assertAnimation(false);
    } finally {
      if (originalCI === undefined) delete process.env.CI;
      else process.env.CI = originalCI;
      if (originalTerm === undefined) delete process.env.TERM;
      else process.env.TERM = originalTerm;
      if (originalReducedMotion === undefined) {
        delete process.env.SCORE_REDUCED_MOTION;
      } else {
        process.env.SCORE_REDUCED_MOTION = originalReducedMotion;
      }
    }
  });

  it("projects malicious labels and paths into bounded append-only records", () => {
    const output: string[] = [];
    const malicious = maliciousObservation();
    const rawTargetPath = malicious.files[1]!.targetPath;
    const renderer = createRunProgressRenderer({
      header: maliciousHeader,
      now: () => Date.parse(STARTED_AT),
      schedule: inertSchedule(),
      terminal: {
        mode: "append",
        width: () => WIDE_WIDTH,
        write: (text) => output.push(text)
      }
    });

    renderer.update(malicious);

    assert.equal(output.length, 1);
    assertMaliciousProjectionIsSafe(output[0]!);
    assert.equal(malicious.files[1]!.targetPath, rawTargetPath);
    assert.match(rawTargetPath, /\p{Cf}/u);
  });

  it("keeps a control-only target identifiable after terminal projection", () => {
    const output: string[] = [];
    const initial = observation();
    const renderer = createRunProgressRenderer({
      header: { modelLabel: "GPT-5.6 Luna", providerLabel: "OpenCode" },
      now: () => Date.parse(STARTED_AT),
      schedule: inertSchedule(),
      terminal: {
        mode: "append",
        width: () => 100,
        write: (text) => output.push(text)
      }
    });

    renderer.update(
      observation({
        files: [
          {
            ...initial.files[0]!,
            targetPath: "\u001B[2J\u0000\u009B31m\u0085\u202E\u2066\u2069\u200B"
          },
          initial.files[1]!
        ]
      })
    );

    assert.match(
      output.join(""),
      /^\[unprintable target; Job 25cb4508-0000-4000-8000-000000000001\]\s+○ waiting\s+—$/mu
    );
  });

  it("contains clock failures during an initial append render", () => {
    const output: string[] = [];
    const renderer = createRunProgressRenderer({
      header: { modelLabel: "GPT-5.6 Luna", providerLabel: "OpenCode" },
      now: () => {
        throw new Error("synthetic initial clock failure");
      },
      schedule: inertSchedule(),
      terminal: { mode: "append", write: (text) => output.push(text) }
    });

    assert.doesNotThrow(() => renderer.update(observation()));
    assert.deepEqual(output, []);
    assert.doesNotThrow(() => renderer.close());
  });

  it("contains clock failures during a changed append render", () => {
    const output: string[] = [];
    let clockFails = false;
    const initial = observation();
    const renderer = createRunProgressRenderer({
      header: { modelLabel: "GPT-5.6 Luna", providerLabel: "OpenCode" },
      now: () => {
        if (clockFails) throw new Error("synthetic update clock failure");
        return Date.parse(STARTED_AT);
      },
      schedule: inertSchedule(),
      terminal: { mode: "append", write: (text) => output.push(text) }
    });
    renderer.update(initial);
    const beforeUpdate = [...output];
    clockFails = true;

    assert.doesNotThrow(() =>
      renderer.update(
        observation({
          sequence: 2,
          files: [
            { ...initial.files[0]!, stage: "starting", sequence: 2 },
            initial.files[1]!
          ]
        })
      )
    );
    assert.deepEqual(output, beforeUpdate);
    assert.doesNotThrow(() => renderer.close());
  });

  it("contains timer scheduling and unref failures", () => {
    let clears = 0;
    const schedules: ReadonlyArray<RunProgressSchedule> = [
      () => {
        throw new Error("synthetic schedule failure");
      },
      () => ({
        clear: () => {
          clears += 1;
        },
        unref: () => {
          throw new Error("synthetic unref failure");
        }
      })
    ];

    for (const schedule of schedules) {
      const renderer = createRunProgressRenderer({
        header: { modelLabel: "GPT-5.6 Luna", providerLabel: "OpenCode" },
        now: () => Date.parse(STARTED_AT),
        schedule,
        terminal: { mode: "append", write: () => undefined }
      });

      assert.doesNotThrow(() => renderer.update(observation()));
      assert.doesNotThrow(() => renderer.close());
    }
    const ttyRenderer = createRunProgressRenderer({
      header: { modelLabel: "GPT-5.6 Luna", providerLabel: "OpenCode" },
      now: () => Date.parse(STARTED_AT),
      schedule: schedules[0]!,
      terminal: {
        mode: "tty",
        animation: true,
        repaint: () => undefined,
        done: () => undefined
      }
    });
    assert.doesNotThrow(() => ttyRenderer.update(observation()));
    assert.doesNotThrow(() => ttyRenderer.close());
    assert.equal(clears, 1);
  });

  it("contains terminal repaint and finalization failures", () => {
    let heartbeat: (() => void) | undefined;
    const renderer = createRunProgressRenderer({
      header: { modelLabel: "GPT-5.6 Luna", providerLabel: "OpenCode" },
      now: () => Date.parse(STARTED_AT),
      schedule: (callback) => {
        heartbeat = callback;
        return {
          clear: () => {
            throw new Error("synthetic timer cleanup failure");
          },
          unref: () => undefined
        };
      },
      terminal: {
        mode: "tty",
        repaint: () => {
          throw new Error("synthetic repaint failure");
        },
        done: () => {
          throw new Error("synthetic finalization failure");
        }
      }
    });

    assert.doesNotThrow(() => renderer.update(observation()));
    assert.doesNotThrow(() => heartbeat?.());
    assert.doesNotThrow(() => renderer.close());
  });

  it("contains heartbeat clock failures before rendering", () => {
    let heartbeat: (() => void) | undefined;
    let clockFails = false;
    const output: string[] = [];
    const renderer = createRunProgressRenderer({
      header: { modelLabel: "GPT-5.6 Luna", providerLabel: "OpenCode" },
      now: () => {
        if (clockFails) throw new Error("synthetic clock failure");
        return Date.parse(STARTED_AT);
      },
      schedule: (callback) => {
        heartbeat = callback;
        return { clear: () => undefined, unref: () => undefined };
      },
      terminal: { mode: "append", write: (text) => output.push(text) }
    });
    renderer.update(observation());
    const beforeHeartbeat = [...output];
    clockFails = true;

    assert.doesNotThrow(() => heartbeat?.());
    assert.deepEqual(output, beforeHeartbeat);
    renderer.close();
  });
});
