# Human code-visualization patterns for SCORE Plan Review

**Status:** research recommendation, not a UI specification

**Date:** 2026-08-13

**Question:** Which interaction patterns from current code-review, code-navigation, architecture, traceability, and large-document tools can help a human understand exactly what a SCORE plan will build without weakening deterministic rendering?

## Bottom line

SCORE should not imitate a general-purpose IDE or generate a single dense graph of the repository. The most transferable pattern is **multiple focused, deterministic views over one frozen model**:

1. Keep the canonical approval unit focused on one Slice. A separate plan-level index can orient the reviewer across Slices, but only if that index is itself rendered from an explicit frozen plan snapshot and is clearly not a substitute for Slice approval.
2. Give every Slice Review a deterministic left-hand navigation tree derived from the Slice's stored sections and files. GitHub uses a file tree, path filters, per-file collapse, and review progress to make large changes navigable; SCORE can copy the navigation model without copying mutable “viewed” state into the authoritative artifact.
3. Use relational views only where the schema contains the relationship. A requirement-to-file-to-check matrix is more useful and more honest than an inferred “architecture” graph. A small path or neighborhood view can supplement the matrix when explicit dependencies exist.
4. Treat diagrams as alternative projections of stored facts, never as new facts. Every diagram needs a textual equivalent, a legend, stable ordering, and a pinned rendering implementation.
5. Use progressive disclosure for supporting evidence and long exact inputs, not for approval scope, risks, obligations, or missing coverage. Important review facts should remain visible without interaction.

The key product distinction is between **authoritative content** and **interaction state**. Expanding a `<details>` element, following an anchor, filtering an already-embedded file list, or zooming a diagram can be local browser behavior. None of those interactions may create, rewrite, classify, or summarize plan facts.

## Deterministic rendering boundary

The canonical contract should remain:

```text
frozen Plan Review snapshot
+ identified renderer version
+ pinned renderer configuration and embedded assets
----------------------------------------------------
= byte-identical canonical HTML
+ stored digest
```

Visible semantic content may come from only three sources:

| Source | Example | Requirement |
| --- | --- | --- |
| Stored fact | Slice title, target path, requirement text, declared dependency | Present in the frozen review snapshot |
| Mechanical derivation | `7 files`, `2 requirements without a proving check` | Named, deterministic rule over frozen fields with stable ordering |
| Renderer copy | `Files`, `Requirements`, `Show exact input` | Fixed by the identified renderer version |

The renderer should not consult the live repository, the current clock, a remote API, mutable database rows outside the frozen snapshot, browser storage, or an LLM. It should not use random identifiers or environment-dependent iteration order. If a relationship is useful enough to visualize but is not represented in the SCORE schema, that is a schema-authoring question before it is a rendering question.

Interactive state does not have to be part of the digest, but it must not alter the facts being reviewed. For example, an open or closed disclosure can change visibility while the same content remains in the HTML. Persisted “viewed,” “completed,” or personalized filter state is more dangerous because it can make two humans believe they reviewed different scopes while looking at the same digest; SCORE should initially avoid persisting such state inside the canonical review.

## Pattern summary

| Pattern | Human question answered | Strong source examples | SCORE recommendation |
| --- | --- | --- | --- |
| File tree plus focused detail | What files are in scope, and where am I? | GitHub pull-request file tree and filters | Copy directly, derived from frozen targets |
| Changed-symbol jump list | What behavior inside a file is intended to change? | GitHub changed methods; VS Code Outline | Copy only if symbols are authored or deterministically extracted before snapshot freeze |
| Definition/reference navigation | Where is this contract declared and consumed? | GitHub and VS Code code navigation | Translate to stored declaration/consumer links; do not live-index during render |
| Incoming/outgoing call hierarchy | Who invokes this, and what does it invoke? | VS Code call hierarchy | Use as a small, explicit dependency neighborhood, not a whole-repository graph |
| Dependency path | Why is this item present, and what transitively depends on it? | GitHub dependency graph “Show paths” | Show a path on demand when explicit Slice/file dependencies exist |
| Hierarchical architecture views | What is the system context, and what detail is relevant now? | C4 and Structurizr zoom/navigation | Use plan index → Slice Review → file package as stable levels, without implying C4 semantics |
| Traceability matrix | Is every requirement implemented and verified somewhere? | IBM DOORS and Azure requirements traceability | Make this a primary SCORE review view and distinguish planned coverage from executed evidence |
| Heading navigation and disclosure | How can I scan a very large exact document? | W3C headings, native details, APG accordion | Use semantic headings, anchors, and shallow disclosures; never hide essential scope or missing coverage |

