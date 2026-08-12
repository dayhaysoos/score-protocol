CREATE TABLE prepared_slice_publications (
  title TEXT NOT NULL,
  revision INTEGER NOT NULL,
  review_id TEXT NOT NULL UNIQUE REFERENCES publication_reviews(review_id),
  published_at TEXT NOT NULL,
  PRIMARY KEY(title, revision),
  FOREIGN KEY(title, revision) REFERENCES prepared_slice_revisions(title, revision)
) STRICT;

DROP VIEW v_prepared_slice_revisions;

CREATE VIEW v_prepared_slice_revisions AS
SELECT slice.title,
       slice.slug,
       revision.revision,
       revision.input_digest,
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
ORDER BY slice.title, revision.revision;
