CREATE TABLE planned_declarations (
  declaration_id TEXT PRIMARY KEY CHECK(length(declaration_id) = 36),
  pass_id TEXT NOT NULL REFERENCES coding_passes(pass_id),
  contract_id TEXT NOT NULL REFERENCES contracts(contract_id),
  logical_name TEXT NOT NULL,
  language TEXT NOT NULL CHECK(language = 'typescript'),
  declaration_kind TEXT NOT NULL CHECK(declaration_kind IN ('interface', 'function')),
  symbol_space TEXT NOT NULL CHECK(symbol_space IN ('type', 'value')),
  definition_json TEXT NOT NULL CHECK(json_valid(definition_json)),
  content_digest TEXT NOT NULL CHECK(length(content_digest) = 71),
  UNIQUE(pass_id, contract_id, logical_name, symbol_space)
) STRICT;

CREATE TABLE declaration_ownership (
  declaration_id TEXT PRIMARY KEY REFERENCES planned_declarations(declaration_id),
  owner_capsule_id TEXT NOT NULL REFERENCES capsules(capsule_id),
  content_digest TEXT NOT NULL CHECK(length(content_digest) = 71)
) STRICT;

CREATE TABLE declaration_consumers (
  declaration_id TEXT NOT NULL REFERENCES planned_declarations(declaration_id),
  consumer_capsule_id TEXT NOT NULL REFERENCES capsules(capsule_id),
  content_digest TEXT NOT NULL CHECK(length(content_digest) = 71),
  PRIMARY KEY(declaration_id, consumer_capsule_id)
) STRICT;
