import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256Bytes, sha256Json } from "./canonical.js";
import { repositoryRevisionContentDigest } from "./repository-source-state.js";
import type { AcceptedInputPacket } from "./compiler-input.js";

export const FIXTURE_IDS = {
  acceptedSpecification: "e94cf478-10d1-4c66-8914-2983f6e73c48",
  requirementAccountStatus: "66bacb25-b52c-4898-bf49-6789cdf09d87",
  requirementFormatter: "36b34c82-c940-4d5b-8762-8f5a38f60e4e",
  requirementFileBoundary: "f872366e-dc5c-40c4-a250-70d27d064e08",
  compilationProcedure: "d6ce0b6a-f30f-4559-9bf2-fa86f84282f8",
  repositoryRevision: "e18bba9e-c676-480a-9dca-bd6905d589ed",
  compilerInputRevision: "fe0c4e3e-f897-4f34-b5be-634d54cebf65"
} as const;

export const FIXTURE_TIMESTAMP = "2026-08-05T20:00:00.000Z";
const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const BASE_SCHEMA_CONTENT =
  "export interface Account {\n  id: string;\n  name: string;\n}\n";

const acceptedStatement =
  "Add an account status with the values active and suspended. Update the shared account declaration and create a pure formatter that returns \"<name> [<status>]\". No other file may change.";

const requirements = [
  {
    protocol_id: FIXTURE_IDS.requirementAccountStatus,
    label: "AR-1",
    statement: "Account has id, name, and the required status field."
  },
  {
    protocol_id: FIXTURE_IDS.requirementFormatter,
    label: "AR-2",
    statement: "formatAccountLabel(account) returns exactly name [status]."
  },
  {
    protocol_id: FIXTURE_IDS.requirementFileBoundary,
    label: "AR-3",
    statement: "The Pass replaces one declared file and creates one declared file only."
  }
].map((requirement) => ({ ...requirement, content_digest: sha256Json(requirement) }));

export function createAcceptedInputPacket(): AcceptedInputPacket {
  const procedurePath = join(
    PACKAGE_ROOT,
    "fixtures",
    "account-status-authoring-procedure.md"
  );
  const procedureContent = readFileSync(procedurePath, "utf8");
  const repositoryFile = {
    path: "src/schema.ts",
    media_type: "text/typescript; charset=utf-8",
    content: BASE_SCHEMA_CONTENT,
    content_digest: sha256Bytes(BASE_SCHEMA_CONTENT)
  };
  const orderedManifest = [
    {
      path: repositoryFile.path,
      media_type: repositoryFile.media_type,
      content_digest: repositoryFile.content_digest
    }
  ];
  const repositoryDigest = repositoryRevisionContentDigest({ orderedManifest });
  const specificationContent = {
    statement: acceptedStatement,
    accepted_requirements: requirements.map(({ protocol_id, label, statement, content_digest }) => ({
      protocol_id,
      label,
      statement,
      content_digest
    }))
  };
  const specificationDigest = sha256Json(specificationContent);
  const procedureDigest = sha256Bytes(procedureContent);
  const compilerInputContent = {
    accepted_specification: {
      protocol_id: FIXTURE_IDS.acceptedSpecification,
      content_digest: specificationDigest
    },
    repository_revision: {
      protocol_id: FIXTURE_IDS.repositoryRevision,
      content_digest: repositoryDigest
    },
    compilation_procedure: {
      protocol_id: FIXTURE_IDS.compilationProcedure,
      content_digest: procedureDigest
    },
    absent_paths: ["src/account-label.ts"]
  };

  return {
    schema: "score.compiler-input-packet",
    version: "0.1.0-alpha.6",
    accepted_specification: {
      protocol_id: FIXTURE_IDS.acceptedSpecification,
      authority: "human-and-llm-deliberation",
      accepted_at: FIXTURE_TIMESTAMP,
      content: specificationContent,
      content_digest: specificationDigest
    },
    accepted_requirements: requirements,
    compilation_procedure: {
      protocol_id: FIXTURE_IDS.compilationProcedure,
      name: "score-authoring",
      version: "0.1.0-alpha.6",
      profile: "score.coding@0.1.0-alpha.6",
      source: "fixtures/account-status-authoring-procedure.md",
      content: procedureContent,
      content_digest: procedureDigest
    },
    repository_revision: {
      protocol_id: FIXTURE_IDS.repositoryRevision,
      label: "account-status-r1",
      files: [repositoryFile],
      absent_paths: ["src/account-label.ts"],
      ordered_manifest: orderedManifest,
      content_digest: repositoryDigest
    },
    compiler_input_revision: {
      protocol_id: FIXTURE_IDS.compilerInputRevision,
      authority: "local-alpha-fixture",
      accepted_at: FIXTURE_TIMESTAMP,
      content: compilerInputContent,
      content_digest: sha256Json(compilerInputContent)
    }
  };
}

export type { AcceptedInputPacket } from "./compiler-input.js";
