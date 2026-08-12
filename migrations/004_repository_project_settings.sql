CREATE TABLE repository_project_settings (
  revision_id TEXT PRIMARY KEY REFERENCES repository_revisions(revision_id),
  settings_json TEXT NOT NULL CHECK(json_valid(settings_json)),
  content_digest TEXT NOT NULL CHECK(length(content_digest) = 71)
) STRICT;

CREATE VIEW v_repository_project_settings AS
SELECT rr.revision_id,
       rr.label AS revision_label,
       settings.settings_json,
       settings.content_digest
FROM repository_revisions rr
JOIN repository_project_settings settings ON settings.revision_id = rr.revision_id
ORDER BY rr.revision_id;
