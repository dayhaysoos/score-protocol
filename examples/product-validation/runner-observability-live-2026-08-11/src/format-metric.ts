import type { Metric } from "./metric.js";

export function formatMetric(metric: Metric): string {
  return `${metric.label}: ${metric.value} ${metric.unit}`;
}
