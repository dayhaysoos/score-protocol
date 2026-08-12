import assert from "node:assert/strict";

import { formatSensor } from "../dist/format-sensor.js";
import { summarizeSensors } from "../dist/sensor-summary.js";

const readings = [
  { label: "Temperature", value: 21.5, unit: "C", featured: true },
  { label: "Noise", value: 18, unit: "dB", featured: false },
  { label: "Humidity", value: 45, unit: "%", featured: true }
];

assert.equal(formatSensor(readings[0]), "Temperature: 21.5 C");
assert.equal(
  summarizeSensors(readings),
  "2 featured readings\nTemperature: 21.5 C\nHumidity: 45 %"
);
assert.equal(summarizeSensors([]), "No featured readings");
process.stdout.write("Manual Runner live-feed fixture passed.\n");
