import { sha256Bytes } from "./canonical.js";

export const AGENT_INPUT_RENDERER = {
  id: "score.coding.agent-input-markdown",
  version: "0.1.0-alpha.4",
  specification:
    "fixed headings: objective,target,intended outcome,documented interfaces to implement,read-only documented interfaces,resolved input bindings,capabilities,constraints,prohibited effects; declaration and description text is preserved exactly; JSON values use two-space indentation; declared array order is preserved"
} as const;

export const PUBLICATION_REVIEW_RENDERER = {
  id: "score.coding.publication-review-html",
  version: "0.1.0-alpha.21",
  specification:
    "single-file semantic HTML using entity-aware Change Review or Slice Review language without changing the canonical snapshot; the review leads with its approval readiness, exact next command, and a dependency-first relationship map; human-facing file operations use Create and Modify while canonical operations remain unchanged; every collapsed File Brief names its purpose, and its expanded content shows full requirements, documented declaration owners, selected context with purpose, skills, limits, and current target state; implementation quality is explicitly outside SCORE; exact Agent Input and machine audit evidence remain disclosed on demand; printing temporarily opens every disclosure and restores its prior screen state afterward"
} as const;

export function rendererDigest(renderer: { id: string; version: string; specification: string }): string {
  return sha256Bytes(`${renderer.id}\n${renderer.version}\n${renderer.specification}\n`);
}

function prettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function markdownValue(value: unknown): string {
  if (typeof value === "string") return value;
  return `\n\n\`\`\`json\n${prettyJson(value)}\n\`\`\``;
}

export interface RenderableAgentInput {
  objective: string;
  target: Record<string, unknown>;
  intended_outcome: string;
  declarations: {
    owned: Array<DocumentedDeclaration>;
    consumed: Array<DocumentedDeclaration>;
  };
  input_bindings: Array<Record<string, unknown>>;
  required_capabilities: Array<Record<string, unknown>>;
  constraints: string[];
  prohibited_effects: string[];
}

export interface DocumentedDeclaration {
  readonly name: string;
  readonly declaration: string;
  readonly description: string;
}

function renderDocumentedDeclarationMarkdown(
  declaration: DocumentedDeclaration,
  readOnly: boolean
): string[] {
  return [
    "",
    `### ${declaration.name}`,
    "",
    declaration.description,
    ...(readOnly
      ? ["", "Use this documented interface as read-only context. Do not redefine it in this file."]
      : []),
    "",
    "```ts",
    declaration.declaration,
    "```"
  ];
}

export function renderAgentInput(agentInput: RenderableAgentInput): string {
  const lines = [
    "# SCORE Agent Input",
    "",
    "## Objective",
    "",
    agentInput.objective,
    "",
    "## Target",
    "",
    "\`\`\`json",
    prettyJson(agentInput.target),
    "\`\`\`",
    "",
    "## Intended Outcome",
    "",
    agentInput.intended_outcome,
    "",
    "## Documented Interfaces to Implement"
  ];
  for (const declaration of agentInput.declarations.owned) {
    lines.push(...renderDocumentedDeclarationMarkdown(declaration, false));
  }
  lines.push("", "## Read-only Documented Interfaces");
  if (agentInput.declarations.consumed.length === 0) {
    lines.push("", "None.");
  }
  for (const declaration of agentInput.declarations.consumed) {
    lines.push(...renderDocumentedDeclarationMarkdown(declaration, true));
  }
  lines.push("", "## Resolved Input Bindings");
  for (const binding of agentInput.input_bindings) {
    lines.push(
      "",
      `### ${String(binding.contract_input)}`,
      "",
      `Purpose: ${String(binding.purpose)}`,
      "",
      `Kind: ${String(binding.kind)}; version: ${String(binding.version)}`,
      "",
      "Resolved content:",
      markdownValue(binding.content)
    );
  }
  lines.push("", "## Required Capabilities", "", "\`\`\`json", prettyJson(agentInput.required_capabilities), "\`\`\`", "", "## Constraints", "");
  for (const constraint of agentInput.constraints) lines.push(`- ${constraint}`);
  lines.push("", "## Prohibited Effects", "");
  for (const effect of agentInput.prohibited_effects) lines.push(`- ${effect}`);
  lines.push("");
  return lines.join("\n");
}

export interface RenderableReviewSnapshot {
  review_id: string;
  created_at: string;
  manifest: { protocol_id: string; content_digest: string; label: string; objective: string };
  compilation_report: { protocol_id: string; content_digest: string; summary: string };
  compiler_submission: Record<string, unknown>;
  publication_gate: {
    publication_validation: {
      validation_run_id: string;
      validator_id: string;
      validator_version: string;
      validated_at: string;
      checks: readonly string[];
      outcome: "valid";
      finding_count: number;
    };
    blockers: unknown[];
    warnings: unknown[];
    compilation_gaps: unknown[];
  };
  digest_set: {
    manifest: { protocol_id: string; content_digest: string };
    compilation_report: { protocol_id: string; content_digest: string };
    pass: { protocol_id: string; content_digest: string };
    payloads: Array<{
      payload_id: string;
      target_path: string;
      control_digest: string;
      agent_input_digest: string;
      payload_digest: string;
    }>;
  };
  requirements: Array<Record<string, unknown>>;
  source_citations: Array<Record<string, unknown>>;
  passes: Array<{
    pass_id: string;
    pass_digest: string;
    objective: string;
    base_revision: Record<string, unknown>;
    contract_set: Record<string, unknown>;
    contracts: Array<Record<string, unknown>>;
    dependencies: Array<Record<string, unknown>>;
    capsules: Array<{
      capsule_id: string;
      capsule_digest: string;
      target_path: string;
      operation: string;
      objective: string;
      intended_outcome: string;
      contract_roles: Array<Record<string, unknown>>;
      context_items: Array<Record<string, unknown>>;
      resolved_skills: Array<Record<string, unknown>>;
      required_capabilities: Array<Record<string, unknown>>;
      allowed_effects: Array<Record<string, unknown>>;
      prohibited_effects: string[];
      source_citations: Array<Record<string, unknown>>;
      payload_id: string;
      control: unknown;
      control_digest: string;
      agent_input: unknown;
      agent_input_digest: string;
      payload_digest: string;
      agent_input_markdown: string;
      agent_input_markdown_digest: string;
    }>;
  }>;
}

export type ReviewKind = "change" | "slice" | "plan";

export interface PublicationReviewRenderOptions {
  readonly snapshotHref?: string;
  readonly includeProofLinks?: boolean;
  readonly reviewKind?: ReviewKind;
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function asRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function stringValue(value: unknown, fallback = "Not specified"): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderStringList(values: unknown): string {
  const items = Array.isArray(values) ? values.filter((value): value is string => typeof value === "string") : [];
  if (items.length === 0) return '<p class="empty">None.</p>';
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderResolvedContent(value: unknown): string {
  if (typeof value === "string") {
    const isCode = value.includes("\n") || value.includes("export ") || value.includes("# ");
    return isCode
      ? `<pre><code>${escapeHtml(value)}</code></pre>`
      : `<p>${escapeHtml(value)}</p>`;
  }
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return renderStringList(value);
  }
  return `<pre><code>${escapeHtml(prettyJson(value))}</code></pre>`;
}

interface ResolvedFileContent {
  readonly path: string;
  readonly mediaType: string;
  readonly content: string;
}

interface AcceptedInputUsage {
  readonly targetPath: string;
  readonly purpose: string;
}

interface AcceptedInput {
  readonly key: string;
  readonly anchor: string;
  readonly file: ResolvedFileContent;
  readonly title: string;
  readonly usages: AcceptedInputUsage[];
}

interface RequirementCoverageItem {
  readonly requirement: JsonRecord;
  readonly label: string;
  readonly targetPaths: string[];
  readonly anchor: string;
}

function resolvedFileContent(value: unknown): ResolvedFileContent | undefined {
  const record = asRecord(value);
  if (
    typeof record.path !== "string" ||
    typeof record.content !== "string" ||
    typeof record.media_type !== "string"
  ) {
    return undefined;
  }
  return {
    path: record.path,
    mediaType: record.media_type,
    content: record.content
  };
}

function acceptedInputKey(file: ResolvedFileContent): string {
  return `${file.path}\n${file.mediaType}\n${sha256Bytes(file.content)}`;
}

function anchorSlug(value: string): string {
  const slug = value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "item";
}

function documentTitle(file: ResolvedFileContent): string {
  if (isMarkdownDocument(file)) {
    const heading = file.content
      .split(/\r?\n/)
      .map((line) => line.match(/^#\s+(.+)$/)?.[1]?.trim())
      .find((value): value is string => typeof value === "string" && value.length > 0);
    if (heading) return heading;
  }
  return file.path.split("/").at(-1) ?? file.path;
}

function isMarkdownDocument(file: ResolvedFileContent): boolean {
  return file.path.toLowerCase().endsWith(".md") || file.mediaType.includes("markdown");
}

function safeMarkdownHref(value: string): string | undefined {
  const href = value.trim();
  if (href.length === 0 || /[\u0000-\u001f\u007f\s]/.test(href)) return undefined;
  const scheme = href.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/)?.[1]?.toLowerCase();
  if (scheme && !["http", "https", "mailto"].includes(scheme)) return undefined;
  return href;
}

function renderInlineMarkdown(value: string): string {
  const pattern = /(`[^`\n]+`|\[[^\]\n]+\]\([^\s)]+(?:\s+"[^"]*")?\)|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_)/g;
  const output: string[] = [];
  let cursor = 0;
  for (const match of value.matchAll(pattern)) {
    const token = match[0];
    const index = match.index;
    output.push(escapeHtml(value.slice(cursor, index)));
    if (token.startsWith("`")) {
      output.push(`<code>${escapeHtml(token.slice(1, -1))}</code>`);
    } else if (token.startsWith("[")) {
      const link = token.match(/^\[([^\]]+)\]\(([^\s)]+)(?:\s+"([^"]*)")?\)$/);
      const href = link ? safeMarkdownHref(link[2] ?? "") : undefined;
      output.push(
        link && href
          ? `<a href="${escapeHtml(href)}"${link[3] ? ` title="${escapeHtml(link[3])}"` : ""}>${renderInlineMarkdown(link[1] ?? "")}</a>`
          : escapeHtml(token)
      );
    } else if (token.startsWith("**") || token.startsWith("__")) {
      output.push(`<strong>${renderInlineMarkdown(token.slice(2, -2))}</strong>`);
    } else {
      output.push(`<em>${renderInlineMarkdown(token.slice(1, -1))}</em>`);
    }
    cursor = index + token.length;
  }
  output.push(escapeHtml(value.slice(cursor)));
  return output.join("");
}

