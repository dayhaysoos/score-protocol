import assert from "node:assert/strict";

import {
  baseMessage,
  emphasizeMessage,
  summarizePipeline
} from "../dist/pipeline.js";

assert.equal(baseMessage("  Ada  "), "Hello, Ada");
assert.equal(emphasizeMessage("  Ada  "), "HELLO, ADA!");
assert.equal(summarizePipeline("  Ada  "), "Result: HELLO, ADA!");
process.stdout.write("Ordered-slice acceptance passed.\n");
