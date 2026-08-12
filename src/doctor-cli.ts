import { formatDoctorReport, type DoctorReport } from "./doctor.js";
import { runDefaultDoctor } from "./doctor-runtime.js";
import { terminalSafeJson } from "./runner/terminal-safe-json.js";

export const DOCTOR_USAGE = "Usage: score doctor [--json]\n";

type DoctorCliParseResult =
  | { readonly status: "help" }
  | { readonly status: "invalid" }
  | {
      readonly status: "valid";
      readonly json: boolean;
    };

function parseDoctorArguments(args: ReadonlyArray<string>): DoctorCliParseResult {
  if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
    return { status: "help" };
  }
  if (args.length === 0) return { status: "valid", json: false };
  if (args.length === 1 && args[0] === "--json") return { status: "valid", json: true };
  return { status: "invalid" };
}

/** Internal injection seam for deterministic CLI tests; the score command never exposes it. */
export interface DoctorCliDependencies {
  readonly runDoctor: () => Promise<DoctorReport>;
  readonly writeStdout: (value: string) => void;
  readonly writeStderr: (value: string) => void;
}

const defaultDependencies: DoctorCliDependencies = {
  runDoctor: () => runDefaultDoctor({ projectRoot: process.cwd() }),
  writeStdout: (value) => process.stdout.write(value),
  writeStderr: (value) => process.stderr.write(value)
};

/** Run the non-mutating doctor command and return its process exit code. */
export async function runDoctorCli(
  args: ReadonlyArray<string>,
  dependencies: DoctorCliDependencies = defaultDependencies
): Promise<number> {
  const parsed = parseDoctorArguments(args);
  if (parsed.status === "help") {
    dependencies.writeStdout(DOCTOR_USAGE);
    return 0;
  }
  if (parsed.status === "invalid") {
    dependencies.writeStderr(DOCTOR_USAGE);
    return 64;
  }
  const report = await dependencies.runDoctor();
  dependencies.writeStdout(
    parsed.json ? `${terminalSafeJson(report)}\n` : formatDoctorReport(report)
  );
  return report.status === "needs_attention" ? 1 : 0;
}
