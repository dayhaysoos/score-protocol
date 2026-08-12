DROP TRIGGER IF EXISTS prepared_slices_reject_update;
DROP TRIGGER IF EXISTS prepared_slices_reject_delete;
DROP TRIGGER IF EXISTS prepared_slice_revisions_reject_update;
DROP TRIGGER IF EXISTS prepared_slice_revisions_reject_delete;

ALTER TABLE prepared_slices ADD COLUMN slice_id TEXT;
UPDATE prepared_slices SET slice_id = slug;
CREATE UNIQUE INDEX prepared_slices_slice_id_unique
  ON prepared_slices(slice_id);

CREATE TRIGGER prepared_slices_require_slice_id
BEFORE INSERT ON prepared_slices
FOR EACH ROW
WHEN NEW.slice_id IS NULL OR length(NEW.slice_id) = 0
BEGIN
  SELECT RAISE(ABORT, 'prepared_slices.slice_id is required');
END;

ALTER TABLE prepared_slice_revisions ADD COLUMN display_title TEXT;
ALTER TABLE prepared_slice_revisions ADD COLUMN draft_digest TEXT;
ALTER TABLE prepared_slice_revisions ADD COLUMN source_path TEXT;
UPDATE prepared_slice_revisions SET display_title = title;

CREATE TABLE prepared_slice_dependencies (
  dependent_manifest_id TEXT NOT NULL REFERENCES run_manifests(manifest_id),
  prerequisite_slice_id TEXT NOT NULL,
  prerequisite_revision INTEGER NOT NULL CHECK(prerequisite_revision >= 1),
  prerequisite_pass_id TEXT NOT NULL REFERENCES coding_passes(pass_id),
  prerequisite_run_id TEXT NOT NULL,
  PRIMARY KEY(dependent_manifest_id, prerequisite_slice_id)
) STRICT;

DROP VIEW v_prepared_slice_revisions;

CREATE VIEW v_prepared_slice_revisions AS
SELECT slice.slice_id,
       COALESCE(revision.display_title, slice.title) AS display_title,
       slice.slug,
       revision.revision,
       revision.input_digest,
       revision.draft_digest,
       revision.source_path,
       revision.manifest_id,
       revision.review_id,
       revision.artifact_stem,
       revision.created_at,
       publication.published_at
FROM prepared_slices slice
JOIN prepared_slice_revisions revision ON revision.title = slice.title
JOIN prepared_slice_publications publication
  ON publication.title = revision.title
 AND publication.revision = revision.revision
 AND publication.review_id = revision.review_id
ORDER BY slice.slice_id, revision.revision;
