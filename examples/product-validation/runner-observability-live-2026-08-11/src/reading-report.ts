import type { Reading } from "./reading.js";
import { formatReading } from "./format-reading.js";

export function summarizeReadings(readings: readonly Reading[]): string {
  const includedReadings = readings.filter((reading) => reading.included);

  if (includedReadings.length === 0) {
    return "No included readings";
  }

  const count = includedReadings.length === 1
    ? "1 included reading"
    : `${includedReadings.length} included readings`;

  return [count, ...includedReadings.map((reading) => formatReading(reading))].join("\n");
}