type MarkdownListKind = "ul" | "ol";

interface MarkdownListItem {
  readonly text: string[];
  readonly children: MarkdownList[];
}

interface MarkdownList {
  readonly kind: MarkdownListKind;
  readonly indent: number;
  readonly items: MarkdownListItem[];
}

function markdownListMarker(line: string): {
  indent: number;
  kind: MarkdownListKind;
  text: string;
} | undefined {
  const match = line.match(/^( *)([-+*]|\d+[.)])\s+(.+)$/);
  if (!match) return undefined;
  return {
    indent: (match[1] ?? "").length,
    kind: /^\d/.test(match[2] ?? "") ? "ol" : "ul",
    text: match[3] ?? ""
  };
}

function renderMarkdownList(list: MarkdownList): string {
  return `<${list.kind}>${list.items
    .map(
      (item) => `<li>${renderInlineMarkdown(item.text.join(" "))}${item.children
        .map(renderMarkdownList)
        .join("")}</li>`
    )
    .join("")}</${list.kind}>`;
}

function parseMarkdownList(lines: string[], start: number): {
  html: string;
  next: number;
} {
  const first = markdownListMarker(lines[start] ?? "");
  if (!first) return { html: "", next: start + 1 };
  const root: MarkdownList = { kind: first.kind, indent: first.indent, items: [] };
  const stack: MarkdownList[] = [root];
  let index = start;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const marker = markdownListMarker(line);
    if (marker) {
      if (marker.indent < root.indent) break;
      while (stack.length > 1 && (stack.at(-1)?.indent ?? 0) > marker.indent) stack.pop();
      let current = stack.at(-1) ?? root;
      if (marker.indent > current.indent) {
        const parentItem = current.items.at(-1);
        if (!parentItem) break;
        const child: MarkdownList = { kind: marker.kind, indent: marker.indent, items: [] };
        parentItem.children.push(child);
        stack.push(child);
        current = child;
      } else if (marker.kind !== current.kind) {
        if (stack.length === 1) break;
        stack.pop();
        const parent = stack.at(-1) ?? root;
        const parentItem = parent.items.at(-1);
        if (!parentItem) break;
        const sibling: MarkdownList = { kind: marker.kind, indent: marker.indent, items: [] };
        parentItem.children.push(sibling);
        stack.push(sibling);
        current = sibling;
      }
      current.items.push({ text: [marker.text.trim()], children: [] });
      index += 1;
      continue;
    }

    if (line.trim().length === 0) {
      const nextLine = lines[index + 1] ?? "";
      if (markdownListMarker(nextLine) || /^\s+\S/.test(nextLine)) {
        index += 1;
        continue;
      }
      break;
    }

    const continuation = line.match(/^(\s+)(\S.*)$/);
    if (!continuation || (continuation[1]?.length ?? 0) <= root.indent) break;
    const currentItem = stack.at(-1)?.items.at(-1);
    if (!currentItem) break;
    currentItem.text.push((continuation[2] ?? "").trim());
    index += 1;
  }
  return { html: renderMarkdownList(root), next: index };
}

