CREATE TABLE prepared_slices (
  title TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE prepared_slice_revisions (
  title TEXT NOT NULL REFERENCES prepared_slices(title),
  revision INTEGER NOT NULL CHECK(revision >= 1),
  input_digest TEXT NOT NULL CHECK(length(input_digest) = 71),
  manifest_id TEXT NOT NULL UNIQUE REFERENCES run_manifests(manifest_id),
  review_id TEXT NOT NULL UNIQUE REFERENCES publication_reviews(review_id),
  artifact_stem TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  PRIMARY KEY(title, revision),
  UNIQUE(title, input_digest)
) STRICT;

CREATE VIEW v_prepared_slice_revisions AS
SELECT slice.title,
       slice.slug,
       revision.revision,
       revision.input_digest,
       revision.manifest_id,
       revision.review_id,
       revision.artifact_stem,
       revision.created_at
FROM prepared_slices slice
JOIN prepared_slice_revisions revision ON revision.title = slice.title
ORDER BY slice.title, revision.revision;
