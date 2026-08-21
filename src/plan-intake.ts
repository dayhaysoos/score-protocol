import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  statSync
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

import { sha256Bytes, sha256Json } from "./canonical.js";
import type { AcceptedInputPacket } from "./compiler-input.js";
import {
  prepareExternalDeclarationEvidence,
  type ExternalDeclarationEvidenceBundle
} from "./external-declaration-evidence.js";
import {
  installGitLocalExclude,
  publishReviewArtifacts,
  ReviewArtifactConflictError,
  ReviewArtifactPublishError
} from "./plan-intake-filesystem.js";
import {
  prepareProjectScoreState,
  secureSqliteSidecars
} from "./private-state-filesystem.js";
import { normalizeProjectRelativePath } from "./project-path.js";
import {
  compareRepositoryPaths,
  repositoryRevisionContentDigest
} from "./repository-source-state.js";
import { ScoreAlpha } from "./score-alpha.js";
import {
  validateSliceDraftShape,
  type ResolvedSliceDependency,
  type SliceDraft,
  type SliceFileDraft,
  type SliceFinding
} from "./slice-draft.js";
import type { CompilationBundle } from "./types.js";

export type { DeclarationDraft, SliceDraft, SliceFinding } from "./slice-draft.js";
export { SLICE_DRAFT_SCHEMA } from "./slice-draft.js";
export { ReviewArtifactConflictError, ReviewArtifactPublishError };

export const SCORE_START_NEXT_ACTION = {
  command: "score start",
  condition: "after_review"
} as const;

export type PrepareSliceResult =
  | { readonly status: "invalid"; readonly findings: ReadonlyArray<SliceFinding> }
  | {
      readonly status: "review_ready";
      readonly sliceId: string;
      readonly title: string;
      readonly revision: number;
      readonly passId: string;
      readonly reviewPath: string;
      readonly snapshotPath: string;
      readonly nextAction: typeof SCORE_START_NEXT_ACTION;
    };

const PLAN_INTAKE_PROCEDURE_ID = "cd54a061-2e17-4cf5-9dc9-919978572f22";
const PLAN_INTAKE_PROCEDURE =
  "Deterministically validate one SliceDraft and expand its exact textual context and reviewed declaration routes into SCORE Coding Profile objects.";

interface CapturedFile {
  readonly path: string;
  readonly media_type: string;
  readonly content: string;
  readonly content_digest: string;
}

interface ResolvedSkill {
  readonly name: string;
  readonly source: { readonly kind: "path" | "inline"; readonly locator: string };
  readonly content: string;
  readonly contentDigest: string;
}

interface PreparedFile {
  readonly draft: SliceFileDraft;
  readonly target?: CapturedFile;
  readonly context: ReadonlyArray<{ readonly entry: SliceFileDraft["context"][number]; readonly file: CapturedFile }>;
  readonly skills: ReadonlyArray<ResolvedSkill>;
  readonly externalEvidence?: ExternalDeclarationEvidenceBundle;
}

interface CompiledSlice {
  readonly inputs: AcceptedInputPacket;
  readonly bundle: CompilationBundle;
  readonly slug: string;
  readonly preparationDigest: string;
}

function normalizedDraft(draft: SliceDraft): SliceDraft {
  return {
    ...draft,
    ...(draft.after === undefined ? {} : { after: [...draft.after].toSorted() })
  };
}

export function sliceDraftDigest(draft: SliceDraft): string {
  return sha256Json({
    schema: "score.slice-draft",
    version: "4.0.0",
    draft: normalizedDraft(draft)
  });
}

function normalizedResolvedDependencies(
  dependencies: ReadonlyArray<ResolvedSliceDependency>
): ReadonlyArray<ResolvedSliceDependency> {
  return [...dependencies].toSorted((left, right) =>
    left.slice_id.localeCompare(right.slice_id)
  );
}

function validateResolvedDependencies(
  draft: SliceDraft,
  dependencies: ReadonlyArray<ResolvedSliceDependency>
): ReadonlyArray<SliceFinding> {
  const expected = [...(draft.after ?? [])].toSorted();
  const actual = normalizedResolvedDependencies(dependencies);
  const findings: SliceFinding[] = [];
  const seen = new Set<string>();

  actual.forEach((dependency, index) => {
    if (seen.has(dependency.slice_id)) {
      findings.push(
        finding(
          "SLICE_DEPENDENCY_RESOLUTION_DUPLICATE",
          `/resolvedDependencies/${index}`,
          `Slice dependency ${dependency.slice_id} was resolved more than once`,
          { slice_id: dependency.slice_id },
          false
        )
      );
    }
    seen.add(dependency.slice_id);
    if (
      dependency.revision < 1 ||
      dependency.pass_id.length === 0 ||
      dependency.run_id.length === 0
    ) {
      findings.push(
        finding(
          "SLICE_DEPENDENCY_RESOLUTION_INVALID",
          `/resolvedDependencies/${index}`,
          `Slice dependency ${dependency.slice_id} has an invalid applied revision reference`,
          { dependency },
          false
        )
      );
    }
  });

  if (
    expected.length !== actual.length ||
    expected.some((sliceId, index) => sliceId !== actual[index]?.slice_id)
  ) {
    findings.push(
      finding(
        "SLICE_DEPENDENCY_UNRESOLVED",
        "/after",
        "Every declared predecessor must resolve to an applied slice revision before preparation",
        {
          expected_slice_ids: expected,
          resolved_slice_ids: actual.map((dependency) => dependency.slice_id)
        },
        false
      )
    );
  }
  return findings;
}