## 1. Code-review file navigation

### What it helps a human answer

- Which files are in the proposed scope?
- How many have I inspected?
- Which file am I reading now?
- Can I narrow the list by path, type, or ownership without losing the complete scope?
- What changed inside this particular file?

### Current interaction pattern

GitHub's pull-request interface uses a file tree to give a high-level view of changed files, navigate to a file, and filter by path. It also filters by extension, ownership, dotfiles, deleted files, and already-viewed files. Its review workflow recommends reviewing one file at a time, marking it viewed so it collapses, and using a progress bar to track coverage. GitHub also provides a “Jump to” list of changed methods and functions for supported languages. See GitHub's official documentation for [filtering files in a pull request](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/filtering-files-in-a-pull-request), [reviewing proposed changes](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/reviewing-proposed-changes-in-a-pull-request), and [finding changed methods and functions](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/finding-changed-methods-and-functions-in-a-pull-request).

### What SCORE should copy

- A persistent Slice navigation sidebar with stable groups such as `Scope`, `Requirements`, `Files`, `Relationships`, `Exact inputs`, and `Audit`.
- A nested file list in canonical target-path order, with stored `create`/`modify` labels and deterministic counts.
- Clicking a file should move focus to its exact package without removing other files from the document.
- Optional in-page filtering may hide nonmatching file cards, but it should visibly report `showing n of total` and offer a one-step reset.
- A compact always-visible summary on a collapsed file card: path, operation, purpose, requirement count, declaration count, and read-only-input count, but only where those values are stored or mechanically counted.

### What SCORE should not copy

- Do not label a file “viewed” or show a review-completion percentage unless SCORE deliberately models that human state. A browser-local checkbox is not approval evidence.
- Do not run a parser over the live checkout while rendering to invent a changed-symbol list. If symbol-level scope matters, it must be authored in the plan or computed before the review snapshot is frozen with its extractor identity recorded.
- Do not lazy-load authoritative file content from SQLite or the network after the canonical HTML is opened. The complete review content should already be inside the digested artifact.

### Accessibility, export, and determinism

The sidebar should be a real `<nav>` with an accessible name and ordinary anchor links. File packages should remain headed sections in document order so the page is understandable without CSS or JavaScript. Search/filter controls need labels, visible focus, keyboard operation, and a result count. The print view should include the complete unfiltered scope and should not inherit transient browser filtering or disclosure state.

Stable anchor IDs should derive from immutable stored identifiers or a documented collision-safe encoding of target paths—not array indexes, timestamps, or random UUID generation at render time.

## 2. Symbol, reference, call, and dependency views

### What they help a human answer

- Where is a contract defined?
- Which planned files consume or implement it?
- Who calls this behavior, and what does it call?
- If this declaration changes, what else is in the impact radius?
- Why does a transitive dependency or context file appear in this Slice?

### Current interaction patterns

GitHub code navigation exposes a symbols pane, definition links, and reference results. Its documentation describes code navigation as linking a named entity's references and definitions, and notes that GitHub builds that information with Tree-sitter-based extraction. VS Code similarly combines breadcrumbs, an Outline tree, go-to-definition, find-references, and inline “peek” so a user can inspect a dependency without a large context switch. Its Outline view can sort by name, category, or source position. See [GitHub code navigation](https://docs.github.com/en/repositories/working-with-files/using-files/navigating-code-on-github), [VS Code code navigation](https://code.visualstudio.com/docs/editing/editingevolved), and the [VS Code Outline documentation](https://code.visualstudio.com/docs/editing/userinterface#_outline-view).

