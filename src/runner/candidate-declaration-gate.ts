import { parseSync } from "oxc-parser";

import { canonicalJson, parseJsonNoDuplicateKeys, sha256Bytes, sha256Json } from "../canonical.js";
import type { CandidateDeclarationFinding } from "./domain.js";

export type FileCandidateDeclarationVerdict =
  | { readonly status: "not_applicable"; readonly findings: readonly []; readonly bindingDigest: null; readonly candidateDigest: string; readonly verdictDigest: null }
  | { readonly status: "valid"; readonly findings: readonly []; readonly bindingDigest: string; readonly candidateDigest: string; readonly verdictDigest: string }
  | { readonly status: "invalid"; readonly findings: readonly [CandidateDeclarationFinding, ...CandidateDeclarationFinding[]]; readonly bindingDigest: string | null; readonly candidateDigest: string; readonly verdictDigest: string | null };

type RecordValue = Readonly<Record<string, unknown>>;
type Entry = { readonly name: string; readonly exported: boolean; readonly shape: unknown; readonly node: RecordValue };
type Module = { readonly entries: readonly Entry[]; readonly imports: readonly RecordValue[]; readonly unsupported: boolean; readonly syntaxInvalid: boolean };

const OMIT = new Set(["start", "end", "range", "loc", "raw", "parent", "scopeId", "symbolId", "referenceId"]);
const GLOBALS = new Set(["Array", "ReadonlyArray", "Promise", "Record", "Partial", "Required", "Readonly", "Pick", "Omit", "Exclude", "Extract", "NonNullable", "Parameters", "ReturnType", "Awaited", "Map", "ReadonlyMap", "Set", "ReadonlySet", "Date", "RegExp", "Error", "URL", "NodeJS", "const"]);

function record(value: unknown): RecordValue | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as RecordValue : undefined;
}

function finding(code: string, declaration: string | null): CandidateDeclarationFinding {
  return { code, declaration, message: "Declaration candidate does not match the approved declaration contract" };
}

function invalid(candidateDigest: string, findings: CandidateDeclarationFinding[], bindingDigest: string | null = null): FileCandidateDeclarationVerdict {
  return { status: "invalid", findings: findings.length === 0 ? [finding("INVALID_INPUT", null)] : findings as [CandidateDeclarationFinding, ...CandidateDeclarationFinding[]], bindingDigest, candidateDigest, verdictDigest: null };
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  const valueRecord = record(value);
  if (valueRecord === undefined) return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(valueRecord)) if (!OMIT.has(key)) result[key] = normalize(child);
  return result;
}

function nameOf(value: unknown): string | undefined {
  const item = record(value);
  return item?.type === "Identifier" && typeof item.name === "string" ? item.name : undefined;
}

function shape(declaration: RecordValue, declarator?: RecordValue): unknown | undefined {
  const name = nameOf(declarator?.id ?? declaration.id);
  if (name === undefined) return undefined;
  switch (declaration.type) {
    case "FunctionDeclaration": case "TSDeclareFunction":
      return { kind: "function", name, async: declaration.async === true, generator: declaration.generator === true, typeParameters: normalize(declaration.typeParameters ?? null), params: normalize(declaration.params ?? []), returnType: normalize(declaration.returnType ?? null) };
    case "TSInterfaceDeclaration":
      return { kind: "interface", name, typeParameters: normalize(declaration.typeParameters ?? null), extends: normalize(declaration.extends ?? []), body: normalize(declaration.body) };
    case "TSTypeAliasDeclaration":
      return { kind: "type", name, typeParameters: normalize(declaration.typeParameters ?? null), typeAnnotation: normalize(declaration.typeAnnotation) };
    case "VariableDeclaration":
      return { kind: declaration.kind, name, typeAnnotation: normalize(record(declarator?.id)?.typeAnnotation ?? null), initializer: normalize(declarator?.init ?? null) };
    default: return undefined;
  }
}

