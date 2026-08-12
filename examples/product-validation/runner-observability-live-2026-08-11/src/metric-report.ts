import type { Metric } from "./metric.js";
import { formatMetric } from "./format-metric.js";

export function summarizeMetrics(metrics: readonly Metric[]): string {
  const highlighted = metrics.filter((metric) => metric.highlighted);

  if (highlighted.length === 0) {
    return "No highlighted metrics";
  }

  const count = highlighted.length;
  const heading = count === 1
    ? "1 highlighted metric"
    : `${count} highlighted metrics`;
  const formattedMetrics = highlighted.map((metric) => formatMetric(metric));

  return `${heading}\n${formattedMetrics.join("\n")}`;
}