Call hierarchy makes direction explicit: incoming calls answer “who calls this?” and outgoing calls answer “what does this call?” VS Code's official description emphasizes drilling into callers of callers or calls of calls rather than showing every edge at once. See the [VS Code Call Hierarchy description](https://code.visualstudio.com/updates/v1_33#_call-hierarchy).

GitHub's dependency graph primarily presents a searchable, filterable list. It labels direct versus transitive relationships and offers “Show paths” for the transitive route that introduced a package. It associates dependency snapshots with a commit SHA and detector metadata. This is a useful precedent for exposing graph provenance instead of presenting a graph as ambient truth. See [exploring repository dependencies](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/explore-dependencies) and the [dependency submission snapshot contract](https://docs.github.com/en/rest/dependency-graph/dependency-submission).

### What SCORE should copy

- Prefer a **typed relationship list** as the base representation: `declares`, `consumes`, `reads as context`, `implements requirement`, `proves requirement`, `depends on Slice`.
- From a selected file or declaration, show a small incoming/outgoing neighborhood or a single dependency path on demand.
- Keep direction labels visible in text; arrow direction and color must not carry meaning alone.
- Show the source of every relationship: explicit plan field, documented declaration, read-only-context binding, or deterministic pre-freeze extractor with identity and version.
- Let a reviewer move from an edge to both endpoint file packages through ordinary links.

### What SCORE should not copy

- Do not begin with a force-directed “everything graph.” Dense graphs obscure edge labels, are hard to linearize, and often imply relationships that the underlying model cannot prove.
- Do not conflate different edge types. A file being provided as read-only context is not the same as a build dependency, contract consumer, or requirement implementation.
- Do not claim compiler-accurate impact analysis from name matching. GitHub's source makes the extraction boundary explicit; SCORE should be at least as clear about authored versus extracted links.
- Do not allow browser-side graph traversal to query mutable rows outside the frozen snapshot.

### Accessibility, export, and determinism

