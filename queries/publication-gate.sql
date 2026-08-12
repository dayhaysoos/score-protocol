.headers on
.mode box

SELECT review_id, manifest_id, report_id, snapshot_digest, created_at
FROM publication_reviews;

SELECT target_path, operation, payload_id,
       control_digest, agent_input_digest, payload_digest,
       agent_input_markdown_digest
FROM v_harness_payload_digests;

SELECT * FROM v_publication_bindings;

SELECT COUNT(*) AS publication_decision_count
FROM publication_decisions;
