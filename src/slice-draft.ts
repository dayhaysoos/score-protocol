import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";

export interface SliceSkillDraft {
  readonly name: string;
  readonly path?: string;
  readonly content?: string;
}

export interface DeclarationDraft {
  readonly name: string;
  readonly declaration: string;
  readonly description: string;
}

export interface ExternalDeclarationDraft {
  readonly from: string;
  readonly names: ReadonlyArray<string>;
  readonly purpose: string;
}

export interface SliceFileDraft {
  readonly path: string;
  readonly operation: "create" | "modify";
  readonly task: string;
  readonly requirements: ReadonlyArray<string>;
  readonly owns: ReadonlyArray<DeclarationDraft>;
  readonly consumes: ReadonlyArray<{
    readonly name: string;
    readonly from: string;
    readonly module_specifier: string;
  }>;
  readonly external_declarations?: ReadonlyArray<ExternalDeclarationDraft>;
  readonly context: ReadonlyArray<{ readonly path: string; readonly purpose: string }>;
  readonly skills: ReadonlyArray<SliceSkillDraft>;
  readonly constraints: ReadonlyArray<string>;
}

export interface SliceDraft {
  readonly slice_id: string;
  readonly after?: ReadonlyArray<string>;
  readonly title: string;
  readonly objective: string;
  readonly requirements: ReadonlyArray<string>;
  readonly files: ReadonlyArray<SliceFileDraft>;
}

export interface ResolvedSliceDependency {
  readonly slice_id: string;
  readonly revision: number;
  readonly pass_id: string;
  readonly run_id: string;
}

export interface SliceFinding {
  readonly code: string;
  readonly location: string;
  readonly message: string;
  readonly detail: Readonly<Record<string, unknown>>;
  readonly machineRepairable: boolean;
}

const nonEmptyString = { type: "string", minLength: 1 } as const;
const sliceId = {
  type: "string",
  minLength: 1,
  maxLength: 64,
  pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$"
} as const;

export const SLICE_DRAFT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://score-protocol.local/schema/slice-draft-v4.json",
  type: "object",
  additionalProperties: false,
  required: ["slice_id", "title", "objective", "requirements", "files"],
  properties: {
    slice_id: sliceId,
    after: {
      type: "array",
      uniqueItems: true,
      items: sliceId
    },
    title: nonEmptyString,
    objective: nonEmptyString,
    requirements: { type: "array", minItems: 1, uniqueItems: true, items: nonEmptyString },
    files: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "path",
          "operation",
          "task",
          "requirements",
          "owns",
          "consumes",
          "context",
          "skills",
          "constraints"
        ],
        properties: {
          path: nonEmptyString,
          operation: { enum: ["create", "modify"] },
          task: nonEmptyString,
          requirements: { type: "array", minItems: 1, uniqueItems: true, items: nonEmptyString },
          owns: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["name", "declaration", "description"],
              properties: {
                name: nonEmptyString,
                declaration: nonEmptyString,
                description: nonEmptyString
              }
            }
          },
          consumes: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["name", "from", "module_specifier"],
              properties: {
                name: nonEmptyString,
                from: nonEmptyString,
                module_specifier: nonEmptyString
              }
            }
          },
          external_declarations: {
            type: "array",
            minItems: 1,
            maxItems: 8,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["from", "names", "purpose"],
              properties: {
                from: nonEmptyString,
                names: {
                  type: "array",
                  minItems: 1,
                  maxItems: 8,
                  uniqueItems: true,
                  items: nonEmptyString
                },
                purpose: nonEmptyString
              }
            }
          },
          context: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["path", "purpose"],
              properties: { path: nonEmptyString, purpose: nonEmptyString }
            }
          },
          skills: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["name"],
              properties: { name: nonEmptyString, path: nonEmptyString, content: nonEmptyString },
              oneOf: [
                {
                  required: ["path"],
                  properties: { path: true, content: false }
                },
                {
                  required: ["content"],
                  properties: { path: false, content: true }
                }
              ]
            }
          },
          constraints: { type: "array", items: nonEmptyString }
        }
      }
    }
  }
} as const;

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validate = ajv.compile(SLICE_DRAFT_SCHEMA);

function findingCode(error: ErrorObject): string {
  if (error.keyword === "additionalProperties") return "SLICE_UNKNOWN_FIELD";
  if (error.keyword === "required") return "SLICE_REQUIRED_FIELD_MISSING";
  if (error.keyword === "oneOf") return "SKILL_SOURCE_INVALID";
  return `SLICE_${error.keyword.toUpperCase()}`;
}

export function validateSliceDraftShape(value: unknown): SliceFinding[] {
  if (validate(value)) return [];
  return (validate.errors ?? []).map((error) => ({
    code: findingCode(error),
    location: error.instancePath || "/",
    message: error.message ?? "SliceDraft failed schema validation",
    detail: { keyword: error.keyword, params: error.params },
    machineRepairable: true
  }));
}
