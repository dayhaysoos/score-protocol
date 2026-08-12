import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function repositoryDocument(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("entity-aware review terminology", () => {
  it("defines Change Review and Slice Review as Coding Profile presentations of Plan Review", () => {
    const glossary = repositoryDocument("CONTEXT.md");
    const terminology = repositoryDocument("docs/terminology.md");
    const decisions = repositoryDocument("docs/decisions.md");

    assert.match(
      glossary,
      /\*\*Change Review\*\*:[\s\S]*Coding Profile[\s\S]*Plan Review/
    );
    assert.match(
      glossary,
      /\*\*Slice Review\*\*:[\s\S]*Coding Profile[\s\S]*Plan Review/
    );
    assert.match(
      terminology,
      /Plan Review \| Publication Review, `publication_reviews`/
    );
    assert.match(
      terminology,
      /Change Review[\s\S]*Slice Review[\s\S]*preferred product presentation names[\s\S]*canonical Plan Review/
    );
    assert.match(decisions, /## D-091: Entity-aware review names specialize one canonical human gate/);
    assert.match(
      decisions,
      /Change Review[\s\S]*Slice Review[\s\S]*do not create new protocol objects[\s\S]*Plan Decision[\s\S]*Plan Approval/
    );
  });
});