function parseModule(source: string): Module {
  let parsed: ReturnType<typeof parseSync>;
  try { parsed = parseSync("candidate.ts", source, { lang: "ts" }); } catch { return { entries: [], imports: [], unsupported: false, syntaxInvalid: true }; }
  if (parsed.errors.length !== 0) return { entries: [], imports: [], unsupported: false, syntaxInvalid: true };
  const entries: Entry[] = [];
  const imports: RecordValue[] = [];
  let unsupported = false;
  for (const unknownStatement of parsed.program.body) {
    const statement = record(unknownStatement);
    if (statement === undefined) { unsupported = true; continue; }
    if (statement.type === "ImportDeclaration") { imports.push(normalize(statement) as RecordValue); continue; }
    let declaration = statement;
    let exported = false;
    if (statement.type === "ExportNamedDeclaration") {
      declaration = record(statement.declaration) ?? {};
      exported = true;
      if (Object.keys(declaration).length === 0) { unsupported = true; continue; }
    } else if (statement.type === "ExportDefaultDeclaration" || statement.type === "ExportAllDeclaration" || statement.type === "TSExportAssignment") { unsupported = true; continue; }
    const declarators = declaration.type === "VariableDeclaration" && Array.isArray(declaration.declarations) ? declaration.declarations : [undefined];
    let added = false;
    for (const raw of declarators) {
      const declarator = record(raw);
      const declarationShape = shape(declaration, declarator);
      const name = nameOf(declarator?.id ?? declaration.id);
      if (name !== undefined && declarationShape !== undefined) { entries.push({ name, exported, shape: declarationShape, node: declarator ?? declaration }); added = true; }
    }
    if ((exported || declaration.type?.toString().startsWith("TS") === true) && !added) unsupported = true;
  }
  return { entries, imports, unsupported, syntaxInvalid: false };
}

function references(value: unknown, names: string[] = []): readonly string[] {
  if (Array.isArray(value)) { for (const item of value) references(item, names); return names; }
  const item = record(value); if (item === undefined) return names;
  if (item.type === "TSTypeReference") { const root = nameOf(item.typeName); if (root !== undefined && !names.includes(root)) names.push(root); }
  for (const [key, child] of Object.entries(item)) if (!OMIT.has(key) && key !== "typeName" && key !== "id") references(child, names);
  return names;
}

function operationIn(root: RecordValue, target: RecordValue): "create" | "replace" | undefined {
  const outer = root.operation;
  const inner = target.operation;
  if (outer !== undefined && inner !== undefined && outer !== inner) return undefined;
  const operation = inner ?? outer;
  return operation === "create" || operation === "replace" ? operation : undefined;
}

function baselineSource(
  root: RecordValue,
  target: RecordValue,
  operation: "create" | "replace"
): string | undefined {
  if (
    operation === "create" &&
    target.state_at_base_revision === "absent" &&
    target.content === undefined
  ) {
    return "";
  }
  if (operation !== "replace") return undefined;
  if (
    target.state_at_base_revision === "present" &&
    typeof target.content === "string"
  ) {
    return target.content;
  }
  if (!Array.isArray(root.input_bindings)) return undefined;
  const targetStateBindings = root.input_bindings.filter((value) => {
    const binding = record(value);
    return binding?.kind === "target_state";
  });
  if (targetStateBindings.length !== 1) return undefined;
  const binding = record(targetStateBindings[0]);
  const content = record(binding?.content);
  return content !== undefined &&
    content.path === target.path &&
    content.state_at_base_revision === "present" &&
    typeof content.content === "string"
    ? content.content
    : undefined;
}

