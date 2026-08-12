import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const skillPath = fileURLToPath(
  new URL("../skills/score-authoring/SKILL.md", import.meta.url)
);
const humanSkillPath = fileURLToPath(
  new URL("../skills/how-to-score/SKILL.md", import.meta.url)
);

describe("SCORE authoring skill", () => {
  it("teaches the agent-managed Change flow and stops at review", () => {
    const skill = readFileSync(skillPath, "utf8");

    assert.match(skill, /score change --input -/);
    assert.match(skill, /score change --schema/);
    assert.match(skill, /omit `change_id`.*new Change/is);
    assert.match(skill, /returns `changeId`.*as `change_id`/is);
    assert.match(skill, /complete document rather than a patch/i);
    assert.match(skill, /CHANGE_REVIEW_PUBLICATION_INCOMPLETE.*retained `changeId`/is);
    assert.match(skill, /one or more File Briefs/i);
    assert.match(skill, /authoring (?:LLM|agent).*chooses.*scope/is);
    assert.match(skill, /same semantic\s+primitives.*Slice/is);
    assert.match(skill, /create.*modify/is);
    assert.match(skill, /does not support.*delete.*rename/is);
    assert.match(skill, /immutable.*superseding revision/is);
    assert.match(skill, /HTML Change Review/i);
    assert.match(skill, /`score start` next action/i);
    assert.match(skill, /`humanApprovalRequired: true`/i);
    assert.match(skill, /durable.*identity.*dependencies/is);
    assert.match(skill, /stop.*before.*approval.*Run/is);
  });

  it("defines the normal use-SCORE preparation flow without duplicating the runtime schema", () => {
    const skill = readFileSync(skillPath, "utf8");

    assert.match(skill, /use SCORE/i);
    assert.match(skill, /score\/slices\/<slice-id>\.json/);
    assert.match(skill, /prepareSlices\(\)/);
    assert.match(skill, /stable\s+`slice_id`/i);
    assert.match(skill, /`after` field/);
    assert.match(skill, /test files only when the person explicitly requested tests/i);
    assert.match(skill, /waiting.*applied.*predecessor/is);
    assert.match(skill, /cross-file seam audit/i);
    assert.match(skill, /file requirement.*exact.*slice-level requirement/is);
    assert.match(skill, /exact import statement/i);
    assert.match(skill, /name.*declaration.*description/is);
    assert.match(skill, /does not parse.*infer module paths/is);
    assert.match(skill, /function\s+arguments.*JSX prop names/is);
    assert.match(skill, /JSX prop names/i);
    assert.match(skill, /user-visible.*state one\s+rendering owner/is);
    assert.match(skill, /owners inside the same `SliceDraft`/i);
    assert.match(skill, /`create` targets are\s+absent and `modify` targets are present/is);
    assert.match(skill, /authoritative.*schema/i);
    assert.match(skill, /review_ready/);
    assert.match(skill, /HTML\s+Slice Review/i);
    assert.match(skill, /Do not approve/i);
    assert.match(skill, /post-application work/i);
    assert.doesNotMatch(skill, /Account Status/);
    assert.doesNotMatch(skill, /Compilation Bundle/);
    assert.doesNotMatch(skill, /interface SliceDraft\s*\{/);
  });
});

describe("SCORE human guide", () => {
  it("directs existing product material through an agent and preserves the human gate", () => {
    const skill = readFileSync(humanSkillPath, "utf8");

    assert.match(skill, /plan or specification/i);
    assert.match(skill, /issue or acceptance criteria/i);
    assert.match(skill, /product or architecture documentation/i);
    assert.match(skill, /run(?:ning)? `score skill`/i);
    assert.match(skill, /score change --input -/u);
    assert.match(skill, /should not.*approve.*start the Runner/is);
    assert.match(skill, /score start/u);
    assert.match(skill, /ordinary uncommitted changes/i);
    assert.match(skill, /experimental alpha/i);
  });
});
