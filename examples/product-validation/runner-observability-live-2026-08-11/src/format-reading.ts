import type { Reading } from "./reading.js";

export function formatReading(reading: Reading): string {
  return `${reading.name}: ${reading.value} ${reading.unit}`;
}
