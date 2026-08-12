import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { terminalSafeJson } from "../src/runner/terminal-safe-json.js";

describe("terminal-safe JSON", () => {
  it("escapes terminal controls while preserving the exact parsed data", () => {
    const value = {
      label:
        "Trusted\nC0\u0000 ESC\u001b]2;OSC\u0007 C1\u009b2J Cf\u200b Bidi\u202e Line\u2028Paragraph\u2029 Supplementary\u{E0001}"
    };

    const serialized = terminalSafeJson(value, 2);

    assert.doesNotMatch(serialized, /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]|\p{Cf}/u);
    assert.match(serialized, /\\u009b/u);
    assert.match(serialized, /\\u200b/u);
    assert.match(serialized, /\\u202e/u);
    assert.match(serialized, /\\u2028/u);
    assert.match(serialized, /\\u2029/u);
    assert.match(serialized, /\\udb40\\udc01/u);
    assert.deepEqual(JSON.parse(serialized), value);
  });
});