function isThematicBreak(line: string): boolean {
  return /^\s{0,3}((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/.test(line);
}

function startsMarkdownBlock(line: string): boolean {
  return (
    /^```/.test(line) ||
    /^(#{1,6})\s+/.test(line) ||
    /^>/.test(line) ||
    isThematicBreak(line) ||
    markdownListMarker(line) !== undefined
  );
}

function renderMarkdownDocument(content: string): string {
  const lines = content.replaceAll("\r\n", "\n").split("\n");
  const blocks: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (line.trim().length === 0) {
      index += 1;
      continue;
    }

    const fence = line.match(/^```\s*([^\s`]*)\s*$/);
    if (fence) {
      const fenceLines: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index] ?? "")) {
        fenceLines.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) index += 1;
      const language = (fence[1] ?? "").replaceAll(/[^a-zA-Z0-9_+.-]/g, "");
      blocks.push(
        `<pre class="document-code"><code${language ? ` data-language="${escapeHtml(language)}"` : ""}>${escapeHtml(fenceLines.join("\n"))}</code></pre>`
      );
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = Math.min(6, (heading[1]?.length ?? 1) + 3);
      blocks.push(`<h${level}>${renderInlineMarkdown(heading[2] ?? "")}</h${level}>`);
      index += 1;
      continue;
    }

    if (isThematicBreak(line)) {
      blocks.push("<hr>");
      index += 1;
      continue;
    }

    if (/^>/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length) {
        const quote = (lines[index] ?? "").match(/^>\s?(.*)$/);
        if (!quote) break;
        quoteLines.push(quote[1] ?? "");
        index += 1;
      }
      blocks.push(`<blockquote>${renderMarkdownDocument(quoteLines.join("\n"))}</blockquote>`);
      continue;
    }

    if (markdownListMarker(line)) {
      const list = parseMarkdownList(lines, index);
      blocks.push(list.html);
      index = list.next;
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (
      index < lines.length &&
      (lines[index] ?? "").trim().length > 0 &&
      !startsMarkdownBlock(lines[index] ?? "")
    ) {
      paragraph.push((lines[index] ?? "").trim());
      index += 1;
    }
    blocks.push(`<p>${renderInlineMarkdown(paragraph.join(" "))}</p>`);
  }
  return blocks.join("\n");
}

function renderFileContent(file: ResolvedFileContent): string {
  return isMarkdownDocument(file)
    ? renderMarkdownDocument(file.content)
    : `<pre class="document-code"><code>${escapeHtml(file.content)}</code></pre>`;
}

function collectAcceptedInputs(
  pass: RenderableReviewSnapshot["passes"][number],
  sliceIndex: number
): AcceptedInput[] {
  const inputs = new Map<string, AcceptedInput>();
  const usedAnchors = new Set<string>();
  for (const capsule of pass.capsules) {
    const agentInput = asRecord(capsule.agent_input);
    for (const binding of asRecords(agentInput.input_bindings)) {
      if (binding.kind !== "project_context") continue;
      const file = resolvedFileContent(binding.content);
      if (!file) continue;
      const key = acceptedInputKey(file);
      const existing = inputs.get(key);
      const usage = {
        targetPath: capsule.target_path,
        purpose: stringValue(binding.purpose)
      };
      if (existing) {
        existing.usages.push(usage);
        continue;
      }
      const baseAnchor = `slice-${sliceIndex + 1}-accepted-input-${anchorSlug(file.path)}`;
      let anchor = baseAnchor;
      let suffix = 2;
      while (usedAnchors.has(anchor)) {
        anchor = `${baseAnchor}-${suffix}`;
        suffix += 1;
      }
      usedAnchors.add(anchor);
      inputs.set(key, {
        key,
        anchor,
        file,
        title: documentTitle(file),
        usages: [usage]
      });
    }
  }
  return [...inputs.values()];
}

function renderAcceptedInputs(
  pass: RenderableReviewSnapshot["passes"][number],
  inputs: AcceptedInput[],
  headingLevel: 2 | 3
): string {
  const sourceHeadingLevel = headingLevel + 1;
  const documentItems = inputs.length === 0
    ? '<p class="empty">No read-only project files were supplied.</p>'
    : inputs
        .map(
          (input) => {
            const recipientPaths = [...new Set(input.usages.map((usage) => usage.targetPath))];
            const pathLabel = input.title === input.file.path
              ? ""
              : `<code>${escapeHtml(input.file.path)}</code>`;
            return `<details class="accepted-input" id="${escapeHtml(input.anchor)}">
            <summary>
              <div class="context-source"><h${sourceHeadingLevel} class="context-source-title"><strong>${escapeHtml(input.title)}</strong>${pathLabel}</h${sourceHeadingLevel}></div>
              <span class="context-recipients"><span class="context-recipient-label">Sent to</span><span class="context-recipient-files">${recipientPaths.map((path) => `<code>${escapeHtml(path)}</code>`).join("")}</span></span>
            </summary>
            <div class="accepted-input-content">
              <article class="accepted-document">${renderFileContent(input.file)}</article>
              <div class="input-usage">
                <p class="input-usage-label"><strong>Why each agent receives it</strong></p>
                <ul>${input.usages
                  .map(
                    (usage) => `<li><code>${escapeHtml(usage.targetPath)}</code><span>${escapeHtml(usage.purpose)}</span></li>`
                  )
                  .join("")}</ul>
              </div>
            </div>
          </details>`;
          }
        )
        .join("");
  return `<section class="slice-overview accepted-inputs" aria-labelledby="accepted-inputs-${escapeHtml(pass.pass_id)}">
      <h${headingLevel} id="accepted-inputs-${escapeHtml(pass.pass_id)}">Read-only context</h${headingLevel}>
      <p class="section-help">Supplied to file-agents. SCORE will not create or edit these sources.</p>
      <div class="accepted-input-list">${documentItems}</div>
    </section>`;
}

function collectRequirementCoverage(
  requirements: JsonRecord[],
  pass: RenderableReviewSnapshot["passes"][number],
  sliceIndex: number
): RequirementCoverageItem[] {
  const capsulePaths = new Map(pass.capsules.map((capsule) => [capsule.capsule_id, capsule.target_path]));
  const usedAnchors = new Set<string>();
  return requirements.flatMap((requirement) => {
    const targetPaths = asRecords(requirement.implementation_path)
      .filter((target) => target.target_kind === "capsule" && typeof target.target_id === "string")
      .map((target) => capsulePaths.get(String(target.target_id)))
      .filter((path): path is string => typeof path === "string");
    if (targetPaths.length === 0) return [];
    const label = stringValue(requirement.label, stringValue(requirement.requirement_id, "Requirement"));
    const baseAnchor = `slice-${sliceIndex + 1}-requirement-${anchorSlug(label)}`;
    let anchor = baseAnchor;
    let suffix = 2;
    while (usedAnchors.has(anchor)) {
      anchor = `${baseAnchor}-${suffix}`;
      suffix += 1;
    }
    usedAnchors.add(anchor);
    return [{ requirement, label, targetPaths: [...new Set(targetPaths)], anchor }];
  });
}

function renderRequirementCoverage(
  items: RequirementCoverageItem[],
  pass: RenderableReviewSnapshot["passes"][number],
  sliceIndex: number,
  headingLevel: 2 | 3
): string {
  if (items.length === 0) return "";
  return `<section class="slice-overview requirement-coverage" aria-labelledby="requirements-${escapeHtml(pass.pass_id)}">
      <h${headingLevel} id="requirements-${escapeHtml(pass.pass_id)}">Requirement coverage</h${headingLevel}>
      <p class="section-help">What each requirement changes or tests.</p>
      <ol class="requirement-list">
        ${items
          .map(
            ({ requirement, label, targetPaths, anchor }) => `<li id="${escapeHtml(anchor)}">
              <div class="requirement-copy"><span class="requirement-id">${escapeHtml(label)}</span><p>${escapeHtml(stringValue(requirement.statement))}</p></div>
              <ul class="coverage-files">${targetPaths.map((path) => `<li><a href="#slice-${sliceIndex + 1}-file-${anchorSlug(path)}"><code>${escapeHtml(path)}</code></a></li>`).join("")}</ul>
            </li>`
          )
          .join("")}
      </ol>
    </section>`;
}

function renderFindings(title: string, findings: unknown[], className: string): string {
  if (findings.length === 0) return "";
  return `
    <section class="finding-group ${className}" aria-labelledby="${className}-title">
      <h3 id="${className}-title">${escapeHtml(title)}</h3>
      <ul>
        ${findings
          .map((finding) => {
            const value = asRecord(finding);
            return `<li><strong>${escapeHtml(stringValue(value.code, "Finding"))}</strong> — ${escapeHtml(stringValue(value.message))}</li>`;
          })
          .join("")}
      </ul>
    </section>`;
}

function humanizeIdentifier(value: unknown): string {
  const source = stringValue(value, "Context").replaceAll(/[-_]+/g, " ");
  return `${source.charAt(0).toUpperCase()}${source.slice(1)}`.replace(/\bTypescript\b/g, "TypeScript");
}

function sliceTitle(pass: RenderableReviewSnapshot["passes"][number]): string {
  const sharedContracts = pass.capsules.reduce<Set<string> | undefined>((shared, capsule) => {
    const names = new Set(
      capsule.contract_roles
        .map(asRecord)
        .map((role) => role.logical_name)
        .filter((value): value is string => typeof value === "string" && value.length > 0)
    );
    if (shared === undefined) return names;
    return new Set([...shared].filter((name) => names.has(name)));
  }, undefined);
  const contractNames = [...(sharedContracts ?? [])].sort();
  if (contractNames.length === 1) return humanizeIdentifier(contractNames[0]);

  const contractSet = asRecord(pass.contract_set);
  return humanizeIdentifier(contractSet.logical_name);
}

function renderContextBinding(binding: JsonRecord): string {
  const label = humanizeIdentifier(binding.contract_input);
  const kind = humanizeIdentifier(binding.kind);
  return `
    <details class="context-item">
      <summary>
        <span>${escapeHtml(label)}</span>
${label === kind ? "" : `<span class="context-kind">${escapeHtml(kind)}</span>`}
      </summary>
      <div class="context-content">
        <p>${escapeHtml(stringValue(binding.purpose))}</p>
        ${renderResolvedContent(binding.content)}
      </div>
    </details>`;
}

function renderSkills(skills: JsonRecord[]): string {
  if (skills.length === 0) return '<p class="empty">No skills loaded.</p>';
  return skills
    .map(
      (skill) => `
        <div class="skill">
          <strong>${escapeHtml(humanizeIdentifier(skill.contract_input))}</strong>
          <p>${escapeHtml(stringValue(skill.purpose))}</p>
          ${renderResolvedContent(skill.content)}
        </div>`
    )
    .join("");
}

function renderDeclarations(
  agentInput: JsonRecord,
  ownerPaths: ReadonlyMap<string, string>
): string {
  const declarations = asRecord(agentInput.declarations);
  const owned = asRecords(declarations.owned);
  const consumed = asRecords(declarations.consumed);
  const item = (declaration: JsonRecord, relationship: string, readOnly: boolean) => {
    const readOnlyCopy = readOnly
      ? "<p>Use this documented interface as read-only context. Do not redefine it in this file.</p>"
      : "";
    return `
      <details class="context-item">
        <summary><span>${escapeHtml(stringValue(declaration.name))}</span><span class="context-kind">${relationship}</span></summary>
        <div class="context-content">
          <p>${escapeHtml(stringValue(declaration.description))}</p>
          ${readOnlyCopy}<pre><code>${escapeHtml(stringValue(declaration.declaration))}</code></pre>
        </div>
      </details>`;
  };
  return [
    ...owned.map((declaration) => item(declaration, "Implement here", false)),
    ...consumed.map((declaration) => {
      const ownerPath = ownerPaths.get(stringValue(declaration.name));
      return item(
        declaration,
        ownerPath === undefined
          ? "Use from owner"
          : `Use from <code>${escapeHtml(ownerPath)}</code>`,
        true
      );
    })
  ].join("");
}

function declarationCount(agentInput: JsonRecord): number {
  const declarations = asRecord(agentInput.declarations);
  return asRecords(declarations.owned).length + asRecords(declarations.consumed).length;
}

function renderRequirementReferences(
  bindings: JsonRecord[],
  requirementAnchors: ReadonlyMap<string, string>,
  headingLevel: 4 | 5
): string {
  const requirements = bindings
    .filter((binding) => binding.kind === "accepted_requirements")
    .flatMap((binding) => asRecords(binding.content));
  if (requirements.length === 0) return "";
  return `<section class="package-section">
      <h${headingLevel}>Requirements</h${headingLevel}>
      <ul class="requirement-references">${requirements
        .map((requirement) => {
          const label = stringValue(requirement.id, "Requirement");
          const anchor = requirementAnchors.get(label);
          return anchor
            ? `<li><a href="#${escapeHtml(anchor)}"><span class="requirement-id">${escapeHtml(label)}</span><span>${escapeHtml(stringValue(requirement.statement))}</span></a></li>`
            : `<li><span class="requirement-id">${escapeHtml(label)}</span><span>${escapeHtml(stringValue(requirement.statement))}</span></li>`;
        })
        .join("")}</ul>
    </section>`;
}

function dependencyFirstCapsules(
  pass: RenderableReviewSnapshot["passes"][number]
): RenderableReviewSnapshot["passes"][number]["capsules"] {
  const capsules = [...pass.capsules].toSorted((left, right) =>
    left.target_path.localeCompare(right.target_path)
  );
  const byId = new Map(capsules.map((capsule) => [capsule.capsule_id, capsule]));
  const indegree = new Map(capsules.map((capsule) => [capsule.capsule_id, 0]));
  const dependents = new Map<string, Set<string>>();
  const edges = new Set<string>();
  for (const rawDependency of pass.dependencies) {
    const dependency = asRecord(rawDependency);
    if (
      dependency.prerequisite_kind !== "capsule" ||
      typeof dependency.prerequisite_id !== "string" ||
      typeof dependency.dependent_capsule_id !== "string" ||
      !byId.has(dependency.prerequisite_id) ||
      !byId.has(dependency.dependent_capsule_id)
    ) {
      continue;
    }
    const edge = `${dependency.prerequisite_id}\u0000${dependency.dependent_capsule_id}`;
    if (edges.has(edge)) continue;
    edges.add(edge);
    const downstream = dependents.get(dependency.prerequisite_id) ?? new Set<string>();
    downstream.add(dependency.dependent_capsule_id);
    dependents.set(dependency.prerequisite_id, downstream);
    indegree.set(
      dependency.dependent_capsule_id,
      (indegree.get(dependency.dependent_capsule_id) ?? 0) + 1
    );
  }

  const byTargetPath = (leftId: string, rightId: string): number =>
    (byId.get(leftId)?.target_path ?? leftId).localeCompare(
      byId.get(rightId)?.target_path ?? rightId
    );
  const ready = capsules
    .filter((capsule) => indegree.get(capsule.capsule_id) === 0)
    .map((capsule) => capsule.capsule_id)
    .toSorted(byTargetPath);
  const orderedIds: string[] = [];
  while (ready.length > 0) {
    const current = ready.shift();
    if (current === undefined) break;
    orderedIds.push(current);
    for (const dependent of dependents.get(current) ?? []) {
      const nextIndegree = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, nextIndegree);
      if (nextIndegree === 0) {
        ready.push(dependent);
        ready.sort(byTargetPath);
      }
    }
  }
  const ordered = new Set(orderedIds);
  orderedIds.push(
    ...capsules
      .filter((capsule) => !ordered.has(capsule.capsule_id))
      .map((capsule) => capsule.capsule_id)
  );
  return orderedIds.flatMap((id) => {
    const capsule = byId.get(id);
    return capsule === undefined ? [] : [capsule];
  });
}

function declarationOwnerPaths(
  pass: RenderableReviewSnapshot["passes"][number]
): ReadonlyMap<string, ReadonlyMap<string, string>> {
  const byId = new Map(pass.capsules.map((capsule) => [capsule.capsule_id, capsule]));
  const prerequisiteIds = new Map<string, Set<string>>();
  for (const rawDependency of pass.dependencies) {
    const dependency = asRecord(rawDependency);
    if (
      dependency.prerequisite_kind !== "capsule" ||
      typeof dependency.prerequisite_id !== "string" ||
      typeof dependency.dependent_capsule_id !== "string"
    ) {
      continue;
    }
    const values = prerequisiteIds.get(dependency.dependent_capsule_id) ?? new Set<string>();
    values.add(dependency.prerequisite_id);
    prerequisiteIds.set(dependency.dependent_capsule_id, values);
  }

  const result = new Map<string, ReadonlyMap<string, string>>();
  for (const capsule of pass.capsules) {
    const owners = new Map<string, string>();
    const consumed = asRecords(asRecord(asRecord(capsule.agent_input).declarations).consumed);
    for (const declaration of consumed) {
      const name = stringValue(declaration.name);
      const candidates = [...(prerequisiteIds.get(capsule.capsule_id) ?? [])].flatMap(
        (prerequisiteId) => {
          const prerequisite = byId.get(prerequisiteId);
          if (prerequisite === undefined) return [];
          const owned = asRecords(
            asRecord(asRecord(prerequisite.agent_input).declarations).owned
          );
          return owned.some((item) => item.name === name) ? [prerequisite.target_path] : [];
        }
      );
      if (candidates.length === 1) owners.set(name, candidates[0] ?? "");
    }
    result.set(capsule.capsule_id, owners);
  }
  return result;
}

function humanOperation(operation: string): string {
  if (operation === "create") return "Create";
  if (operation === "replace") return "Modify";
  return "Delete";
}

function renderFileRelationshipMap(
  pass: RenderableReviewSnapshot["passes"][number],
  capsules: RenderableReviewSnapshot["passes"][number]["capsules"],
  ownerPaths: ReadonlyMap<string, ReadonlyMap<string, string>>,
  sliceIndex: number,
  headingLevel: 2 | 3
): string {
  const rows = capsules.map((capsule) => {
    const agentInput = asRecord(capsule.agent_input);
    const consumed = asRecords(asRecord(agentInput.declarations).consumed);
    const declarations = consumed.flatMap((declaration) => {
      const name = stringValue(declaration.name);
      const ownerPath = ownerPaths.get(capsule.capsule_id)?.get(name);
      return ownerPath === undefined
        ? []
        : [`<li><strong>${escapeHtml(name)}</strong> from <code>${escapeHtml(ownerPath)}</code></li>`];
    });
    const contexts = asRecords(agentInput.input_bindings).flatMap((binding) => {
      if (binding.kind !== "project_context") return [];
      const file = resolvedFileContent(binding.content);
      if (file === undefined) return [];
      return [`<li><code>${escapeHtml(file.path)}</code><span>${escapeHtml(stringValue(binding.purpose))}</span></li>`];
    });
    const uses = [...declarations, ...contexts];
    return `<tr>
          <th scope="row"><a href="#slice-${sliceIndex + 1}-file-${anchorSlug(capsule.target_path)}"><code>${escapeHtml(capsule.target_path)}</code></a></th>
          <td>${humanOperation(capsule.operation)}</td>
          <td>${escapeHtml(stringValue(agentInput.objective, capsule.objective))}</td>
          <td>${uses.length === 0 ? '<span class="empty">None</span>' : `<ul class="file-map-uses">${uses.join("")}</ul>`}</td>
        </tr>`;
  });
  return `<section class="slice-overview file-relationship-map" aria-labelledby="file-map-${escapeHtml(pass.pass_id)}">
      <h${headingLevel} id="file-map-${escapeHtml(pass.pass_id)}">How the files fit together</h${headingLevel}>
      <p class="section-help">Declaration owners appear before the files that use them. Agents still work independently.</p>
      <div class="file-map-scroll" role="region" aria-label="File relationships" tabindex="0">
        <table class="file-map">
          <thead><tr><th scope="col">File</th><th scope="col">Action</th><th scope="col">Purpose</th><th scope="col">Uses</th></tr></thead>
          <tbody>${rows.join("")}</tbody>
        </table>
      </div>
    </section>`;
}

function renderProjectInputReferences(
  bindings: JsonRecord[],
  acceptedInputs: AcceptedInput[]
): string {
  const acceptedByKey = new Map(acceptedInputs.map((input) => [input.key, input]));
  const references = bindings.flatMap((binding) => {
    if (binding.kind !== "project_context") return [];
    const file = resolvedFileContent(binding.content);
    if (!file) return [];
    const acceptedInput = acceptedByKey.get(acceptedInputKey(file));
    if (!acceptedInput) return [];
    return [{ binding, acceptedInput }];
  });
  if (references.length === 0) return "";
  return `<ul class="input-references">${references
    .map(
      ({ binding, acceptedInput }) => `<li>
        <a href="#${escapeHtml(acceptedInput.anchor)}"><strong>${escapeHtml(acceptedInput.title)}</strong><code>${escapeHtml(acceptedInput.file.path)}</code></a>
        <p>${escapeHtml(stringValue(binding.purpose))}</p>
      </li>`
    )
    .join("")}</ul>`;
}

function fileContextLabels(bindings: JsonRecord[], acceptedInputs: AcceptedInput[]): string[] {
  const acceptedByKey = new Map(acceptedInputs.map((input) => [input.key, input]));
  const labels = bindings.flatMap((binding) => {
    if (binding.kind !== "project_context") return [];
    const file = resolvedFileContent(binding.content);
    if (!file) return [humanizeIdentifier(binding.contract_input)];
    const acceptedInput = acceptedByKey.get(acceptedInputKey(file));
    return [acceptedInput?.file.path ?? file.path];
  });
  return [...new Set(labels)];
}

function renderTargetState(bindings: JsonRecord[]): string {
  const targetState = bindings.find((binding) => binding.kind === "target_state");
  if (!targetState) return "";
  const state = asRecord(targetState.content);
  const path = stringValue(state.path, "Assigned target");
  const absent = state.state_at_base_revision === "absent";
  const file = resolvedFileContent(targetState.content);
  return `<details class="context-item target-state">
      <summary><span>Current file · <code>${escapeHtml(path)}</code></span><span class="context-kind">${absent ? "New file" : "Frozen base state"}</span></summary>
      <div class="context-content">${
        absent
          ? '<p class="empty">This file does not exist at the frozen base revision.</p>'
          : file
            ? renderFileContent(file)
            : renderResolvedContent(targetState.content)
      }</div>
    </details>`;
}

function renderFileInputs(
  bindings: JsonRecord[],
  acceptedInputs: AcceptedInput[],
  headingLevel: 4 | 5
): string {
  const references = renderProjectInputReferences(bindings, acceptedInputs);
  const targetState = renderTargetState(bindings);
  const acceptedInputKeys = new Set(acceptedInputs.map((input) => input.key));
  const fallbackBindings = bindings.filter(
    (binding) => {
      if (
        binding.kind === "accepted_requirements" ||
        binding.kind === "target_state" ||
        binding.kind === "skill"
      ) {
        return false;
      }
      if (binding.kind !== "project_context") return true;
      const file = resolvedFileContent(binding.content);
      return !file || !acceptedInputKeys.has(acceptedInputKey(file));
    }
  );
  const fallback = fallbackBindings.map(renderContextBinding).join("");
  if (!references && !targetState && !fallback) return "";
  return `<section class="package-section">
      <h${headingLevel}>Context supplied</h${headingLevel}>
      <div class="context-items">${references}${targetState}${fallback}</div>
    </section>`;
}

function renderCapabilities(capabilities: JsonRecord[]): string {
  const operationLabels: Record<string, string> = {
    create_assigned_target: "Create this file",
    read_assigned_target: "Read this file",
    replace_assigned_target: "Modify this file",
    delete_assigned_target: "Delete this file"
  };
  return capabilities
    .map((capability) => {
      const configuration = asRecord(capability.configuration);
      const allowedOperations = Array.isArray(configuration.allowed_operations)
        ? configuration.allowed_operations.map((value) => operationLabels[String(value)] ?? humanizeIdentifier(value))
        : [];
      const disabledAccess = [
        configuration.network === true ? "" : "network",
        configuration.shell === true ? "" : "shell",
        configuration.repository_discovery === true ? "" : "repository discovery"
      ].filter((value) => value.length > 0);
      return `
        <div class="access">
          <p><strong>File access:</strong> ${escapeHtml(allowedOperations.join(", ") || "None")}</p>
          ${disabledAccess.length === 0 ? "" : `<p><strong>No access to:</strong> ${escapeHtml(disabledAccess.join(", "))}.</p>`}
        </div>`;
    })
    .join("");
}

function renderCapsule(
  capsule: RenderableReviewSnapshot["passes"][number]["capsules"][number],
  sliceIndex: number,
  acceptedInputs: AcceptedInput[],
  requirementAnchors: ReadonlyMap<string, string>,
  ownerPaths: ReadonlyMap<string, string>,
  fileHeadingLevel: 3 | 4,
  packageHeadingLevel: 4 | 5
): string {
  const operation = humanOperation(capsule.operation);
  const agentInput = asRecord(capsule.agent_input);
  const bindings = asRecords(agentInput.input_bindings);
  const skills = capsule.resolved_skills.map(asRecord);
  const capabilities = asRecords(agentInput.required_capabilities);
  const objective = stringValue(agentInput.objective);
  const intendedOutcome = stringValue(agentInput.intended_outcome);
  const contextLabels = fileContextLabels(bindings, acceptedInputs);
  const fileAnchor = `slice-${sliceIndex + 1}-file-${anchorSlug(capsule.target_path)}`;
  const limitsHeadingLevel = Math.min(packageHeadingLevel + 1, 6);
  const hasDistinctOutcome = intendedOutcome !== objective;
  const hasLimits =
    capabilities.length > 0 ||
    (Array.isArray(agentInput.constraints) && agentInput.constraints.length > 0) ||
    (Array.isArray(agentInput.prohibited_effects) && agentInput.prohibited_effects.length > 0);
  const purposeSection = `<section class="package-section purpose">
          <h${packageHeadingLevel}>Purpose</h${packageHeadingLevel}>
          <div><p>${escapeHtml(objective)}</p>${hasDistinctOutcome ? `<p class="prompt-outcome"><strong>Expected result:</strong> ${escapeHtml(intendedOutcome)}</p>` : ""}</div>
        </section>`;
  const declarationsSection = declarationCount(agentInput) === 0
    ? ""
    : `<section class="package-section"><h${packageHeadingLevel}>Declarations</h${packageHeadingLevel}><div class="context-items">${renderDeclarations(agentInput, ownerPaths)}</div></section>`;
  const skillsSection = skills.length === 0
    ? ""
    : `<section class="package-section"><h${packageHeadingLevel}>Skills</h${packageHeadingLevel}><div>${renderSkills(skills)}</div></section>`;
  const limitsSection = hasLimits
    ? `<section class="package-section limits">
          <h${packageHeadingLevel}>Limits</h${packageHeadingLevel}>${renderCapabilities(capabilities)}
          <div class="limit-columns">
            <div><h${limitsHeadingLevel}>Rules</h${limitsHeadingLevel}>${renderStringList(agentInput.constraints)}</div>
            <div><h${limitsHeadingLevel}>Not allowed</h${limitsHeadingLevel}>${renderStringList(agentInput.prohibited_effects)}</div>
          </div>
        </section>`
    : "";
  const humanSections = [
    purposeSection,
    renderRequirementReferences(bindings, requirementAnchors, packageHeadingLevel),
    declarationsSection,
    renderFileInputs(bindings, acceptedInputs, packageHeadingLevel),
    skillsSection,
    limitsSection
  ].filter((section) => section.length > 0).join("\n\n");
  return `
    <details class="file-package" id="${escapeHtml(fileAnchor)}" name="slice-${sliceIndex + 1}-files">
      <summary>
        <div class="file-summary-main">
          <h${fileHeadingLevel} class="file-name"><code>${escapeHtml(capsule.target_path)}</code></h${fileHeadingLevel}>
          <p class="file-purpose">${escapeHtml(objective)}</p>
          <p class="file-context-preview"><span class="context-preview-label">Receives</span>${contextLabels.map((label) => `<code>${escapeHtml(label)}</code>`).join("")}</p>
        </div>
        <span class="file-operation">${escapeHtml(operation)}</span>
      </summary>
      <div class="file-package-content">
${humanSections}

        <details class="raw-input">
          <summary><span><strong>Machine evidence</strong> · Exact Agent Input JSON</span><span>${escapeHtml(capsule.agent_input_digest)}</span></summary>
          <pre><code>${escapeHtml(prettyJson(capsule.agent_input))}</code></pre>
        </details>
      </div>
    </details>`;
}

function renderDigestRows(snapshot: RenderableReviewSnapshot): string {
  const topRows = [
    ["Plan Manifest", snapshot.digest_set.manifest.protocol_id, snapshot.digest_set.manifest.content_digest],
    ["Compilation Report", snapshot.digest_set.compilation_report.protocol_id, snapshot.digest_set.compilation_report.content_digest],
    ["Reviewed work", snapshot.digest_set.pass.protocol_id, snapshot.digest_set.pass.content_digest]
  ];
  const payloadRows = snapshot.digest_set.payloads.map((payload) => [
    payload.target_path,
    payload.payload_id,
    payload.payload_digest
  ]);
  return [...topRows, ...payloadRows]
    .map(
      ([label, id, digest]) => `
        <tr>
          <th scope="row">${escapeHtml(label)}</th>
          <td><code>${escapeHtml(id)}</code></td>
          <td><code>${escapeHtml(digest)}</code></td>
        </tr>`
    )
    .join("");
}

export function renderPublicationReviewHtml(
  snapshot: RenderableReviewSnapshot,
  options: PublicationReviewRenderOptions = {}
): string {
  const reviewKind = options.reviewKind ?? "plan";
  const reviewKindLabel = reviewKind === "change"
    ? "Change"
    : reviewKind === "slice"
      ? "Slice"
      : "Plan";
  const reviewKindNoun = reviewKind === "plan" ? "plan" : reviewKindLabel;
  const blockers = snapshot.publication_gate.blockers;
  const warnings = snapshot.publication_gate.warnings;
  const gaps = snapshot.publication_gate.compilation_gaps;
  const hasFindings = blockers.length + warnings.length + gaps.length > 0;
  const fileCount = snapshot.passes.reduce((count, pass) => count + pass.capsules.length, 0);
  const sliceCount = snapshot.passes.length;
  const operationCounts = snapshot.passes
    .flatMap((pass) => pass.capsules)
    .reduce(
      (counts, capsule) => ({ ...counts, [capsule.operation]: (counts[capsule.operation] ?? 0) + 1 }),
      {} as Record<string, number>
    );
  const operationSummary = [
    operationCounts.create ? `${operationCounts.create} new` : "",
    operationCounts.replace ? `${operationCounts.replace} modified` : "",
    operationCounts.delete ? `${operationCounts.delete} deleted` : ""
  ].filter((value) => value.length > 0).join(" · ");
  const formattedCreatedAt = snapshot.created_at.replace("T", " ").replace(".000Z", " UTC");
  const provenance = asRecord(snapshot.compiler_submission);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>SCORE ${reviewKindLabel} Review — ${escapeHtml(snapshot.manifest.label)}</title>
  <style>
    :root {
      --bg: oklch(1 0 0);
      --surface: oklch(0.975 0 0);
      --surface-strong: oklch(0.945 0.008 18);
      --ink: oklch(0.20 0.015 18);
      --muted: oklch(0.44 0.018 18);
      --line: oklch(0.87 0.008 18);
      --primary: oklch(0.55 0.20 18);
      --accent: oklch(0.39 0.12 245);
      --accent-soft: oklch(0.94 0.025 245);
      --warning: oklch(0.48 0.12 74);
      --warning-soft: oklch(0.96 0.045 74);
      --danger: oklch(0.48 0.17 24);
      --danger-soft: oklch(0.95 0.04 24);
      --success: oklch(0.42 0.12 150);
      --content: 960px;
    }

    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 16px;
      line-height: 1.55;
      overflow-wrap: anywhere;
    }
    a { color: var(--accent); text-underline-offset: 0.18em; }
    a:focus-visible, summary:focus-visible { outline: 3px solid var(--primary); outline-offset: 3px; }
    h1, h2, h3, h4, h5, h6, p { margin-top: 0; }
    h1, h2, h3 { text-wrap: balance; }
    h1 { margin-bottom: 0.75rem; font-size: 2.25rem; line-height: 1.1; letter-spacing: -0.03em; }
    h2 { margin-bottom: 0.7rem; font-size: 1.45rem; line-height: 1.2; letter-spacing: -0.02em; }
    h3 { margin-bottom: 0.65rem; font-size: 1.08rem; line-height: 1.35; }
    h4 { margin-bottom: 0.5rem; font-size: 0.92rem; }
    h5, h6 { margin-bottom: 0.45rem; font-size: 0.86rem; }
    p { max-width: 72ch; text-wrap: pretty; }
    code, pre { font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace; }
    code { overflow-wrap: anywhere; }
    pre {
      margin: 0.75rem 0 1rem;
      padding: 1rem;
      overflow: auto;
      border-radius: 8px;
      background: oklch(0.22 0.012 245);
      color: oklch(0.96 0.004 245);
      font-size: 0.82rem;
      line-height: 1.55;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    ul, ol { margin: 0.5rem 0 0; padding-left: 1.25rem; }
    li + li { margin-top: 0.38rem; }
    blockquote { margin: 1rem 0; padding-left: 1rem; border-left: 1px solid var(--line); color: var(--muted); }
    hr { margin: 1.5rem 0; border: 0; border-top: 1px solid var(--line); }

    .shell { width: min(calc(100% - 2rem), var(--content)); margin: 0 auto; }
    .topbar { border-bottom: 1px solid var(--line); color: var(--muted); font-size: 0.84rem; }
    .topbar .shell { display: flex; align-items: center; justify-content: space-between; gap: 1rem; min-height: 56px; }
    .topbar .shell > *, .slice-header > *, .accepted-input > summary > *, .requirement-list > li > *, .package-section > *, .input-usage li > *, .file-package > summary > * { min-width: 0; }
    .product-name { color: var(--ink); font-weight: 720; letter-spacing: -0.015em; }

    .hero { padding: 4rem 0 3rem; }
    .lede { margin-bottom: 0; color: var(--muted); font-size: 1.08rem; }
    .plan-shape { margin-top: 1.5rem; padding-top: 1.25rem; border-top: 1px solid var(--line); }
    .plan-shape p { margin-bottom: 0; }
    .change-count { font-size: 1.18rem; }
    .change-breakdown { margin-top: 0.2rem; color: var(--ink); font-size: 0.94rem; }
    .approval-note { margin-top: 0.55rem; color: var(--muted); font-size: 0.86rem; }
    .approval-ready { display: grid; grid-template-columns: minmax(150px, 0.3fr) minmax(0, 1fr); gap: 1.5rem; margin-top: 1.5rem; padding: 1.1rem 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
    .approval-ready strong { color: var(--success); font-size: 1.02rem; }
    .approval-ready p { margin: 0; }
    .muted { color: var(--muted); }
    .empty { margin-bottom: 0; color: var(--muted); }

    .issues { padding: 2rem 0; border-top: 1px solid var(--line); }
    .finding-group { margin-top: 1rem; padding: 1rem; border-radius: 8px; }
    .finding-group.blockers, .finding-group.gaps { background: var(--danger-soft); color: var(--danger); }
    .finding-group.warnings { background: var(--warning-soft); color: var(--warning); }

    .slice { padding: 3rem 0 4rem; border-top: 1px solid var(--line); }
    .slice-header { display: flex; align-items: start; justify-content: space-between; gap: 2rem; margin-bottom: 2.25rem; }
    .slice-header p { margin-bottom: 0; color: var(--muted); }
    .slice-overview { margin-bottom: 2.5rem; }
    .section-help { margin-bottom: 1rem; color: var(--muted); font-size: 0.9rem; }
    .accepted-input-list { border-top: 1px solid var(--line); }
    .accepted-input { border-bottom: 1px solid var(--line); scroll-margin-top: 1rem; }
    .accepted-input > summary {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto 1.25rem;
      align-items: center;
      gap: 1rem;
      padding: 0.9rem 0;
    }
    .accepted-input > summary::after {
      content: "+";
      grid-column: 3;
      grid-row: 1;
      color: var(--muted);
      font-size: 1.15rem;
      text-align: center;
    }
    .accepted-input[open] > summary::after { content: "−"; }
    .context-source-title { display: grid; gap: 0.1rem; margin: 0; }
    .context-source-title code { color: var(--muted); font-size: 0.75rem; font-weight: 500; }
    .context-recipients { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: start; gap: 0.5rem; color: var(--muted); font-size: 0.78rem; }
    .context-recipient-files { display: grid; gap: 0.12rem; }
    .context-recipients code { color: inherit; }
    .context-recipient-label { color: var(--ink); font-weight: 680; }
    .accepted-input-content { padding: 0.75rem 0 1.75rem; }
    .accepted-document { max-width: 78ch; }
    .accepted-document h4, .accepted-document h5, .accepted-document h6 { margin-top: 1.4rem; }
    .accepted-document h4:first-child { margin-top: 0; font-size: 1.15rem; }
    .accepted-document p, .accepted-document ul, .accepted-document ol { margin-bottom: 1rem; }
    .accepted-document li > ul, .accepted-document li > ol { margin-bottom: 0; }
    .document-code { white-space: pre; }
    .input-usage { margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--line); }
    .input-usage-label { margin-bottom: 0.65rem; }
    .input-usage ul { list-style: none; padding: 0; }
    .input-usage li { display: grid; grid-template-columns: minmax(180px, 0.5fr) minmax(0, 1fr); gap: 1rem; }
    .input-usage li span { color: var(--muted); font-size: 0.86rem; }

    .requirement-list { margin: 0; padding: 0; border-top: 1px solid var(--line); list-style: none; }
    .requirement-list > li { display: grid; grid-template-columns: minmax(0, 1fr) minmax(220px, 0.55fr); gap: 2rem; padding: 1rem 0; border-bottom: 1px solid var(--line); scroll-margin-top: 1rem; }
    .requirement-copy { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: start; gap: 0.75rem; }
    .requirement-copy p { margin: 0; }
    .requirement-id { display: inline-block; padding: 0.1rem 0.38rem; border-radius: 4px; background: var(--accent-soft); color: var(--accent); font-family: "SFMono-Regular", Consolas, monospace; font-size: 0.72rem; font-weight: 720; }
    .coverage-files { margin: 0; padding: 0; list-style: none; color: var(--muted); font-size: 0.82rem; }
    .coverage-files li + li { margin-top: 0.2rem; }
    .coverage-files a { color: inherit; text-decoration: none; }
    .coverage-files a:hover { color: var(--accent); text-decoration: underline; }
    .files-heading { margin-bottom: 0.2rem; }
    .files-help { margin-bottom: 1rem; color: var(--muted); font-size: 0.9rem; }
    .file-map-scroll { overflow-x: auto; }
    .file-map { width: 100%; min-width: 720px; border-collapse: collapse; font-size: 0.84rem; }
    .file-map th, .file-map td { padding: 0.85rem 0.7rem; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
    .file-map thead th { color: var(--muted); font-size: 0.74rem; font-weight: 680; text-transform: uppercase; letter-spacing: 0.04em; }
    .file-map tbody th { width: 22%; font-weight: 650; }
    .file-map td:nth-child(2) { width: 10%; }
    .file-map td:nth-child(3) { width: 30%; }
    .file-map a { color: inherit; text-decoration: none; }
    .file-map a:hover { color: var(--accent); text-decoration: underline; }
    .file-map-uses { display: grid; gap: 0.4rem; margin: 0; padding: 0; list-style: none; }
    .file-map-uses li { display: grid; gap: 0.1rem; }
    .file-map-uses li + li { margin-top: 0; }
    .file-map-uses span { color: var(--muted); font-size: 0.78rem; }

    summary { cursor: pointer; list-style: none; }
    summary::-webkit-details-marker { display: none; }
    .file-package { border-top: 1px solid var(--line); }
    .file-package:last-child { border-bottom: 1px solid var(--line); }
    .file-package > summary { display: grid; grid-template-columns: minmax(0, 1fr) auto 1.25rem; align-items: start; gap: 1rem; padding: 1.15rem 0; }
    .file-package > summary::after { content: "+"; color: var(--muted); font-size: 1.25rem; line-height: 1; text-align: center; }
    .file-package[open] > summary::after { content: "−"; }
    .file-package[open] > summary .file-name { color: var(--accent); }
    .file-summary-main { display: grid; gap: 0.28rem; }
    .file-name { min-width: 0; margin: 0; font-size: 0.98rem; font-weight: 720; }
    .file-name code { overflow-wrap: anywhere; }
    .file-purpose { margin: 0; color: var(--muted); font-size: 0.86rem; }
    .file-context-preview { display: flex; flex-wrap: wrap; gap: 0.1rem 0.5rem; margin: 0; color: var(--muted); font-size: 0.76rem; }
    .context-preview-label { color: var(--ink); font-weight: 680; }
    .file-context-preview code { color: inherit; }
    .file-context-preview code + code::before { content: "·"; margin-right: 0.5rem; color: var(--line); }
    .file-operation { padding-top: 0.05rem; color: var(--muted); font-size: 0.82rem; }
    .file-package-content { padding: 0.5rem 0 2.5rem; }
    .package-section { display: grid; grid-template-columns: 120px minmax(0, 1fr); gap: 2rem; padding: 1.5rem 0; border-top: 1px solid var(--line); }
    .package-section > h3, .package-section > h4, .package-section > h5 { margin: 0; }
    .package-section > p:last-child { margin-bottom: 0; }
    .purpose > div > p:last-child { margin-bottom: 0; }
    .prompt-outcome { color: var(--muted); }
    .requirement-references { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 0; padding: 0; list-style: none; }
    .requirement-references li { margin: 0; }
    .requirement-references a { display: flex; align-items: start; gap: 0.5rem; padding: 0.35rem 0.5rem; border: 1px solid var(--line); border-radius: 6px; color: var(--muted); font-size: 0.8rem; text-decoration: none; }
    .requirement-references a:hover { border-color: var(--accent); color: var(--accent); }
    .context-items { min-width: 0; }
    .input-references { margin: 0 0 1.25rem; padding: 0; list-style: none; }
    .input-references > li { padding: 0.75rem 0; border-bottom: 1px solid var(--line); }
    .input-references > li:first-child { border-top: 1px solid var(--line); }
    .input-references a { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; text-decoration: none; }
    .input-references a code { color: var(--muted); font-size: 0.75rem; }
    .input-references p { margin: 0.35rem 0 0; color: var(--muted); font-size: 0.86rem; }
    .context-item { border-bottom: 1px solid var(--line); }
    .context-item:first-child { border-top: 1px solid var(--line); }
    .context-item > summary { display: flex; justify-content: space-between; gap: 1rem; padding: 0.75rem 0; font-weight: 680; }
    .context-item > summary::before { content: "+"; width: 1rem; color: var(--muted); font-weight: 500; }
    .context-item[open] > summary::before { content: "−"; }
    .context-item > summary > span:first-child { flex: 1; }
    .context-kind { color: var(--muted); font-size: 0.76rem; font-weight: 500; }
    .context-content { padding: 0.25rem 0 1rem 2rem; }
    .context-content > p { color: var(--muted); font-size: 0.88rem; }
    .skill p { color: var(--muted); font-size: 0.88rem; }
    .access { margin-bottom: 1.25rem; }
    .access p { margin-bottom: 0.35rem; font-size: 0.88rem; }
    .limit-columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2rem; }
    .limits > .limit-columns { grid-column: 2; }
    .limit-columns h4, .limit-columns h5, .limit-columns h6 { margin-top: 0; }
    .raw-input { grid-column: 1 / -1; margin-top: 0.5rem; border-top: 1px solid var(--line); }
    .raw-input > summary { display: flex; justify-content: space-between; gap: 1rem; padding: 0.9rem 0; color: var(--muted); font-size: 0.78rem; }
    .raw-input > summary span:last-child { font-family: "SFMono-Regular", Consolas, monospace; font-size: 0.68rem; overflow-wrap: anywhere; }

    .binding-table { width: 100%; border-collapse: collapse; font-size: 0.78rem; }
    .binding-table th, .binding-table td { padding: 0.8rem; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
    .binding-table th { width: 18%; }
    .binding-table td { overflow-wrap: anywhere; }
    .verification-wrap { padding: 0 0 3rem; border-top: 1px solid var(--line); }
    .verification > summary { display: flex; justify-content: space-between; gap: 1rem; padding: 1.25rem 0; font-weight: 720; }
    .verification > summary::after { content: "+"; }
    .verification[open] > summary::after { content: "−"; }
    .verification-content { padding: 0 0 1.5rem; }
    .verification-content section { padding: 1.5rem 0; border-top: 1px solid var(--line); }
    .phase-summary { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.35rem 0.75rem; margin-bottom: 0.45rem; }
    .phase-summary strong { font-size: 1.05rem; }
    .phase-summary .passed { color: var(--success); }
    .phase-summary span { color: var(--muted); font-size: 0.86rem; }
    .phase-description { margin-bottom: 0.35rem; }
    .phase-boundary { margin-bottom: 0; color: var(--muted); font-size: 0.88rem; }
    .implementation-checks { max-width: 620px; margin: 1rem 0; padding: 0; border-top: 1px solid var(--line); list-style: none; }
    .implementation-checks li { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; padding: 0.7rem 0; border-bottom: 1px solid var(--line); }
    .implementation-checks li + li { margin-top: 0; }
    .implementation-checks strong { color: var(--muted); font-size: 0.82rem; }
    .verification-meta { display: grid; gap: 0.65rem; margin: 0; }
    .verification-meta div { display: grid; grid-template-columns: 130px minmax(0, 1fr); gap: 1rem; }
    .verification-meta dt { color: var(--muted); }
    .verification-meta dd { margin: 0; overflow-wrap: anywhere; }
    .audit-links { display: flex; flex-wrap: wrap; gap: 0.85rem 1.25rem; }

    .footer { padding: 2rem 0 3rem; border-top: 1px solid var(--line); color: var(--muted); font-size: 0.82rem; }

    @media (max-width: 760px) {
      h1 { font-size: 2rem; }
      .hero { padding: 3rem 0 2.5rem; }
      .slice-header { display: grid; gap: 0.75rem; }
      .approval-ready { grid-template-columns: 1fr; gap: 0.35rem; }
      .requirement-list > li { grid-template-columns: 1fr; gap: 0.75rem; }
      .input-usage li { grid-template-columns: 1fr; gap: 0.2rem; }
      .accepted-input > summary { grid-template-columns: minmax(0, 1fr) 1.25rem; gap: 0.35rem 0.75rem; }
      .accepted-input > summary::after { grid-column: 2; grid-row: 1; }
      .context-recipients { grid-column: 1 / -1; grid-row: 2; justify-content: start; }
      .file-package > summary { gap: 0.6rem; }
      .package-section { grid-template-columns: 1fr; gap: 0.75rem; }
      .input-references a { display: grid; gap: 0.2rem; }
      .limit-columns { grid-template-columns: 1fr; gap: 1rem; }
      .limits > .limit-columns { grid-column: 1; }
      .raw-input > summary span:last-child { display: none; }
      .binding-table { display: block; overflow-x: auto; }
      .implementation-checks li { align-items: start; }
      .verification-meta div { grid-template-columns: 1fr; gap: 0.15rem; }
    }

    @media (prefers-reduced-motion: reduce) {
      html { scroll-behavior: auto; }
    }

    @media print {
      .shell { width: 100%; }
      .topbar { display: none; }
      .hero, .slice { padding: 1.5rem 0; }
      .file-package { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <header class="topbar">
    <div class="shell">
      <span class="product-name">SCORE ${reviewKindLabel} Review</span>
      <span>No decision recorded</span>
    </div>
  </header>

  <main>
    <section class="hero">
      <div class="shell">
        <h1>${escapeHtml(snapshot.manifest.label)}</h1>
        <p class="lede">${escapeHtml(snapshot.manifest.objective)}</p>
        <div class="plan-shape" aria-label="${reviewKindLabel} scope">
          <p class="change-count"><strong>${fileCount} ${fileCount === 1 ? "file" : "files"} will change</strong></p>
          <p class="change-breakdown">${escapeHtml(operationSummary)}${operationSummary ? " · " : ""}${fileCount} isolated file-${fileCount === 1 ? "agent" : "agents"}</p>
          <p class="approval-note">Approval freezes these instructions. It does not run them.</p>
        </div>
${reviewKind === "plan" ? "" : `        <div class="approval-ready" aria-labelledby="approval-ready-title">
          <strong id="approval-ready-title">Ready for approval</strong>
          <p>Review the files below. When you are satisfied, return to the terminal and run <code>score start</code>. SCORE will ask for the model, reasoning, and final approval before anything runs.</p>
        </div>`}
      </div>
    </section>

${
      hasFindings
        ? `<section class="issues" aria-labelledby="issues-title">
      <div class="shell">
        <h2 id="issues-title">Issues</h2>
        ${renderFindings("Blockers", blockers, "blockers")}
        ${renderFindings("Warnings", warnings, "warnings")}
        ${renderFindings("Compilation gaps", gaps, "gaps")}
      </div>
    </section>`
        : ""
    }

${snapshot.passes
      .map((pass, sliceIndex) => {
        const sliceHeading = `Work group ${sliceIndex + 1}: ${sliceTitle(pass)}`;
        const acceptedInputs = collectAcceptedInputs(pass, sliceIndex);
        const requirementCoverage = collectRequirementCoverage(
          snapshot.requirements.map(asRecord),
          pass,
          sliceIndex
        );
        const requirementAnchors = new Map(
          requirementCoverage.map((item) => [item.label, item.anchor])
        );
        const orderedCapsules = dependencyFirstCapsules(pass);
        const ownerPaths = declarationOwnerPaths(pass);
        const distinctSliceObjective = pass.objective !== snapshot.manifest.objective;
        const multipleSlices = sliceCount > 1;
        const sectionHeadingLevel = multipleSlices ? 3 : 2;
        const fileHeadingLevel = multipleSlices ? 4 : 3;
        const packageHeadingLevel = multipleSlices ? 5 : 4;
        const wrapperStart = multipleSlices
          ? `<section class="slice" aria-labelledby="slice-${sliceIndex + 1}-title">`
          : '<div class="slice">';
        const wrapperEnd = multipleSlices ? "</section>" : "</div>";
        const sliceHeader = multipleSlices
          ? `<header class="slice-header">
          <div>
            <h2 id="slice-${sliceIndex + 1}-title">${escapeHtml(sliceHeading)}</h2>
            ${distinctSliceObjective ? `<p>${escapeHtml(pass.objective)}</p>` : ""}
          </div>
        </header>`
          : "";
        return `${wrapperStart}
      <div class="shell">
${sliceHeader}
        ${renderFileRelationshipMap(pass, orderedCapsules, ownerPaths, sliceIndex, sectionHeadingLevel)}
        <section class="files slice-overview" aria-labelledby="files-${escapeHtml(pass.pass_id)}">
          <h${sectionHeadingLevel} id="files-${escapeHtml(pass.pass_id)}" class="files-heading">Files to change</h${sectionHeadingLevel}>
          <p class="files-help">One isolated agent handles each file. Open a row for its complete instructions.</p>
${orderedCapsules.map((capsule) => renderCapsule(capsule, sliceIndex, acceptedInputs, requirementAnchors, ownerPaths.get(capsule.capsule_id) ?? new Map(), fileHeadingLevel, packageHeadingLevel)).join("")}
        </section>
        ${renderRequirementCoverage(requirementCoverage, pass, sliceIndex, sectionHeadingLevel)}
        ${renderAcceptedInputs(pass, acceptedInputs, sectionHeadingLevel)}
      </div>
    ${wrapperEnd}`;
      })
      .join("")}

    <section class="verification-wrap">
      <div class="shell">
        <details class="verification">
          <summary>${reviewKindLabel} validation and audit</summary>
          <div class="verification-content">
            <section aria-labelledby="plan-validation-status">
              <h3 id="plan-validation-status">${reviewKindLabel} validation</h3>
              <p class="phase-summary"><strong class="passed">Passed</strong><span>${snapshot.publication_gate.publication_validation.finding_count} ${reviewKindNoun} ${snapshot.publication_gate.publication_validation.finding_count === 1 ? "finding" : "findings"}</span></p>
              <p class="phase-description">The ${reviewKindNoun} is complete and internally consistent. It is ready for approval.</p>
              <p class="phase-boundary">This validates the ${reviewKindNoun} only. It does not test an implementation.</p>
            </section>
            <section aria-labelledby="implementation-status">
              <h3 id="implementation-status">Implementation status</h3>
              <p class="phase-summary"><strong>Not started</strong></p>
              <p class="phase-description">No candidates have been generated or applied from this ${reviewKindNoun}.</p>
              <p class="phase-boundary">Implementation quality is evaluated outside SCORE.</p>
            </section>
            <section>
              <h3>Review record</h3>
              <dl class="verification-meta">
                <div><dt>Decision</dt><dd>No decision recorded</dd></div>
                <div><dt>Review ID</dt><dd><code>${escapeHtml(snapshot.review_id)}</code></dd></div>
                <div><dt>Created</dt><dd><time datetime="${escapeHtml(snapshot.created_at)}">${escapeHtml(formattedCreatedAt)}</time></dd></div>
                <div><dt>Renderer</dt><dd><code>${escapeHtml(PUBLICATION_REVIEW_RENDERER.id)} @ ${escapeHtml(PUBLICATION_REVIEW_RENDERER.version)}</code></dd></div>
              </dl>
            </section>
            <section>
              <h3>Approval binding</h3>
              <div role="region" aria-label="Approval binding digests" tabindex="0">
                <table class="binding-table">
                  <thead><tr><th>Object</th><th>Protocol ID</th><th>Content digest</th></tr></thead>
                  <tbody>${renderDigestRows(snapshot)}</tbody>
                </table>
              </div>
            </section>
            <section>
              <h3>${reviewKindLabel} checks performed</h3>
              ${renderStringList(snapshot.publication_gate.publication_validation.checks)}
            </section>
            <section>
              <h3>Plan compiler</h3>
              <p>Compiled by <strong>${escapeHtml(stringValue(provenance.compiler_name))}</strong> using <code>${escapeHtml(stringValue(provenance.model_id))}</code>.</p>
              <p class="muted">Submission <code>${escapeHtml(stringValue(provenance.submission_id))}</code> · Compiled plan <code>${escapeHtml(stringValue(provenance.bundle_digest))}</code></p>
            </section>
            <section>
              <h3>Audit files</h3>
              <nav class="audit-links" aria-label="Machine evidence files">
                <a href="${escapeHtml(options.snapshotHref ?? "./publication-review.snapshot.json")}">Structured review snapshot</a>
                ${options.includeProofLinks === false ? "" : `<a href="./digest-set.json">Exact digest set</a>
                <a href="./inspection.json">SQLite inspection views</a>
                <a href="./evidence.json">Reproduction evidence</a>`}
              </nav>
            </section>
          </div>
        </details>
      </div>
    </section>
  </main>

  <footer class="footer">
    <div class="shell">Generated deterministically by SCORE. No LLM wrote or rewrote this page.</div>
  </footer>
  <script>
    (() => {
      let printState = null;

      window.addEventListener("beforeprint", () => {
        if (printState !== null) return;
        printState = Array.from(document.querySelectorAll("details"), (details) => ({
          details,
          open: details.open,
          name: details.getAttribute("name")
        }));
        for (const item of printState) item.details.removeAttribute("name");
        for (const item of printState) item.details.open = true;
      });

      window.addEventListener("afterprint", () => {
        if (printState === null) return;
        for (const item of printState) item.details.open = item.open;
        for (const item of printState) {
          if (item.name === null) item.details.removeAttribute("name");
          else item.details.setAttribute("name", item.name);
        }
        printState = null;
      });
    })();
  </script>
</body>
</html>`;
}
