import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";

import {
  SLICE_DRAFT_SCHEMA,
  type SliceDraft,
  type SliceFinding
} from "./slice-draft.js";

export interface ChangeDraft extends Omit<SliceDraft, "slice_id" | "after"> {
  /** Omit for a new Change. Reuse only an id returned by SCORE for a revision. */
  readonly change_id?: string;
}

export const CHANGE_ID_PATTERN =
  "^chg_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$";

const {
  slice_id: _sliceId,
  after: _after,
  ...sharedSemanticProperties
} = SLICE_DRAFT_SCHEMA.properties;

export const CHANGE_DRAFT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://score-protocol.local/schema/change-draft-v2.json",
  type: "object",
  additionalProperties: false,
  required: ["title", "objective", "requirements", "files"],
  properties: {
    change_id: {
      type: "string",
      pattern: CHANGE_ID_PATTERN
    },
    ...sharedSemanticProperties
  }
} as const;

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validate = ajv.compile(CHANGE_DRAFT_SCHEMA);

function findingCode(error: ErrorObject): string {
  if (error.keyword === "additionalProperties") return "CHANGE_UNKNOWN_FIELD";
  if (error.keyword === "required") return "CHANGE_REQUIRED_FIELD_MISSING";
  if (error.keyword === "oneOf") return "SKILL_SOURCE_INVALID";
  return `CHANGE_${error.keyword.toUpperCase()}`;
}

export function validateChangeDraftShape(value: unknown): SliceFinding[] {
  if (validate(value)) return [];
  return (validate.errors ?? []).map((error) => ({
    code: findingCode(error),
    location: error.instancePath || "/",
    message: error.message ?? "Change failed schema validation",
    detail: { keyword: error.keyword, params: error.params },
    machineRepairable: true
  }));
}
