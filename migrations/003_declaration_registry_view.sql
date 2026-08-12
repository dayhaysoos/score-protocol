CREATE VIEW v_declaration_registry AS
SELECT declaration.declaration_id,
       declaration.logical_name,
       declaration.language,
       declaration.declaration_kind,
       declaration.symbol_space,
       declaration.definition_json,
       declaration.content_digest,
       owner_capsule.target_path AS owner_target_path,
       consumer_capsule.target_path AS consumer_target_path
FROM planned_declarations declaration
JOIN declaration_ownership ownership
  ON ownership.declaration_id = declaration.declaration_id
JOIN capsules owner_capsule
  ON owner_capsule.capsule_id = ownership.owner_capsule_id
LEFT JOIN declaration_consumers consumer
  ON consumer.declaration_id = declaration.declaration_id
LEFT JOIN capsules consumer_capsule
  ON consumer_capsule.capsule_id = consumer.consumer_capsule_id
ORDER BY declaration.logical_name, declaration.symbol_space, consumer_capsule.target_path;
