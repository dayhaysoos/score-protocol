import type { Gauge } from "./gauge.js";
import { formatGauge } from "./format-gauge.js";

export function summarizeGauges(gauges: readonly Gauge[]): string {
  const featured = gauges.filter((gauge) => gauge.featured);

  if (featured.length === 0) {
    return "No featured gauges";
  }

  const count = featured.length;
  const header = count === 1 ? "1 featured gauge" : `${count} featured gauges`;
  return [header, ...featured.map((gauge) => formatGauge(gauge))].join("\n");
}