function finding(
  code: string,
  location: string,
  message: string,
  detail: Readonly<Record<string, unknown>> = {},
  machineRepairable = true
): SliceFinding {
  return { code, location, message, detail, machineRepairable };
}

function invalidUnicodeLocation(value: unknown, location = ""): string | undefined {
  if (typeof value === "string") {
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(index + 1);
        if (!(next >= 0xdc00 && next <= 0xdfff)) return location || "/";
        index += 1;
      } else if (code >= 0xdc00 && code <= 0xdfff) {
        return location || "/";
      }
    }
    return undefined;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const invalid = invalidUnicodeLocation(value[index], `${location}/${index}`);
      if (invalid) return invalid;
    }
    return undefined;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      const pointerKey = key.replace(/~/gu, "~0").replace(/\//gu, "~1");
      const invalid = invalidUnicodeLocation(child, `${location}/${pointerKey}`);
      if (invalid) return invalid;
    }
  }
  return undefined;
}

function safeSlug(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 64)
    .replace(/-+$/gu, "");
  return slug.length > 0 ? slug : "slice";
}

function isScorePath(path: string): boolean {
  return path === ".score" || path.startsWith(".score/");
}

function isWithinRoot(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function projectFileMediaType(path: string): string {
  return isTypeScriptPath(path)
    ? "text/typescript; charset=utf-8"
    : "text/plain; charset=utf-8";
}

function isTypeScriptPath(path: string): boolean {
  return /\.(?:cts|mts|ts|tsx)$/u.test(path);
}

function validateExistingProjectFile(
  projectRoot: string,
  path: string,
  location: string,
  findings: SliceFinding[]
): CapturedFile | undefined {
  const absolutePath = resolve(projectRoot, path);
  try {
    const status = lstatSync(absolutePath);
    if (status.isSymbolicLink() || !status.isFile()) {
      findings.push(finding("PROJECT_FILE_NOT_REGULAR", location, `${path} must be a regular file`, { path }, false));
      return undefined;
    }
    const realPath = realpathSync(absolutePath);
    if (!isWithinRoot(projectRoot, realPath)) {
      findings.push(finding("PROJECT_PATH_ESCAPE", location, `${path} resolves outside the project root`, { path }, false));
      return undefined;
    }
    const bytes = readFileSync(realPath);
    const content = bytes.toString("utf8");
    if (!Buffer.from(content, "utf8").equals(bytes)) {
      findings.push(
        finding(
          "PROJECT_FILE_ENCODING_UNSUPPORTED",
          location,
          `${path} must contain exact round-trippable UTF-8 bytes`,
          { path },
          false
        )
      );
      return undefined;
    }
    return {
      path,
      media_type: projectFileMediaType(path),
      content,
      content_digest: sha256Bytes(bytes)
    };
  } catch (cause) {
    findings.push(
      finding(
        "PROJECT_FILE_UNREADABLE",
        location,
        `Cannot read declared project file ${path}`,
        { path, cause: cause instanceof Error ? cause.message : String(cause) },
        false
      )
    );
    return undefined;
  }
}

function validateCreateTarget(
  projectRoot: string,
  path: string,
  location: string,
  findings: SliceFinding[]
): void {
  const absolutePath = resolve(projectRoot, path);
  if (existsSync(absolutePath)) {
    findings.push(finding("CREATE_TARGET_PRESENT", location, `Create target ${path} already exists`, { path }, false));
    return;
  }
  let ancestor = dirname(absolutePath);
  while (!existsSync(ancestor)) ancestor = dirname(ancestor);
  try {
    const ancestorStatus = lstatSync(ancestor);
    if (ancestorStatus.isSymbolicLink() || !ancestorStatus.isDirectory()) {
      findings.push(
        finding(
          "CREATE_TARGET_ANCESTOR_INVALID",
          location,
          `${path} must have a real directory as its nearest existing ancestor`,
          { path, ancestor: relative(projectRoot, ancestor) || "." },
          false
        )
      );
      return;
    }
    const realAncestor = realpathSync(ancestor);
    if (!isWithinRoot(projectRoot, realAncestor)) {
      findings.push(finding("PROJECT_PATH_ESCAPE", location, `${path} has an unsafe ancestor`, { path }, false));
    }
  } catch (cause) {
    findings.push(finding("PROJECT_PATH_UNREADABLE", location, `Cannot validate create target ${path}`, { path, cause: String(cause) }, false));
  }
}

function resolveSkill(
  projectRoot: string,
  skill: SliceFileDraft["skills"][number],
  location: string,
  findings: SliceFinding[]
): ResolvedSkill | undefined {
  if (skill.content !== undefined) {
    return {
      name: skill.name,
      source: { kind: "inline", locator: "SliceDraft" },
      content: skill.content,
      contentDigest: sha256Bytes(skill.content)
    };
  }
  const path = skill.path;
  if (!path) return undefined;
  const normalizedPath = normalizeProjectRelativePath(path);
  if (!normalizedPath) {
    findings.push(
      finding(
        "SKILL_PATH_INVALID",
        location,
        `Selected skill ${skill.name} must use a canonical project-relative path`,
        { path },
        false
      )
    );
    return undefined;
  }
  const absolutePath = resolve(projectRoot, normalizedPath);
  try {
    const status = lstatSync(absolutePath);
    if (!status.isFile() || status.isSymbolicLink()) {
      findings.push(
        finding(
          "SKILL_FILE_NOT_REGULAR",
          location,
          `Selected skill ${skill.name} must be a regular file and not a symlink`,
          { path },
          false
        )
      );
      return undefined;
    }
    const realPath = realpathSync(absolutePath);
    if (realPath !== absolutePath || !isWithinRoot(projectRoot, realPath)) {
      findings.push(
        finding(
          "SKILL_PATH_INVALID",
          location,
          `Selected skill ${skill.name} must not traverse a symlink or leave the project root`,
          { path },
          false
        )
      );
      return undefined;
    }
    const bytes = readFileSync(realPath);
    const content = bytes.toString("utf8");
    if (!Buffer.from(content, "utf8").equals(bytes)) {
      findings.push(
        finding(
          "SKILL_ENCODING_UNSUPPORTED",
          location,
          `Selected skill ${skill.name} must contain exact round-trippable UTF-8 bytes`,
          { path },
          false
        )
      );
      return undefined;
    }
    return {
      name: skill.name,
      source: { kind: "path", locator: normalizedPath },
      content,
      contentDigest: sha256Bytes(bytes)
    };
  } catch (cause) {
    findings.push(
      finding(
        "SKILL_UNREADABLE",
        location,
        `Cannot read selected skill ${skill.name}`,
        { path, cause: cause instanceof Error ? cause.message : String(cause) },
        false
      )
    );
    return undefined;
  }
}

function compileSlice(
  projectRoot: string,
  draft: SliceDraft,
  resolvedDependencies: ReadonlyArray<ResolvedSliceDependency>
): CompiledSlice | SliceFinding[] {
  const findings: SliceFinding[] = [];
  const requirementSet = new Set(draft.requirements);
  const allocatedRequirements = new Set<string>();
  const targetPaths = new Set<string>();
  const capturedFiles = new Map<string, CapturedFile>();
  const passHandle = "change_plan";
  const contractHandle = "slice_contract";

  const preparedFiles: PreparedFile[] = draft.files.map((file, fileIndex) => {
    const baseLocation = `/files/${fileIndex}`;
    const normalized = normalizeProjectRelativePath(file.path);
    if (!normalized || isScorePath(file.path)) {
      findings.push(finding("TARGET_PATH_INVALID", `${baseLocation}/path`, `Invalid target path ${file.path}`, { path: file.path }, false));
    } else if (targetPaths.has(normalized)) {
      findings.push(finding("TARGET_WRITER_DUPLICATE", `${baseLocation}/path`, `${normalized} has more than one File Brief`, { path: normalized }, false));
    } else {
      targetPaths.add(normalized);
    }
    for (const requirement of file.requirements) {
      if (!requirementSet.has(requirement)) {
        findings.push(finding("FILE_REQUIREMENT_UNKNOWN", `${baseLocation}/requirements`, "File requirement is not a slice requirement", { requirement }, false));
      } else {
        allocatedRequirements.add(requirement);
      }
    }
    let target: CapturedFile | undefined;
    if (normalized && !isScorePath(normalized)) {
      if (file.operation === "modify") {
        target = validateExistingProjectFile(projectRoot, normalized, `${baseLocation}/path`, findings);
        if (target) capturedFiles.set(target.path, target);
      } else {
        validateCreateTarget(projectRoot, normalized, `${baseLocation}/path`, findings);
      }
    }
    const context = file.context.flatMap((entry, contextIndex) => {
      const contextPath = normalizeProjectRelativePath(entry.path);
      if (!contextPath || isScorePath(entry.path)) {
        findings.push(finding("CONTEXT_PATH_INVALID", `${baseLocation}/context/${contextIndex}/path`, `Invalid context path ${entry.path}`, { path: entry.path }, false));
        return [];
      }
      const captured = validateExistingProjectFile(projectRoot, contextPath, `${baseLocation}/context/${contextIndex}/path`, findings);
      if (!captured) return [];
      capturedFiles.set(captured.path, captured);
      return [{ entry, file: captured }];
    });
    const skills = file.skills.flatMap((skill, skillIndex) => {
      const resolved = resolveSkill(projectRoot, skill, `${baseLocation}/skills/${skillIndex}`, findings);
      return resolved ? [resolved] : [];
    });
    const externalRequests = file.external_declarations ?? [];
    let externalEvidence: ExternalDeclarationEvidenceBundle | undefined;
    if (externalRequests.length > 0) {
      const result = prepareExternalDeclarationEvidence({
        projectRoot,
        requests: externalRequests
      });
      if (result.status === "invalid") {
        findings.push(
          ...result.findings.map((externalFinding) => ({
            ...externalFinding,
            location: externalFinding.location.replace(
              /^\/requests/u,
              `${baseLocation}/external_declarations`
            )
          }))
        );
      } else {
        externalEvidence = result.bundle;
      }
    }
    return {
      draft: file,
      ...(target ? { target } : {}),
      context,
      skills,
      ...(externalEvidence === undefined ? {} : { externalEvidence })
    };
  });

  for (const requirement of draft.requirements) {
    if (!allocatedRequirements.has(requirement)) {
      findings.push(finding("SLICE_REQUIREMENT_UNALLOCATED", "/requirements", "Every slice requirement must be allocated to at least one file", { requirement }, false));
    }
  }

  const ownerByPathAndName = new Map<
    string,
    { fileIndex: number; declaration: SliceFileDraft["owns"][number] }
  >();
  preparedFiles.forEach((file, fileIndex) => {
    file.draft.owns.forEach((declaration, declarationIndex) => {
      const key = `${file.draft.path}\u0000${declaration.name}`;
      if (ownerByPathAndName.has(key)) {
        findings.push(finding("DECLARATION_OWNER_DUPLICATE", `/files/${fileIndex}/owns/${declarationIndex}`, "A declaration has more than one owner in the same file", { name: declaration.name, path: file.draft.path }, false));
      } else {
        ownerByPathAndName.set(key, { fileIndex, declaration });
      }
    });
  });
  preparedFiles.forEach((file, fileIndex) => {
    const consumerPairs = new Set<string>();
    file.draft.consumes.forEach((consumer, consumerIndex) => {
      const from = normalizeProjectRelativePath(consumer.from);
      if (!from || isScorePath(consumer.from)) {
        findings.push(finding("CONSUMED_OWNER_PATH_INVALID", `/files/${fileIndex}/consumes/${consumerIndex}/from`, `Invalid consumed-owner path ${consumer.from}`, { path: consumer.from }, false));
      } else if (from === file.draft.path) {
        findings.push(finding("DECLARATION_OWNER_ALSO_CONSUMER", `/files/${fileIndex}/consumes/${consumerIndex}`, "A file cannot consume its own declaration", { name: consumer.name }, false));
      } else if (!ownerByPathAndName.has(`${from}\u0000${consumer.name}`)) {
        findings.push(finding("DECLARATION_CONSUMER_UNRESOLVED", `/files/${fileIndex}/consumes/${consumerIndex}`, "Consumed declaration does not resolve to the named owner file", { name: consumer.name, from }, false));
      }
      const pair = `${from ?? consumer.from}\u0000${consumer.name}`;
      if (consumerPairs.has(pair)) {
        findings.push(finding("DECLARATION_CONSUMER_DUPLICATE", `/files/${fileIndex}/consumes/${consumerIndex}`, "A file cannot consume the same declaration more than once", { name: consumer.name, from: consumer.from }, false));
      } else {
        consumerPairs.add(pair);
      }
    });
  });

  if (findings.length > 0) return findings;

  const preparationDigest = sha256Json({
    schema: "score.slice-preparation",
    version: "4.0.0",
    slice_draft: normalizedDraft(draft),
    resolved_slice_dependencies: normalizedResolvedDependencies(resolvedDependencies),
    declared_files: [...capturedFiles.values()]
      .map(({ path, content_digest }) => ({ path, content_digest }))
      .toSorted((left, right) => compareRepositoryPaths(left.path, right.path)),
    resolved_skills: preparedFiles.map((file) =>
      file.skills.map((skill) => ({
        name: skill.name,
        source: skill.source,
        content_digest: skill.contentDigest
      }))
    ),
    external_declaration_evidence: preparedFiles.map((file) =>
      file.externalEvidence?.contentDigest ?? null
    )
  });

  const now = new Date().toISOString();
  const specificationId = randomUUID();
  const repositoryRevisionId = randomUUID();
  const compilerInputRevisionId = randomUUID();
  const acceptedRequirements = draft.requirements.map((statement, index) => {
    const requirement = { protocol_id: randomUUID(), label: `R${index + 1}`, statement };
    return { ...requirement, content_digest: sha256Json(requirement) };
  });
  const specificationContent = {
    slice_id: draft.slice_id,
    after: [...(draft.after ?? [])].toSorted(),
    title: draft.title,
    objective: draft.objective,
    requirements: acceptedRequirements.map(({ protocol_id, label, statement }) => ({ protocol_id, label, statement })),
    files: draft.files
  };
  const specificationDigest = sha256Json(specificationContent);
  const files = [...capturedFiles.values()].toSorted((left, right) =>
    compareRepositoryPaths(left.path, right.path)
  );
  const orderedManifest = files.map(({ path, media_type, content_digest }) => ({ path, media_type, content_digest }));
  const repositoryDigest = repositoryRevisionContentDigest({ orderedManifest });
  const procedureDigest = sha256Bytes(PLAN_INTAKE_PROCEDURE);
  const compilerInputContent = {
    accepted_specification: { protocol_id: specificationId, content_digest: specificationDigest },
    repository_revision: { protocol_id: repositoryRevisionId, content_digest: repositoryDigest },
    compilation_procedure: { protocol_id: PLAN_INTAKE_PROCEDURE_ID, content_digest: procedureDigest },
    declared_absences: draft.files.filter((file) => file.operation === "create").map((file) => file.path),
    resolved_slice_dependencies: normalizedResolvedDependencies(resolvedDependencies)
  };
  const inputs: AcceptedInputPacket = {
    schema: "score.compiler-input-packet",
    version: "0.1.0-alpha.6",
    accepted_specification: {
      protocol_id: specificationId,
      authority: "human-and-existing-agent",
      accepted_at: now,
      content: specificationContent,
      content_digest: specificationDigest
    },
    accepted_requirements: acceptedRequirements,
    compilation_procedure: {
      protocol_id: PLAN_INTAKE_PROCEDURE_ID,
      name: "score-plan-intake",
      version: "3.0.0",
      profile: "score.coding@0.1.0-alpha.6",
      source: "runtime-tool-schema",
      content: PLAN_INTAKE_PROCEDURE,
      content_digest: procedureDigest
    },
    repository_revision: {
      protocol_id: repositoryRevisionId,
      label: `${safeSlug(draft.title)}-declared-inputs`,
      files,
      absent_paths: draft.files.filter((file) => file.operation === "create").map((file) => file.path).toSorted(),
      ordered_manifest: orderedManifest,
      content_digest: repositoryDigest
    },
    compiler_input_revision: {
      protocol_id: compilerInputRevisionId,
      authority: "score-plan-intake",
      accepted_at: now,
      content: compilerInputContent,
      content_digest: sha256Json(compilerInputContent)
    }
  };

  const contractInputs = [
    { handle: "input_target_state", logical_name: "target-state", required: true, expected_kind: "target_state", min_cardinality: 1, max_cardinality: 1, purpose: "Supply the exact frozen base state of the assigned target." },
    { handle: "input_requirements", logical_name: "allocated-requirements", required: true, expected_kind: "accepted_requirements", min_cardinality: 1, max_cardinality: 1, purpose: "Supply only the requirements allocated to this file." },
    { handle: "input_documented_declarations", logical_name: "documented-declarations", required: true, expected_kind: "documented_declarations", min_cardinality: 1, max_cardinality: 1, purpose: "Supply the exact documented declarations owned or consumed by this file." },
    { handle: "input_project_context", logical_name: "project-context", required: false, expected_kind: "project_context", min_cardinality: 0, max_cardinality: Math.max(1, ...preparedFiles.map((file) => file.context.length)), purpose: "Supply explicitly selected frozen project context." },
    { handle: "input_skills", logical_name: "selected-skills", required: false, expected_kind: "skill", min_cardinality: 0, max_cardinality: Math.max(1, ...preparedFiles.map((file) => file.skills.length)), purpose: "Supply exact reusable prompt text selected for this file." },
    { handle: "input_external_declarations", logical_name: "external-declaration-evidence", required: false, expected_kind: "external_declaration_evidence", min_cardinality: 0, max_cardinality: 1, purpose: "Supply exact selected contracts from locked external packages without dependency access." }
  ].map((input) => ({ ...input, contract_handle: contractHandle, version_rule: "=1.0.0" }));

  const contextItems: CompilationBundle["proposed_definition"]["context_items"] = [];
  const contextSets: CompilationBundle["proposed_definition"]["context_sets"] = [];
  const bindings: CompilationBundle["proposed_definition"]["contract_input_bindings"] = [];
  const citations: CompilationBundle["proposed_definition"]["source_citations"] = [];
  const sourceBindings: CompilationBundle["proposed_definition"]["source_bindings"] = [];
  const capsules: CompilationBundle["proposed_definition"]["capsules"] = [];
  const capabilities: CompilationBundle["proposed_definition"]["capability_requirements"] = [];

  preparedFiles.forEach((file, fileIndex) => {
    const ordinal = fileIndex + 1;
    const capsuleHandle = `file_${ordinal}`;
    const contextSetHandle = `context_set_${ordinal}`;
    const targetHandle = `target_state_${ordinal}`;
    const requirementsHandle = `requirements_${ordinal}`;
    const declarationsHandle = `documented_declarations_${ordinal}`;
    const memberHandles = [targetHandle, requirementsHandle, declarationsHandle];
    const targetContent = file.draft.operation === "create"
      ? { path: file.draft.path, state_at_base_revision: "absent" }
      : {
          path: file.draft.path,
          state_at_base_revision: "present",
          media_type: file.target?.media_type,
          content: file.target?.content
        };
    contextItems.push({
      handle: targetHandle,
      kind: "target_state",
      version: "1.0.0",
      purpose: "Freeze the assigned target state for this File Brief.",
      source: {
        kind: file.draft.operation === "create" ? "repository_absence" : "repository_file",
        locator: file.draft.path,
        version: file.target?.content_digest ?? repositoryDigest
      },
      resolution: "inline",
      content: targetContent
    });
    contextItems.push({
      handle: requirementsHandle,
      kind: "accepted_requirements",
      version: "1.0.0",
      purpose: "Supply the exact requirements allocated to this File Brief.",
      source: { kind: "accepted_specification", locator: specificationId, version: specificationDigest },
      resolution: "inline",
      content: file.draft.requirements.map((statement) => {
        const requirement = acceptedRequirements.find((candidate) => candidate.statement === statement)!;
        return { id: requirement.label, statement };
      })
    });
    contextItems.push({
      handle: declarationsHandle,
      kind: "documented_declarations",
      version: "1.0.0",
      purpose: "Supply the exact documented declarations owned or consumed by this File Brief.",
      source: {
        kind: "accepted_specification",
        locator: specificationId,
        version: specificationDigest
      },
      resolution: "inline",
      content: {
        owned: file.draft.owns.map(({ name, declaration, description }) => ({
          name,
          declaration,
          description
        })),
        consumed: file.draft.consumes.map((consumer) => {
          const from = normalizeProjectRelativePath(consumer.from)!;
          const documented = ownerByPathAndName.get(`${from}\u0000${consumer.name}`)!
            .declaration;
          return {
            name: documented.name,
            declaration: documented.declaration,
            description: documented.description,
            owner_target: from,
            module_specifier: consumer.module_specifier
          };
        })
      }
    });
    bindings.push(
      { capsule_handle: capsuleHandle, contract_input_handle: "input_target_state", context_item_handle: targetHandle, actual_kind: "target_state", actual_version: "1.0.0", position: 0 },
      { capsule_handle: capsuleHandle, contract_input_handle: "input_requirements", context_item_handle: requirementsHandle, actual_kind: "accepted_requirements", actual_version: "1.0.0", position: 0 },
      { capsule_handle: capsuleHandle, contract_input_handle: "input_documented_declarations", context_item_handle: declarationsHandle, actual_kind: "documented_declarations", actual_version: "1.0.0", position: 0 }
    );

    if (file.externalEvidence !== undefined) {
      const handle = `external_declaration_evidence_${ordinal}`;
      memberHandles.push(handle);
      contextItems.push({
        handle,
        kind: "external_declaration_evidence",
        version: "1.0.0",
        purpose: "Supply exact selected contracts from locked external packages without dependency access.",
        source: {
          kind: "locked_external_declarations",
          locator: file.externalEvidence.requests.map(({ from }) => from).join(","),
          version: file.externalEvidence.contentDigest
        },
        resolution: "inline",
        content: file.externalEvidence
      });
      bindings.push({
        capsule_handle: capsuleHandle,
        contract_input_handle: "input_external_declarations",
        context_item_handle: handle,
        actual_kind: "external_declaration_evidence",
        actual_version: "1.0.0",
        position: 0
      });
    }

    file.context.forEach(({ entry, file: contextFile }, contextIndex) => {
      const handle = `project_context_${ordinal}_${contextIndex + 1}`;
      memberHandles.push(handle);
      contextItems.push({
        handle,
        kind: "project_context",
        version: "1.0.0",
        purpose: entry.purpose,
        source: { kind: "repository_file", locator: contextFile.path, version: contextFile.content_digest },
        resolution: "inline",
        content: { path: contextFile.path, media_type: contextFile.media_type, content: contextFile.content }
      });
      bindings.push({ capsule_handle: capsuleHandle, contract_input_handle: "input_project_context", context_item_handle: handle, actual_kind: "project_context", actual_version: "1.0.0", position: contextIndex });
      const citationHandle = `citation_context_${ordinal}_${contextIndex + 1}`;
      citations.push({ handle: citationHandle, repository_revision_protocol_id: repositoryRevisionId, location: contextFile.path, source_digest: contextFile.content_digest, purpose: entry.purpose, excerpt: contextFile.content });
      sourceBindings.push(
        { citation_handle: citationHandle, target_kind: "context_item", target_handle: handle, purpose: "Bind the selected context bytes to this File Brief." },
        { citation_handle: citationHandle, target_kind: "capsule", target_handle: capsuleHandle, purpose: "Record why this source file was selected for the File Brief." }
      );
    });
    file.skills.forEach((skill, skillIndex) => {
      const handle = `skill_${ordinal}_${skillIndex + 1}`;
      memberHandles.push(handle);
      contextItems.push({
        handle,
        kind: "skill",
        version: "1.0.0",
        purpose: skill.name,
        source: { kind: `skill_${skill.source.kind}`, locator: skill.source.locator, version: skill.contentDigest },
        resolution: "inline",
        content: skill.content
      });
      bindings.push({ capsule_handle: capsuleHandle, contract_input_handle: "input_skills", context_item_handle: handle, actual_kind: "skill", actual_version: "1.0.0", position: skillIndex });
    });
    contextSets.push({ handle: contextSetHandle, member_handles: memberHandles });
    capsules.push({
      handle: capsuleHandle,
      pass_handle: passHandle,
      context_set_handle: contextSetHandle,
      target_path: file.draft.path,
      operation: file.draft.operation === "modify" ? "replace" : "create",
      objective: file.draft.task,
      intended_outcome: file.draft.task,
      constraints: [
        ...file.draft.constraints,
        ...(file.externalEvidence === undefined
          ? []
          : ["Use only the selected external declarations supplied in the external-declaration-evidence binding; do not infer unavailable package members."]),
        `Produce the complete content of ${file.draft.path}.`
      ],
      prohibited_effects: [
        "Do not read, create, modify, or delete any other file.",
        "Do not discover undeclared repository context.",
        ...(file.externalEvidence === undefined
          ? []
          : ["Do not access node_modules, package metadata, the network, or other dependency files."])
      ]
    });
    capabilities.push({
      handle: `capability_${ordinal}`,
      capsule_handle: capsuleHandle,
      capability: "score.coding.filesystem.single-target",
      version_rule: "=1.0.0",
      required: true,
      configuration: {
        target_path: file.draft.path,
        allowed_operations: file.draft.operation === "create"
          ? ["create_assigned_target"]
          : ["read_assigned_target", "replace_assigned_target"],
        shell: false,
        network: false,
        repository_discovery: false
      }
    });
    const citationHandle = `citation_target_${ordinal}`;
    citations.push({
      handle: citationHandle,
      repository_revision_protocol_id: repositoryRevisionId,
      location: file.draft.operation === "create" ? `absence:${file.draft.path}` : file.draft.path,
      source_digest: file.target?.content_digest ?? repositoryDigest,
      purpose: "Bind the declared target state to this File Brief.",
      excerpt: file.target?.content ?? `${file.draft.path} is absent.`
    });
    sourceBindings.push(
      { citation_handle: citationHandle, target_kind: "capsule", target_handle: capsuleHandle, purpose: "Establish the declared target operation against frozen state." },
      { citation_handle: citationHandle, target_kind: "context_item", target_handle: targetHandle, purpose: "Bind the exact target state supplied to the File Agent." }
    );
  });

  const dependencies: CompilationBundle["proposed_definition"]["dependencies"] = [];
  preparedFiles.forEach((file, fileIndex) => {
    file.draft.consumes.forEach((consumer, consumerIndex) => {
      const from = normalizeProjectRelativePath(consumer.from)!;
      const owner = ownerByPathAndName.get(`${from}\u0000${consumer.name}`)!;
      dependencies.push({
        handle: `dependency_${fileIndex + 1}_${consumerIndex + 1}`,
        pass_handle: passHandle,
        dependent_capsule_handle: `file_${fileIndex + 1}`,
        prerequisite_kind: "capsule",
        prerequisite_handle: `file_${owner.fileIndex + 1}`,
        description:
          `${file.draft.path} consumes ${consumer.name} from ${consumer.from} ` +
          `through ${consumer.module_specifier}.`
      });
    });
  });
  const requirementTraceability = acceptedRequirements.map((requirement) => {
    const fileIndexes = preparedFiles.flatMap((file, index) => file.draft.requirements.includes(requirement.statement) ? [index] : []);
    return {
      requirement_protocol_id: requirement.protocol_id,
      contract_handles: [contractHandle],
      capsule_handles: fileIndexes.map((index) => `file_${index + 1}`),
      dependency_handles: dependencies.filter((dependency) => fileIndexes.some((index) => dependency.dependent_capsule_handle === `file_${index + 1}`)).map((dependency) => dependency.handle),
      context_item_handles: fileIndexes.map((index) => `requirements_${index + 1}`)
    };
  });

  const bundle: CompilationBundle = {
    schema: "score.compilation-bundle",
    schema_version: "0.1.0-alpha.6",
    profile: "score.coding",
    profile_version: "0.1.0-alpha.6",
    source_bindings: {
      accepted_specification: { protocol_id: specificationId, content_digest: specificationDigest },
      repository_revision: { protocol_id: repositoryRevisionId, content_digest: repositoryDigest },
      compilation_procedure: { protocol_id: PLAN_INTAKE_PROCEDURE_ID, content_digest: procedureDigest },
      compiler_input_revision: { protocol_id: compilerInputRevisionId, content_digest: inputs.compiler_input_revision.content_digest }
    },
    proposed_definition: {
      manifest: { handle: "manifest", label: draft.title, objective: draft.objective, rationale: "Prepare the declared work as one closed File Brief per target." },
      compilation_report: { handle: "compilation_report", summary: "Every requirement is allocated to declared files with explicit target, context, documented declaration, dependency, and skill inputs." },
      contract_set: { handle: "contract_set", logical_name: `${safeSlug(draft.title)}-contracts`, version: "1.0.0", purpose: "Freeze the documented interfaces and file-level inputs for this reviewed work." },
      contracts: [{ handle: contractHandle, contract_set_handle: "contract_set", logical_name: `${safeSlug(draft.title)}-contract`, version: "1.0.0", kind: "documented-slice", content: { objective: draft.objective, requirements: draft.requirements } }],
      contract_inputs: contractInputs,
      coding_pass: { handle: passHandle, manifest_handle: "manifest", contract_set_handle: "contract_set", objective: draft.objective },
      dependencies,
      context_items: contextItems,
      context_sets: contextSets,
      capsules,
      capsule_contract_roles: preparedFiles.map((_, index) => ({ capsule_handle: `file_${index + 1}`, contract_handle: contractHandle, role: "implements" as const })),
      contract_input_bindings: bindings,
      capability_requirements: capabilities,
      requirement_traceability: requirementTraceability,
      source_citations: citations,
      source_bindings: sourceBindings
    },
    compiler_findings: { warnings: [], compilation_gaps: [] }
  };
  return { inputs, bundle, slug: safeSlug(draft.title), preparationDigest };
}

export function prepareSlice(input: {
  readonly projectRoot: string;
  readonly sliceDraft: unknown;
  readonly resolvedDependencies?: ReadonlyArray<ResolvedSliceDependency>;
  readonly sourcePath?: string;
}): PrepareSliceResult {
  const shapeFindings = validateSliceDraftShape(input.sliceDraft);
  if (shapeFindings.length > 0) return { status: "invalid", findings: shapeFindings };
  return prepareValidatedSliceDraft({
    projectRoot: input.projectRoot,
    sliceDraft: input.sliceDraft as SliceDraft,
    ...(input.resolvedDependencies === undefined
      ? {}
      : { resolvedDependencies: input.resolvedDependencies }),
    ...(input.sourcePath === undefined ? {} : { sourcePath: input.sourcePath })
  });
}

/** Internal compatibility seam for an already shape-validated authored work definition. */
export function prepareValidatedSliceDraft(input: {
  readonly projectRoot: string;
  readonly sliceDraft: SliceDraft;
  readonly resolvedDependencies?: ReadonlyArray<ResolvedSliceDependency>;
  readonly sourcePath?: string;
  readonly reviewKind?: "change" | "slice";
}): PrepareSliceResult {
  const invalidUnicode = invalidUnicodeLocation(input.sliceDraft);
  if (invalidUnicode) {
    return {
      status: "invalid",
      findings: [
        finding(
          "SLICE_UNICODE_INVALID",
          invalidUnicode,
          "Slice Draft strings must contain valid Unicode scalar values",
          {},
          true
        )
      ]
    };
  }
  let projectRoot: string;
  try {
    const candidate = realpathSync(resolve(input.projectRoot));
    if (!statSync(candidate).isDirectory()) throw new Error("project root is not a directory");
    projectRoot = candidate;
  } catch (cause) {
    return {
      status: "invalid",
      findings: [finding("PROJECT_ROOT_INVALID", "/projectRoot", "Project root must be an existing canonical directory", { cause: cause instanceof Error ? cause.message : String(cause) }, false)]
    };
  }
  const draft = input.sliceDraft;
  const resolvedDependencies = normalizedResolvedDependencies(input.resolvedDependencies ?? []);
  const dependencyFindings = validateResolvedDependencies(draft, resolvedDependencies);
  if (dependencyFindings.length > 0) {
    return { status: "invalid", findings: dependencyFindings };
  }
  const normalizedSourcePath = input.sourcePath === undefined
    ? undefined
    : normalizeProjectRelativePath(input.sourcePath);
  if (input.sourcePath !== undefined && normalizedSourcePath === undefined) {
    return {
      status: "invalid",
      findings: [
        finding(
          "SLICE_SOURCE_PATH_INVALID",
          "/sourcePath",
          "Slice source path must be project-relative",
          { path: input.sourcePath },
          false
        )
      ]
    };
  }
  const sourcePath = normalizedSourcePath ?? null;
  const compiled = compileSlice(projectRoot, draft, resolvedDependencies);
  if (Array.isArray(compiled)) return { status: "invalid", findings: compiled };

  const gitExcludeFailure = installGitLocalExclude(projectRoot);
  if (gitExcludeFailure !== undefined) {
    return { status: "invalid", findings: [gitExcludeFailure] };
  }
  const state = prepareProjectScoreState(projectRoot);
  const reviewsDirectory = state.reviewsDirectory.path;
  const score = ScoreAlpha.open(state.database.path);
  try {
    const materialized = score.materializePreparedSliceRevision({
      sliceId: draft.slice_id,
      displayTitle: draft.title,
      requestedSlug: compiled.slug,
      inputDigest: compiled.preparationDigest,
      draftDigest: sliceDraftDigest(draft),
      sourcePath,
      resolvedDependencies,
      acceptedInputs: compiled.inputs,
      bundle: compiled.bundle,
      submissionMetadata: {
        compiler_name: "score-plan-intake",
        model_id: "existing-authoring-agent",
        received_at: compiled.inputs.compiler_input_revision.accepted_at,
        label: compiled.slug
      },
      createdAt: compiled.inputs.compiler_input_revision.accepted_at,
      reviewKind: input.reviewKind ?? "slice"
    });
    if (materialized.status === "invalid") {
      return {
        status: "invalid",
        findings: materialized.submission.findings.map((item) => ({
          code: item.code,
          location: item.location,
          message: item.message,
          detail: item.detail,
          machineRepairable: item.machine_repairable
        }))
      };
    }
    const reviewPath = join(
      reviewsDirectory,
      `${materialized.revision.artifactStem}.html`
    );
    const snapshotPath = join(
      reviewsDirectory,
      `${materialized.revision.artifactStem}.snapshot.json`
    );
    publishReviewArtifacts(
      [
        { path: reviewPath, content: materialized.review.html },
        {
          path: snapshotPath,
          content: `${JSON.stringify(materialized.review.snapshot, null, 2)}\n`
        }
      ],
      state.reviewsDirectory
    );
    score.markPreparedSlicePublished({
      revision: materialized.revision,
      publishedAt: compiled.inputs.compiler_input_revision.accepted_at
    });
    const passId = materialized.review.snapshot.passes[0]?.pass_id;
    if (passId === undefined) {
      throw new Error(`Prepared slice ${draft.slice_id} has no Coding Pass`);
    }
    return {
      status: "review_ready",
      sliceId: draft.slice_id,
      title: draft.title,
      revision: materialized.revision.revision,
      passId,
      reviewPath,
      snapshotPath,
      nextAction: SCORE_START_NEXT_ACTION
    };
  } finally {
    score.close();
    secureSqliteSidecars(state.database, "SCORE database");
  }
}
