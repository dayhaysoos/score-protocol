import assert from "node:assert/strict";

import { readingProgress } from "../dist/reading-progress.js";
import { summarizeReadings } from "../dist/reading-summary.js";

assert.equal(
  readingProgress({ id: "zero", title: "Zero", totalPages: 0, pagesRead: 10 }),
  0
);
assert.equal(
  readingProgress({ id: "negative-total", title: "Negative", totalPages: -10, pagesRead: 4 }),
  0
);
assert.equal(
  readingProgress({ id: "low", title: "Low", totalPages: 80, pagesRead: -5 }),
  0
);
assert.equal(
  readingProgress({ id: "floor", title: "Floor", totalPages: 80, pagesRead: 27 }),
  33
);
assert.equal(
  readingProgress({ id: "high", title: "High", totalPages: 80, pagesRead: 120 }),
  100
);

const readings = [
  { id: "done", title: "Done", totalPages: 100, pagesRead: 120 },
  { id: "active", title: "Active", totalPages: 80, pagesRead: 25 },
  { id: "not-started", title: "Not started", totalPages: 20, pagesRead: -4 }
];
const before = JSON.stringify(readings);

assert.equal(
  summarizeReadings(readings),
  "3 books · 1 complete · 75 pages remaining"
);
assert.equal(JSON.stringify(readings), before);

process.stdout.write("Reading progress acceptance passed.\n");