Every graph needs a complete textual adjacency list or relationship table in the same artifact. Graph nodes must be keyboard-reachable only if they perform an action, and their accessible names should include node type and label. A visible legend should explain node and edge types; the C4 guidance likewise recommends that diagrams have a title, scope, and key and that relationships be labelled. See the [C4 notation guidance](https://c4model.com/diagrams/notation).

For deterministic output, use a fixed node order and a layout algorithm/configuration whose version is part of the renderer identity. A hand-written HTML/CSS relationship list or simple layered SVG will be easier to make byte-stable than a general graph package.

If Mermaid is evaluated, it cannot be accepted with default settings: Mermaid documents that generated SVG IDs are time-based and nondeterministic by default. It provides `deterministicIds` and `deterministicIDSeed`, but those must be explicitly set; its accessible title and description syntax can emit SVG `<title>` and `<desc>` elements. See Mermaid's official [`deterministicIds` configuration](https://mermaid.js.org/config/schema-docs/config-properties-deterministicids.html), [`deterministicIDSeed` configuration](https://mermaid.js.org/config/schema-docs/config-properties-deterministicidseed.html), and [accessibility options](https://mermaid.js.org/config/accessibility.html). Even with those options, SCORE would need to pin the Mermaid version, pre-render and inline the SVG, fix fonts/layout configuration, and regression-test exact bytes. Client-side Mermaid rendering or a CDN is a poor fit for a canonical approval artifact.

## 3. Hierarchical architecture views

### What they help a human answer

- What is the whole change trying to accomplish?
- What is the scope of this review versus adjacent work?
- How does this Slice fit into the plan without pulling every downstream detail into the approval decision?
- Which relationship deserves a deeper view?

### Current interaction pattern

The C4 model uses hierarchical abstractions and diagrams—system context, containers, components, and code—so different levels of zoom tell different stories to different audiences. Its official guidance explicitly says teams do not need every level, only the diagrams that add value. See the [C4 model overview](https://c4model.com/) and [diagram levels](https://c4model.com/diagrams).

Structurizr implements this as multiple views over a text-defined model. Its viewer offers a diagram thumbnail list and keyboard navigation; double-clicking an element can zoom to the next level, documentation, or decisions. Its static-site export preserves a subset of these interactions, including zoom, descriptions, metadata, and quick navigation. See the [Structurizr DSL](https://docs.structurizr.com/dsl), [diagram navigation](https://docs.structurizr.com/ui/diagrams/navigation), and [static-site export](https://docs.structurizr.com/export/static-site).

Structurizr also recommends scoping a workspace to one software system and keeping workspaces small rather than modelling everything in one workspace. That is directionally relevant to SCORE's Slice question even though a Slice is not a C4 software system. See [Structurizr workspace recommendations](https://docs.structurizr.com/workspaces/recommendations).

### What SCORE should copy

- Use **stable scope levels**, not one page that tries to say everything:
  1. Plan index: ordered Slices, explicit dependencies, and current authored/review state.
  2. Slice Review: the canonical approval scope and all facts needed to decide it.
  3. File package: exact per-target instructions, declarations, context, and checks.
  4. Machine/audit evidence: exact serialized material and digests.
- Provide deterministic links from the plan index to Slice Reviews and from a Slice Review to each file package.
- Give every view an explicit title and scope statement. A reviewer should never have to infer whether the page is plan-wide or Slice-specific.
- Add diagrams only for relationships that are materially easier to understand visually than as a short list.

### What SCORE should not copy

- Do not import C4 vocabulary into SCORE unless the SCORE schema actually models C4 systems, containers, and components. The transferable idea is scoped zoom, not the nouns.
- Do not make double-click or hover the only way to discover a deeper view. Ordinary links and text must expose the same navigation.
- Do not embed the complete plan, every Slice, every file package, and all audit JSON in one mandatory DOM merely to claim there is one artifact. That increases scope ambiguity, print cost, and the chance that an unrelated Slice revision changes the digest of the review in front of the human.

### Accessibility, export, and determinism

Each level should remain a conventional document with headings and links. A visual overview must have an equivalent ordered Slice list. Export can be static HTML because all navigation targets and exact content are known at snapshot time. If multiple HTML files form one frozen review set, a manifest should bind their paths and digests; otherwise, the safest first design is one self-contained HTML file per canonical Slice Review plus a separately identified plan index artifact.

## 4. Requirements traceability matrices

### What they help a human answer

- Does every requirement have at least one planned implementation target?
- Does every requirement have an explicit way to be verified?
- Which file builds the behavior, and which file proves it?
- Which requirements have missing, duplicated, or ambiguous coverage?
- What would be affected if a requirement changes?

### Current interaction pattern

IBM DOORS uses typed, bidirectional links to trace from user requirements to what is being built and forward to dependent features. Its documentation frames traceability as both satisfaction checking and change-impact analysis. IBM's newer traceability guidance connects requirements to implementation and test artifacts for coverage, progress, and impact analysis. See [DOORS links and traceability](https://www.ibm.com/docs/en/engineering-lifecycle-management-suite/doors/9.7.2?topic=requirements-links-traceability) and [DOORS Next traceability](https://www.ibm.com/docs/en/engineering-lifecycle-management-suite/doors-next/7.3.0_beta?topic=requirements-traceability).

Azure DevOps links requirements to test cases, bugs, code changes, and test results. Its Requirements Quality widget lists requirements in scope with test pass rate, failed-test count, and requirements without associated tests. See Microsoft's [requirements traceability](https://learn.microsoft.com/en-us/azure/devops/pipelines/test/requirements-traceability?view=azure-devops) and [Azure Test Plans traceability overview](https://learn.microsoft.com/en-us/azure/devops/test/overview?view=azure-devops#traceability).

### What SCORE should copy

- A primary semantic table with one row per requirement and explicit columns such as:

  | Requirement | Built by | Proved by | Planned check | Coverage finding |
  | --- | --- | --- | --- | --- |
  | Stored requirement | Links to stored target bindings | Links to stored proof targets | Stored verification intent | Deterministic missing/duplicate/ambiguous rule |

- Bidirectional navigation: requirement → target and target → requirements.
- Deterministic coverage findings that point to the exact missing or conflicting binding.
- Separate implementation responsibility from verification responsibility.
- Put missing coverage before detailed file packages because it can invalidate the decision without requiring a full document read.

### What SCORE should not copy

- A pre-build Plan Review must not display test pass rates, “proven,” or green success states. Azure's result-oriented display is useful after execution; SCORE's pre-build equivalent is planned coverage, not evidence.
- Do not infer “proves requirement” merely because a target path looks like a test file. The relationship must be authored or explicitly derived by a schema rule.
- Do not turn each requirement into a wide dashboard with many weak status badges. The matrix should optimize for exact links and uncovered cells.
- Do not make color the sole representation of coverage or failure.

### Accessibility, export, and determinism

Use a native HTML `<table>` with a caption, `<th>` cells, and `scope` attributes. W3C guidance explains that structural table markup lets assistive technology associate data cells with row and column headers; it also recommends splitting overly complex matrices into simpler tables. See the [W3C Tables Tutorial](https://www.w3.org/WAI/tutorials/tables/) and [multi-level table guidance](https://www.w3.org/WAI/tutorials/tables/multi-level/).

On narrow screens, keep the table in a labelled horizontal-scroll region or transform each row into a labelled record without losing header relationships. In print, repeat headers and avoid clipping cells. Matrix order should come from stored requirement order and canonical target-path order. Coverage findings should be pure functions whose rule identifiers are recorded alongside the renderer version.

## 5. Large-document progressive disclosure

### What it helps a human answer

- What are the important sections, and how do I jump to them?
- Can I scan the complete scope before opening exact supporting detail?
- Can I compare two relevant sections without navigating away?
- Can I print or export a complete review rather than only the currently expanded screen state?

### Current interaction pattern

Semantic headings create a navigable document outline. W3C guidance notes that assistive-technology users can jump directly to headings and that descriptive headings help people orient and understand relationships between sections. See [W3C heading technique H69](https://www.w3.org/WAI/WCAG22/Techniques/html/H69.html) and [WCAG 2.2 headings and labels](https://www.w3.org/WAI/WCAG22/Understanding/headings-and-labels).

The HTML Standard defines `<details>` and `<summary>` as a native disclosure widget. The WAI-ARIA Authoring Practices accordion pattern specifies expected heading, button, `aria-expanded`, `aria-controls`, and keyboard behavior for custom accordions. See the [HTML details/summary specification](https://html.spec.whatwg.org/dev/interactive-elements.html#the-details-element) and [WAI accordion pattern](https://www.w3.org/WAI/ARIA/apg/patterns/accordion/).

The GOV.UK Design System provides a useful constraint: accordions are appropriate when users need an overview and selectively compare related sections, but not for content everyone needs to see. It recommends headings or start-of-page anchor links before an accordion, warns against nested accordions, and ensures all content remains visible when JavaScript is unavailable. See the official [GOV.UK accordion guidance](https://design-system.service.gov.uk/components/accordion/).

### What SCORE should copy

- A real document outline and a sticky anchor-link sidebar generated from it.
- A visible summary for every collapsed file package, so scope never disappears behind a generic “show more.”
- Native `<details>/<summary>` for exact per-file inputs, read-only context explanations, and machine/audit material.
- “Expand all exact inputs” and “Collapse supporting evidence” conveniences if they operate only on visibility.
- Deep links that open the relevant disclosure and move focus to the target.
- A no-JavaScript presentation that still shows every fact and retains approval scope.

### What SCORE should not copy

- Do not collapse the Slice purpose, target list, requirement coverage, validation findings, or approval consequences by default.
- Do not nest disclosures deeply. One Slice section containing file disclosures, with a shallow exact-input disclosure inside each file, should be treated as an upper bound and tested with humans.
- Do not use tabs when a reviewer needs to compare multiple file packages or requirement rows simultaneously.
- Do not remember expanded/collapsed state in browser storage for the canonical artifact's first version. It creates an experience not represented by the artifact digest and can hide important evidence on reopen.
- Do not make print output depend on current disclosure state.

### Accessibility, export, and determinism

Prefer native elements over custom ARIA widgets. Maintain logical heading levels even inside collapsed sections. Provide a skip link to the main review content and visible focus for all controls. WCAG's reflow guidance expects most content to work at a 320-CSS-pixel width without two-dimensional scrolling, while allowing an exception for genuinely two-dimensional diagrams and data tables; SCORE should confine horizontal scrolling to those bounded regions. See [WCAG 2.2 reflow guidance](https://www.w3.org/WAI/WCAG22/Understanding/reflow).

Print CSS should force all authoritative content visible, remove sticky positioning and interactive controls, repeat table headers, print full link targets only when useful, and keep the review identity/digest on each page. Browser interaction state must not alter exported scope.

## Implications for rendering Slices

### Recommended artifact boundary

**Keep each Slice as its own canonical Plan Review HTML artifact.** This follows the human decision boundary and limits digest churn: revising Slice 6 should not silently change the canonical bytes being reviewed for Slice 1.

Add a separate **deterministic plan index** only if SCORE first defines its exact snapshot and lifecycle. The index can answer “where does this Slice fit?” with:

- plan identity and revision;
- ordered Slice titles and stored purposes;
- explicit Slice dependency edges;
- stored authoring/review states;
- links to the exact canonical Slice Review artifacts and their digests.

The plan index must not introduce approval controls for a collection if SCORE approval is Slice-scoped. It should not infer roadmap phases, confidence, execution status, or downstream outcomes from prose.

### Recommended Slice Review information architecture

```text
Slice identity and exact approval scope
├── Purpose and approval consequence
├── Validation findings and missing coverage
├── Requirements traceability
├── File map
│   ├── target path / operation / purpose
│   ├── typed relationships
│   └── links to exact file package
├── File packages
│   ├── build instructions
│   ├── declarations and consumers
│   ├── read-only context
│   ├── planned verification
│   └── exact frozen Agent Input
└── Audit identity, renderer identity, snapshot digest
```

The sidebar is a projection of this tree. Its labels are renderer copy; its entries, counts, badges, and destinations come only from the frozen snapshot or documented mechanical derivations.

### When a graph earns its place

A graph should be added only if a repeated review question cannot be answered as clearly by the file map or traceability matrix. Strong candidates are:

- explicit Slice dependency order in the plan index;
- declaration → consumer relationships within a large Slice;
- one selected target's incoming/outgoing dependency neighborhood.

Weak candidates are:

- decorative “architecture” boxes inferred from file paths;
- a force-directed graph of every file and context binding;
- generated flow narratives that classify work as “later,” “proven,” or “safe” without schema fields.

## Recommended grill topics

Research can identify sound patterns, but the human experience still needs product decisions. A grill session should lock down these questions before renderer work:

1. What exact proposition does a human approve: one Slice, a Slice plus its Agent Packages, or the full plan?
2. Which facts must be visible before any disclosure is opened?
3. What makes a reviewer confident they have covered the full scope without adding mutable “viewed” state?
4. Which relationship types are currently explicit in the SCORE schema, and which desired visuals would require new authored fields?
5. Does the plan index need to be immutable per plan revision, or can it be a clearly labelled live navigation page outside the approval boundary?
6. Which reviews need side-by-side comparison: requirements/files, declaration/consumer, current/revised Slice, or none?
7. What must survive print, PDF, no JavaScript, narrow screens, and screen-reader heading/table navigation?
8. When humans and agents discuss revisions, are comments separate records pointing into a frozen artifact, or is a revised Slice always a new snapshot and digest?

## Recommendation for the first visual iteration

Prototype only the information architecture, using actual frozen review data:

1. A Slice-scoped header that states exactly what is being approved.
2. A deterministic section/file sidebar.
3. Requirement traceability before file details.
4. Collapsible file packages with meaningful always-visible summaries.
5. A relationship table, not a graph.
6. Exact Agent Input and audit material collapsed but fully embedded.
7. A print/no-JavaScript rendering that exposes all content.

Do not add a plan-wide roadmap, generated explanation, architecture diagram, or review-progress state in this first iteration. Those should wait until the grill establishes their schema provenance and approval meaning.

## Primary sources

- GitHub Docs: [Filtering files in a pull request](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/filtering-files-in-a-pull-request)
- GitHub Docs: [Reviewing proposed changes](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/reviewing-proposed-changes-in-a-pull-request)
- GitHub Docs: [Finding changed methods and functions](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/finding-changed-methods-and-functions-in-a-pull-request)
- GitHub Docs: [Navigating code on GitHub](https://docs.github.com/en/repositories/working-with-files/using-files/navigating-code-on-github)
- GitHub Docs: [Exploring repository dependencies](https://docs.github.com/en/code-security/how-tos/secure-your-supply-chain/secure-your-dependencies/explore-dependencies)
- GitHub Docs: [Dependency submission API](https://docs.github.com/en/rest/dependency-graph/dependency-submission)
- Visual Studio Code Docs: [Code Navigation](https://code.visualstudio.com/docs/editing/editingevolved)
- Visual Studio Code Docs: [User interface and Outline view](https://code.visualstudio.com/docs/editing/userinterface#_outline-view)
- Visual Studio Code release notes: [Call Hierarchy](https://code.visualstudio.com/updates/v1_33#_call-hierarchy)
- C4 Model: [Overview](https://c4model.com/), [diagram levels](https://c4model.com/diagrams), and [notation guidance](https://c4model.com/diagrams/notation)
- Structurizr Docs: [DSL](https://docs.structurizr.com/dsl), [diagram navigation](https://docs.structurizr.com/ui/diagrams/navigation), [static-site export](https://docs.structurizr.com/export/static-site), and [workspace recommendations](https://docs.structurizr.com/workspaces/recommendations)
- IBM Docs: [DOORS links and traceability](https://www.ibm.com/docs/en/engineering-lifecycle-management-suite/doors/9.7.2?topic=requirements-links-traceability) and [DOORS Next traceability](https://www.ibm.com/docs/en/engineering-lifecycle-management-suite/doors-next/7.3.0_beta?topic=requirements-traceability)
- Microsoft Learn: [Requirements traceability](https://learn.microsoft.com/en-us/azure/devops/pipelines/test/requirements-traceability?view=azure-devops) and [Azure Test Plans traceability](https://learn.microsoft.com/en-us/azure/devops/test/overview?view=azure-devops#traceability)
- WHATWG HTML Standard: [`details` and `summary`](https://html.spec.whatwg.org/dev/interactive-elements.html#the-details-element)
- W3C WAI: [Accordion pattern](https://www.w3.org/WAI/ARIA/apg/patterns/accordion/), [heading technique H69](https://www.w3.org/WAI/WCAG22/Techniques/html/H69.html), [headings and labels](https://www.w3.org/WAI/WCAG22/Understanding/headings-and-labels), [reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow), and [accessible tables](https://www.w3.org/WAI/tutorials/tables/)
- GOV.UK Design System: [Accordion guidance](https://design-system.service.gov.uk/components/accordion/)
- Mermaid Docs: [deterministic IDs](https://mermaid.js.org/config/schema-docs/config-properties-deterministicids.html), [deterministic ID seed](https://mermaid.js.org/config/schema-docs/config-properties-deterministicidseed.html), and [accessibility options](https://mermaid.js.org/config/accessibility.html)
