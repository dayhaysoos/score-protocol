import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  PUBLICATION_REVIEW_RENDERER,
  renderPublicationReviewHtml,
  type RenderableReviewSnapshot
} from "../src/render.js";

const ACCEPTED_DOCUMENT = {
  content: [
    "# Product brief",
    "",
    "Build the smallest useful slice with `native controls`.",
    "",
    "- Add a task",
    "- Filter tasks",
    "- Keep each task",
    "  in creation order",
    "  - Prove nested behavior",
    "",
    "Use **strong evidence**, *careful emphasis*, and [the guide](https://example.com/guide).",
    "Do not follow [unsafe links](javascript:alert).",
    "",
    "> Review the observable behavior.",
    "",
    "---",
    "",
    "```sh",
    "npm test",
    "```",
    "",
    "<script>alert(\"never execute\")</script>"
  ].join("\n"),
  media_type: "text/plain; charset=utf-8",
  path: "docs/product.md"
};

function capsule(id: string, targetPath: string, purpose: string) {
  const objective = `Implement ${targetPath}`;
  const agentInput = {
    objective,
    target: { path: targetPath, operation: "replace" },
    intended_outcome: objective,
    declarations: { owned: [], consumed: [] },
    input_bindings: [
      {
        contract_input: "allocated-requirements",
        kind: "accepted_requirements",
        version: "1",
        purpose: "Supply only the requirements allocated to this file.",
        content: [{ id: "R1", statement: "People can add a task." }]
      },
      {
        contract_input: "project-context",
        kind: "project_context",
        version: "1",
        purpose,
        content: ACCEPTED_DOCUMENT
      }
    ],
    required_capabilities: [],
    constraints: ["Only modify the assigned target."],
    prohibited_effects: ["Do not access the network."]
  };

  return {
    capsule_id: id,
    capsule_digest: `sha256:${id}`,
    target_path: targetPath,
    operation: "replace",
    objective,
    intended_outcome: objective,
    contract_roles: [{ logical_name: "todo-contract" }],
    context_items: [],
    resolved_skills: [],
    required_capabilities: [],
    allowed_effects: [],
    prohibited_effects: agentInput.prohibited_effects,
    source_citations: [],
    payload_id: `payload:${id}`,
    control: {},
    control_digest: `sha256:control-${id}`,
    agent_input: agentInput,
    agent_input_digest: `sha256:agent-${id}`,
    payload_digest: `sha256:payload-${id}`,
    agent_input_markdown: "# Exact Agent Input",
    agent_input_markdown_digest: `sha256:markdown-${id}`
  };
}

function snapshot(): RenderableReviewSnapshot {
  const app = capsule("app", "src/App.tsx", "Defines the interaction behavior for the app.");
  const test = capsule("app-test", "src/App.test.tsx", "Defines the browser-facing acceptance cases.");
  return {
    review_id: "review:readable-context",
    created_at: "2026-08-08T12:00:00.000Z",
    manifest: {
      protocol_id: "manifest:todo",
      content_digest: "sha256:manifest",
      label: "Dependable to-do app",
      objective: "Build a dependable in-memory to-do app."
    },
    compilation_report: {
      protocol_id: "report:todo",
      content_digest: "sha256:report",
      summary: "Two-file test fixture."
    },
    compiler_submission: {
      compiler_name: "test compiler",
      model_id: "test/model",
      submission_id: "submission:test",
      bundle_digest: "sha256:bundle"
    },
    publication_gate: {
      publication_validation: {
        validation_run_id: "validation:test",
        validator_id: "validator:test",
        validator_version: "1",
        validated_at: "2026-08-08T12:00:00.000Z",
        checks: ["one Agent Package per file"],
        outcome: "valid",
        finding_count: 0
      },
      blockers: [],
      warnings: [],
      compilation_gaps: []
    },
    digest_set: {
      manifest: { protocol_id: "manifest:todo", content_digest: "sha256:manifest" },
      compilation_report: { protocol_id: "report:todo", content_digest: "sha256:report" },
      pass: { protocol_id: "pass:todo", content_digest: "sha256:pass" },
      payloads: [app, test].map((item) => ({
        payload_id: item.payload_id,
        target_path: item.target_path,
        control_digest: item.control_digest,
        agent_input_digest: item.agent_input_digest,
        payload_digest: item.payload_digest
      }))
    },
    requirements: [
      {
        requirement_id: "requirement:1",
        label: "R1",
        statement: "People can add a task.",
        implementation_path: [
          { target_kind: "capsule", target_id: "app", binding_digest: "sha256:binding-app" },
          { target_kind: "capsule", target_id: "app-test", binding_digest: "sha256:binding-test" }
        ]
      }
    ],
    source_citations: [],
    passes: [
      {
        pass_id: "pass:todo",
        pass_digest: "sha256:pass",
        objective: "Build a dependable in-memory to-do app.",
        base_revision: {},
        contract_set: { logical_name: "todo-contract" },
        contracts: [],
        dependencies: [],
        capsules: [app, test]
      }
    ]
  };
}