export function verifyFileCandidateDeclarations(input: { readonly targetPath: string; readonly operation: "create" | "replace"; readonly agentInputJson: string; readonly packageDigest: string; readonly candidateSource: string; readonly targetOutputDigest: string; }): FileCandidateDeclarationVerdict {
  const candidateDigest = sha256Bytes(Buffer.from(input.candidateSource, "utf8"));
  if (candidateDigest !== input.targetOutputDigest) return invalid(candidateDigest, [finding("TARGET_OUTPUT_DIGEST_MISMATCH", null)]);
  let root: RecordValue | undefined;
  try { root = record(parseJsonNoDuplicateKeys(input.agentInputJson)); } catch { return invalid(candidateDigest, [finding("MALFORMED_AGENT_INPUT", null)]); }
  if (root === undefined) return invalid(candidateDigest, [finding("MALFORMED_AGENT_INPUT", null)]);
  const target = record(root.target);
  const declarations = record(root.declarations);
  if (target === undefined || target.path !== input.targetPath || operationIn(root, target) !== input.operation) return invalid(candidateDigest, [finding("FROZEN_TARGET_MISMATCH", null)]);
  const baseline = baselineSource(root, target, input.operation);
  if (baseline === undefined) return invalid(candidateDigest, [finding("FROZEN_TARGET_STATE_UNSUPPORTED", null)]);
  if (root.declarations === undefined) {
    return {
      status: "not_applicable",
      findings: [],
      bindingDigest: null,
      candidateDigest,
      verdictDigest: null
    };
  }
  if (!Array.isArray(declarations?.owned)) return invalid(candidateDigest, [finding("FROZEN_DECLARATION_INPUT_UNSUPPORTED", null)]);
  if (declarations.owned.length === 0) return { status: "not_applicable", findings: [], bindingDigest: null, candidateDigest, verdictDigest: null };
  const owned: Array<{ readonly name: string; readonly declaration: string }> = [];
  const seen = new Set<string>();
  for (const item of declarations.owned) {
    const declaration = record(item);
    if (typeof declaration?.name !== "string" || typeof declaration.declaration !== "string" || seen.has(declaration.name)) return invalid(candidateDigest, [finding(seen.has(declaration?.name as string) ? "DUPLICATE_OWNED_DECLARATION" : "FROZEN_DECLARATION_INPUT_UNSUPPORTED", null)]);
    seen.add(declaration.name); owned.push({ name: declaration.name, declaration: declaration.declaration });
  }
  const bindingDigest = sha256Json({ schema: "score.file-candidate-declaration-binding", version: "1.0.0", targetPath: input.targetPath, operation: input.operation, baseDigest: sha256Bytes(Buffer.from(baseline, "utf8")), packageDigest: input.packageDigest, declarations: owned });
  const expected = parseModule(owned.map((item) => item.declaration).join("\n"));
  const candidate = parseModule(input.candidateSource);
  const findings: CandidateDeclarationFinding[] = [];
  if (expected.syntaxInvalid || expected.unsupported) findings.push(finding("APPROVED_DECLARATION_UNSUPPORTED", null));
  if (candidate.syntaxInvalid) findings.push(finding("CANDIDATE_SYNTAX_INVALID", null));
  else if (candidate.unsupported) findings.push(finding("CANDIDATE_EXPORT_FORM_UNSUPPORTED", null));
  if (findings.length === 0) {
    const expectedExports = expected.entries.filter((entry) => entry.exported);
    const candidateExports = candidate.entries.filter((entry) => entry.exported);
    for (const owner of owned) {
      const approved = expectedExports.filter((entry) => entry.name === owner.name);
      const actual = candidateExports.filter((entry) => entry.name === owner.name);
      if (approved.length !== 1) findings.push(finding("APPROVED_DECLARATION_INCOMPLETE", owner.name));
      else if (actual.length === 0) findings.push(finding("EXPECTED_EXPORT_MISSING", owner.name));
      else if (actual.length !== 1) findings.push(finding("EXPECTED_EXPORT_AMBIGUOUS", owner.name));
      else if (canonicalJson(approved[0]!.shape) !== canonicalJson(actual[0]!.shape)) findings.push(finding("EXPORT_SHAPE_MISMATCH", owner.name));
    }
    for (const entry of candidateExports) if (!seen.has(entry.name)) findings.push(finding("UNEXPECTED_EXPORT", entry.name));
    const expectedLocal = new Map(expected.entries.filter((entry) => !entry.exported).map((entry) => [entry.name, entry]));
    const candidateLocal = new Map(candidate.entries.filter((entry) => !entry.exported).map((entry) => [entry.name, entry]));
    for (const owner of owned) {
      const rootEntry = expectedExports.find((entry) => entry.name === owner.name);
      if (rootEntry === undefined) continue;
      for (const reference of references(rootEntry.node)) {
        if (GLOBALS.has(reference)) continue;
        const support = expectedLocal.get(reference);
        if (support === undefined) continue;
        const actual = candidateLocal.get(reference);
        if (actual === undefined) findings.push(finding("SUPPORTING_DECLARATION_MISSING", owner.name));
        else if (canonicalJson(support.shape) !== canonicalJson(actual.shape)) findings.push(finding("SUPPORTING_DECLARATION_SHAPE_MISMATCH", owner.name));
      }
    }
  }
  const contracts = owned.map((owner) => ({ name: owner.name, shape: expected.entries.find((entry) => entry.exported && entry.name === owner.name)?.shape ?? null }));
  if (findings.length !== 0) {
    const verdictDigest = sha256Json({ schema: "score.file-candidate-declaration-verdict", version: "1.0.0", bindingDigest, candidateDigest, contracts, findings });
    return { status: "invalid", findings: findings as [CandidateDeclarationFinding, ...CandidateDeclarationFinding[]], bindingDigest, candidateDigest, verdictDigest };
  }
  const verdictDigest = sha256Json({ schema: "score.file-candidate-declaration-verdict", version: "1.0.0", bindingDigest, candidateDigest, contracts, findings: [] });
  return { status: "valid", findings: [], bindingDigest, candidateDigest, verdictDigest };
}
