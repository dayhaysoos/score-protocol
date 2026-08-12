import type { Gauge } from "./gauge.js";

export function formatGauge(gauge: Gauge): string {
  return `${gauge.label}: ${gauge.amount} ${gauge.suffix}`;
}