describe("publication review renderer", () => {
  it("names the reviewed entity and gives the reviewer one truthful next action", () => {
    const review = snapshot();
    const originalSnapshot = JSON.stringify(review);

    const changeHtml = renderPublicationReviewHtml(review, { reviewKind: "change" });
    const sliceHtml = renderPublicationReviewHtml(review, { reviewKind: "slice" });
    const planHtml = renderPublicationReviewHtml(review);

    assert.match(changeHtml, /<title>SCORE Change Review/);
    assert.match(changeHtml, /<span class="product-name">SCORE Change Review<\/span>/);
    assert.match(changeHtml, /aria-label="Change scope"/);
    assert.match(changeHtml, /<strong[^>]*>Ready for approval<\/strong>/);
    assert.match(changeHtml, /<code>score start<\/code>/);
    assert.match(changeHtml, /SCORE will ask for the model, reasoning, and final approval before anything runs\./);
    assert.match(changeHtml, /<summary>Change validation and audit<\/summary>/);
    assert.match(changeHtml, /This validates the Change only\. It does not test an implementation\./);
    assert.match(changeHtml, /Implementation quality is evaluated outside SCORE\./);
    assert.doesNotMatch(changeHtml, /Project and acceptance checks/);
    assert.doesNotMatch(changeHtml, /SCORE Plan Review/);

    assert.match(sliceHtml, /<title>SCORE Slice Review/);
    assert.match(sliceHtml, /<span class="product-name">SCORE Slice Review<\/span>/);
    assert.match(sliceHtml, /aria-label="Slice scope"/);
    assert.match(sliceHtml, /<summary>Slice validation and audit<\/summary>/);
    assert.match(sliceHtml, /This validates the Slice only\. It does not test an implementation\./);
    assert.doesNotMatch(sliceHtml, /SCORE Plan Review/);

    assert.match(planHtml, /<title>SCORE Plan Review/);
    assert.doesNotMatch(planHtml, /<code>score start<\/code>/);

    assert.equal(JSON.stringify(review), originalSnapshot);
  });

  it("orders Agent Briefs by dependency and keeps complete per-Agent meaning", () => {
    const review = snapshot();
    const pass = review.passes[0] ?? assert.fail("Expected one reviewed pass.");
    const owner = pass.capsules[0] ?? assert.fail("Expected an owner File Brief.");
    const consumer = pass.capsules[1] ?? assert.fail("Expected a consumer File Brief.");
    owner.target_path = "src/account.ts";
    owner.operation = "replace";
    owner.objective = "Add account status.";
    owner.intended_outcome = owner.objective;
    consumer.target_path = "src/format-account.ts";
    consumer.operation = "create";
    consumer.objective = "Create the account label formatter.";
    consumer.intended_outcome = consumer.objective;
    const ownerInput = owner.agent_input as {
      objective: string;
      intended_outcome: string;
      declarations: { owned: Array<Record<string, unknown>>; consumed: Array<Record<string, unknown>> };
    };
    const consumerInput = consumer.agent_input as {
      objective: string;
      intended_outcome: string;
      declarations: { owned: Array<Record<string, unknown>>; consumed: Array<Record<string, unknown>> };
    };
    ownerInput.objective = owner.objective;
    ownerInput.intended_outcome = owner.objective;
    const accountDeclaration = 'export interface Account { status: "active" | "suspended"; }';
    ownerInput.declarations.owned.push({
      name: "Account",
      declaration: accountDeclaration,
      description: "Represents an account with its current status."
    });
    consumerInput.objective = consumer.objective;
    consumerInput.intended_outcome = consumer.objective;
    consumerInput.declarations.consumed.push(ownerInput.declarations.owned[0] ?? assert.fail());
    pass.dependencies.push({
      dependent_capsule_id: consumer.capsule_id,
      prerequisite_kind: "capsule",
      prerequisite_id: owner.capsule_id,
      description: "src/format-account.ts consumes Account from src/account.ts."
    });
    pass.capsules = [consumer, owner];

    const html = renderPublicationReviewHtml(review, { reviewKind: "change" });
    assert.doesNotMatch(html, /How the files fit together|file-map/);

    assert.ok(
      html.indexOf('id="slice-1-file-src-account-ts"') <
        html.indexOf('id="slice-1-file-src-format-account-ts"')
    );
    assert.equal(html.match(/<span>People can add a task\.<\/span>/g)?.length, 2);
    assert.match(html, /<p>People can add a task\.<\/p>/);
    assert.match(
      html,
      /<span>Account<\/span><span class="context-kind">Defines<\/span>/
    );
    assert.match(
      html,
      /<span>Account<\/span><span class="context-kind">Uses<\/span>/
    );
    assert.match(
      html,
      /Defined in <code>src\/account\.ts<\/code> and received by this Agent as read-only context\./
    );
    assert.match(html, /<pre class="code-block language-typescript" data-language="typescript">/);
    assert.match(
      html,
      /<span class="syntax-keyword">export<\/span> <span class="syntax-keyword">interface<\/span> <span class="syntax-declaration">Account<\/span> <span class="syntax-punctuation">\{<\/span>\n  <span class="syntax-identifier">status<\/span>/
    );
    assert.match(
      html,
      /<span class="syntax-string">&quot;active&quot;<\/span> <span class="syntax-punctuation">\|<\/span> <span class="syntax-string">&quot;suspended&quot;<\/span><span class="syntax-punctuation">;<\/span>\n<span class="syntax-punctuation">\}<\/span>/
    );
    assert.equal(ownerInput.declarations.owned[0]?.declaration, accountDeclaration);
    assert.doesNotMatch(html, /Implement here|Use from owner|Use from <code>/);
    assert.match(html, /1 new · 1 modified/);
    assert.doesNotMatch(html, />Replace</);
  });

  it("renders a deterministic navigation-only sidebar with working Agent Brief and declaration links", () => {
    const review = snapshot();
    const pass = review.passes[0] ?? assert.fail("Expected one reviewed pass.");
    const owner = pass.capsules[0] ?? assert.fail("Expected an owner Agent Brief.");
    const consumer = pass.capsules[1] ?? assert.fail("Expected a consumer Agent Brief.");
    owner.target_path = "src/account.ts";
    owner.operation = "replace";
    consumer.target_path = "src/format-account.ts";
    consumer.operation = "create";
    const ownerInput = owner.agent_input as {
      declarations: { owned: Array<Record<string, unknown>>; consumed: Array<Record<string, unknown>> };
    };
    const consumerInput = consumer.agent_input as {
      declarations: { owned: Array<Record<string, unknown>>; consumed: Array<Record<string, unknown>> };
    };
    const accountDeclaration = {
      name: "Account",
      declaration: 'export interface Account { status: "active" | "suspended"; }',
      description: "Represents an account with its current status."
    };
    ownerInput.declarations.owned.push(accountDeclaration);
    consumerInput.declarations.consumed.push(accountDeclaration);
    pass.dependencies.push({
      dependent_capsule_id: consumer.capsule_id,
      prerequisite_kind: "capsule",
      prerequisite_id: owner.capsule_id,
      description: "The formatter uses Account."
    });
    pass.capsules = [consumer, owner];

    const html = renderPublicationReviewHtml(review, { reviewKind: "slice" });
    const sidebar = html.slice(
      html.indexOf('<aside class="review-rail"'),
      html.indexOf("</aside>") + "</aside>".length
    );

    assert.match(sidebar, /href="#review-overview">Overview</);
    assert.match(sidebar, /href="#files-pass:todo">Agent Briefs</);
    assert.match(sidebar, /href="#slice-1-file-src-account-ts"[\s\S]*?<code>src\/account\.ts<\/code>[\s\S]*?<span class="rail-operation">Modify<\/span>/);
    assert.match(sidebar, /href="#slice-1-file-src-format-account-ts"[\s\S]*?<code>src\/format-account\.ts<\/code>[\s\S]*?<span class="rail-operation">Create<\/span>/);
    assert.ok(sidebar.indexOf("src/account.ts") < sidebar.indexOf("src/format-account.ts"));
    assert.match(sidebar, /<summary>1 declaration<\/summary>/);
    assert.match(sidebar, /href="#slice-1-file-src-account-ts-declaration-1-account">Account<\/a>/);
    assert.doesNotMatch(sidebar, /slice-1-file-src-format-account-ts-uses-1-account/);
    assert.ok(sidebar.indexOf(">Agent Briefs<") < sidebar.indexOf(">Requirements<"));
    assert.ok(sidebar.indexOf(">Requirements<") < sidebar.indexOf(">Context<"));
    assert.ok(sidebar.indexOf(">Context<") < sidebar.indexOf(">Technical record<"));
    assert.doesNotMatch(sidebar, />Execution Flow</);

    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
    const localTargets = [...html.matchAll(/href="#([^"]+)"/g)].map((match) => match[1]);
    assert.ok(localTargets.length > 0);
    for (const target of localTargets) assert.ok(ids.has(target), `Missing local link target: ${target}`);

    assert.doesNotMatch(html, /<details class="file-package"[^>]*\sname=/);
    assert.match(html, /const revealTarget = \(hash\) =>/);
    assert.match(html, /ancestor instanceof HTMLDetailsElement/);
    assert.match(html, /window\.addEventListener\("hashchange"/);
    assert.match(html, /\.review-rail \{[\s\S]*?position: sticky/);
    assert.match(html, /\.skip-link, \.topbar, \.review-rail \{ display: none; \}/);
  });

  it("projects accepted inputs once as readable, safe, human review content", () => {
    const review = snapshot();
    const html = renderPublicationReviewHtml(review);

    assert.equal(html, renderPublicationReviewHtml(review));
    assert.equal(PUBLICATION_REVIEW_RENDERER.version, "0.1.0-alpha.25");
    assert.match(html, /2 files will change/);
    assert.match(html, /2 modified/);
    assert.match(html, /2 isolated file-agents/);
    assert.doesNotMatch(html, /Slice 1:/);
    assert.match(html, /<h2[^>]*>Files to change<\/h2>/);
    assert.match(html, /<h2[^>]*>Read-only context<\/h2>/);
    assert.doesNotMatch(html, />Accepted inputs<\/h/);
    assert.ok(html.indexOf("Files to change") < html.indexOf("Requirement coverage"));
    assert.ok(html.indexOf("Requirement coverage") < html.indexOf("Read-only context"));
    assert.match(
      html,
      /<h3 class="file-name"><code>src\/App\.tsx<\/code><\/h3>[\s\S]*?<span class="context-preview-label">Receives<\/span>[\s\S]*?docs\/product\.md/
    );
    assert.match(
      html,
      /<h3 class="file-name"><code>src\/App\.tsx<\/code><\/h3>[\s\S]*?<p class="file-purpose">Implement src\/App\.tsx<\/p>[\s\S]*?<\/summary>/
    );
    assert.match(html, /<h4>Purpose<\/h4>/);
    assert.equal(html.match(/class="accepted-input"/g)?.length, 1);
    assert.match(html, /<h4>Product brief<\/h4>/);
    assert.match(html, /<code>native controls<\/code>/);
    assert.match(html, /<li>Add a task<\/li>/);
    assert.match(html, /<li>Keep each task in creation order<ul><li>Prove nested behavior<\/li><\/ul><\/li>/);
    assert.match(html, /<strong>strong evidence<\/strong>/);
    assert.match(html, /<em>careful emphasis<\/em>/);
    assert.match(html, /<a href="https:\/\/example\.com\/guide">the guide<\/a>/);
    assert.doesNotMatch(html, /href="javascript:/);
    assert.match(html, /<blockquote><p>Review the observable behavior\.<\/p><\/blockquote>/);
    assert.match(html, /<hr>/);
    assert.match(
      html,
      /<pre class="code-block language-shell" data-language="shell"><code><span class="syntax-identifier">npm<\/span> <span class="syntax-identifier">test<\/span><\/code><\/pre>/
    );
    assert.doesNotMatch(html, /<script>alert/);
    assert.match(html, /&lt;script&gt;alert\(&quot;never execute&quot;\)&lt;\/script&gt;/);
    assert.doesNotMatch(html, />Project context<\/span>/);
    assert.match(html, /<h2[^>]*>Requirement coverage<\/h2>/);
    assert.match(html, /<span class="requirement-id">R1<\/span>/);
    assert.match(html, /src\/App\.tsx/);
    assert.match(html, /src\/App\.test\.tsx/);
    assert.equal(html.match(/class="shared-settings"/g)?.length ?? 0, 0);
    assert.equal(html.match(/class="prompt-outcome"/g)?.length ?? 0, 0);
    assert.match(html, /href="#slice-1-accepted-input-docs-product-md"/);
    assert.match(html, /Machine evidence/);
    assert.match(html, /Exact Agent Input JSON/);
    assert.match(html, /sha256:agent-app/);
    assert.match(html, /addEventListener\("beforeprint"/);
    assert.match(html, /addEventListener\("afterprint"/);
    assert.match(html, /removeAttribute\("name"\)/);
    assert.match(html, /setAttribute\("name", item\.name\)/);
    assert.doesNotMatch(html, /details:not\(\[open\]\) > \*:not\(summary\) \{ display: none; \}/);
    assert.match(html, /<summary>Plan validation and audit<\/summary>/);
    assert.doesNotMatch(html, /<summary>Verification<\/summary>/);
    assert.match(html, /<h3 id="plan-validation-status">Plan validation<\/h3>/);
    assert.match(html, /<strong class="passed">Passed<\/strong><span>0 plan findings<\/span>/);
    assert.match(html, /This validates the plan only\. It does not test an implementation\./);
    assert.match(html, /<h3 id="implementation-status">Implementation status<\/h3>/);
    assert.match(html, /No candidates have been generated or applied from this plan\./);
    assert.match(html, /Implementation quality is evaluated outside SCORE\./);
    assert.doesNotMatch(html, /Project and acceptance checks/);
    assert.match(html, /<h3>Plan checks performed<\/h3>/);
    assert.doesNotMatch(html, /<strong>valid<\/strong>/);
    assert.match(html, /&quot;media_type&quot;: &quot;text\/plain; charset=utf-8&quot;/);
    assert.match(html, /overflow-wrap: anywhere/);
    assert.match(
      html,
      /<strong>Product brief<\/strong><code>docs\/product\.md<\/code>[\s\S]*?<span class="context-recipient-label">Sent to<\/span><span class="context-recipient-files"><code>src\/App\.tsx<\/code><code>src\/App\.test\.tsx<\/code><\/span>/
    );
    assert.doesNotMatch(html, /<strong>Product brief<\/strong><code>docs\/product\.md<\/code>[\s\S]{0,100}<span>2 files<\/span>/);
  });

  it("syntax-colors recognized source files without rewriting their frozen text", () => {
    const review = snapshot();
    const agentInput = review.passes[0]?.capsules[0]?.agent_input as {
      input_bindings: Array<Record<string, unknown>>;
    };
    const projectFile = agentInput.input_bindings.find(
      (binding) => binding.kind === "project_context"
    );
    assert.ok(projectFile);
    const source = "export interface Example { value: string; }";
    projectFile.content = {
      content: source,
      media_type: "text/typescript; charset=utf-8",
      path: "src/example.ts"
    };

    const html = renderPublicationReviewHtml(review);
    assert.match(html, /<pre class="code-block language-typescript" data-language="typescript">/);
    assert.match(html, /<span class="syntax-keyword">interface<\/span>/);
    assert.match(html, /<span class="syntax-type">string<\/span>/);
    assert.equal((projectFile.content as { content: string }).content, source);
    assert.equal(html, renderPublicationReviewHtml(review));
  });

  it("keeps non-file project context visible and counts distinct consuming files", () => {
    const review = snapshot();
    const firstInput = review.passes[0]?.capsules[0]?.agent_input as {
      input_bindings: Array<Record<string, unknown>>;
    };
    const projectFile = firstInput.input_bindings.find(
      (binding) => binding.kind === "project_context"
    );
    assert.ok(projectFile);
    firstInput.input_bindings.push(
      { ...projectFile },
      {
        contract_input: "project-context",
        kind: "project_context",
        version: "1",
        purpose: "Inline project rule for the assigned file.",
        content: { review_mode: "behavior-first" }
      }
    );

    const html = renderPublicationReviewHtml(review);
    assert.match(
      html,
      /<summary>\s*<span>Project context<\/span>[\s\S]*?<p>Inline project rule for the assigned file\.<\/p>[\s\S]*?&quot;review_mode&quot;: &quot;behavior-first&quot;/
    );
    const productSummary = html.match(
      /<details class="accepted-input" id="slice-1-accepted-input-docs-product-md">[\s\S]*?<\/summary>/
    )?.[0];
    assert.ok(productSummary);
    assert.match(productSummary, /<span class="context-recipient-label">Sent to<\/span>/);
    assert.equal(productSummary.match(/src\/App\.tsx/g)?.length, 1);
    assert.equal(productSummary.match(/src\/App\.test\.tsx/g)?.length, 1);
  });

  it("keeps document and requirement links unique across slices", () => {
    const review = snapshot();
    const second = capsule("second-app", "src/SecondApp.tsx", "Defines the second slice.");
    review.passes.push({
      ...(review.passes[0] ?? assert.fail("Expected fixture pass.")),
      pass_id: "pass:second",
      pass_digest: "sha256:second-pass",
      capsules: [second]
    });
    const implementationPath = review.requirements[0]?.implementation_path;
    assert.ok(Array.isArray(implementationPath));
    implementationPath.push({
      target_kind: "capsule",
      target_id: "second-app",
      binding_digest: "sha256:binding-second"
    });

    const html = renderPublicationReviewHtml(review);
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(new Set(ids).size, ids.length);
    assert.match(html, /href="#slice-1-accepted-input-docs-product-md"/);
    assert.match(html, /href="#slice-2-accepted-input-docs-product-md"/);
    assert.match(html, /href="#slice-1-requirement-r1"/);
    assert.match(html, /href="#slice-2-requirement-r1"/);
    assert.match(html, /Work group 1: Todo contract/);
    assert.match(html, /Work group 2: Todo contract/);
    assert.doesNotMatch(html, /Change group|Slice group/);
  });

  it("disambiguates requirement labels that normalize to the same anchor", () => {
    const review = snapshot();
    const firstRequirement = review.requirements[0];
    assert.ok(firstRequirement);
    firstRequirement.label = "R 1";
    review.requirements.push({
      requirement_id: "requirement:slug-collision",
      label: "R-1",
      statement: "People can filter tasks.",
      implementation_path: [
        { target_kind: "capsule", target_id: "app", binding_digest: "sha256:filter-app" },
        { target_kind: "capsule", target_id: "app-test", binding_digest: "sha256:filter-test" }
      ]
    });
    for (const item of review.passes[0]?.capsules ?? []) {
      const input = item.agent_input as { input_bindings: Array<Record<string, unknown>> };
      const allocated = input.input_bindings.find(
        (binding) => binding.kind === "accepted_requirements"
      );
      assert.ok(allocated && Array.isArray(allocated.content));
      allocated.content[0] = { id: "R 1", statement: "People can add a task." };
      allocated.content.push({ id: "R-1", statement: "People can filter tasks." });
    }

    const html = renderPublicationReviewHtml(review);
    assert.match(html, /id="slice-1-requirement-r-1"/);
    assert.match(html, /id="slice-1-requirement-r-1-2"/);
    assert.match(html, /href="#slice-1-requirement-r-1"/);
    assert.match(html, /href="#slice-1-requirement-r-1-2"/);
  });
});
