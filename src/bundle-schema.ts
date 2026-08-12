import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";

export interface ValidationFinding {
  kind: "deterministic_validation" | "heuristic_warning" | "compilation_gap";
  code: string;
  severity: "error" | "warning";
  location: string;
  message: string;
  detail: Record<string, unknown>;
  machine_repairable: boolean;
  requires_human_input: boolean;
}

const schemaPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "schema",
  "compilation-bundle.schema.json"
);
const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as object;
const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: false });
const validate = ajv.compile(schema);

function findingCode(error: ErrorObject): string {
  if (error.keyword === "additionalProperties") {
    return "SCHEMA_ADDITIONAL_PROPERTY";
  }
  if (error.keyword === "required") {
    return "SCHEMA_REQUIRED_PROPERTY";
  }
  if (error.keyword === "const") {
    return "SCHEMA_VERSION_MISMATCH";
  }
  return `SCHEMA_${error.keyword.toUpperCase()}`;
}

export function validateBundleShape(bundle: unknown): ValidationFinding[] {
  if (validate(bundle)) {
    return [];
  }

  return (validate.errors ?? []).map((error) => ({
    kind: "deterministic_validation" as const,
    code: findingCode(error),
    severity: "error" as const,
    location: error.instancePath || "/",
    message: error.message ?? "Compilation Bundle failed schema validation",
    detail: { keyword: error.keyword, params: error.params },
    machine_repairable: true,
    requires_human_input: false
  }));
}
