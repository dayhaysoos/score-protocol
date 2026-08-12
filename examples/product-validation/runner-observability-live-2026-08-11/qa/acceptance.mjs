import assert from "node:assert/strict";

import { formatMetric } from "../dist/format-metric.js";
import { summarizeMetrics } from "../dist/metric-report.js";
import { formatReading } from "../dist/format-reading.js";
import { summarizeReadings } from "../dist/reading-report.js";
import { formatGauge } from "../dist/format-gauge.js";
import { summarizeGauges } from "../dist/gauge-summary.js";

const metrics = [
  { key: "latency", label: "Latency", value: 42, unit: "ms", highlighted: true },
  { key: "errors", label: "Errors", value: 0, unit: "%", highlighted: false },
  { key: "uptime", label: "Uptime", value: 99.9, unit: "%", highlighted: true }
];

assert.equal(formatMetric(metrics[0]), "Latency: 42 ms");
assert.equal(
  summarizeMetrics(metrics),
  "2 highlighted metrics\nLatency: 42 ms\nUptime: 99.9 %"
);
assert.equal(summarizeMetrics([]), "No highlighted metrics");

const readings = [
  { name: "Temperature", value: 21.5, unit: "C", included: true },
  { name: "Noise", value: 0, unit: "dB", included: false },
  { name: "Humidity", value: 45, unit: "%", included: true }
];

assert.equal(formatReading(readings[0]), "Temperature: 21.5 C");
assert.equal(
  summarizeReadings(readings),
  "2 included readings\nTemperature: 21.5 C\nHumidity: 45 %"
);
assert.equal(summarizeReadings([]), "No included readings");

const gauges = [
  { label: "Load", amount: 72, suffix: "%", featured: true },
  { label: "Idle", amount: 28, suffix: "%", featured: false },
  { label: "Memory", amount: 3.5, suffix: "GB", featured: true }
];

assert.equal(formatGauge(gauges[0]), "Load: 72 %");
assert.equal(
  summarizeGauges(gauges),
  "2 featured gauges\nLoad: 72 %\nMemory: 3.5 GB"
);
assert.equal(summarizeGauges([]), "No featured gauges");
process.stdout.write("Runner observability live acceptance passed.\n");
