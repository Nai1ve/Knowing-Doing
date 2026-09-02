DROP TABLE IF EXISTS writing_evidence_items_fts;
CREATE VIRTUAL TABLE writing_evidence_items_fts USING fts5(
  item_id UNINDEXED,
  project_id UNINDEXED,
  evidence_pack_id UNINDEXED,
  title,
  body,
  tokenize = 'trigram'
);
INSERT INTO writing_evidence_items_fts(item_id, project_id, evidence_pack_id, title, body)
SELECT id, project_id, evidence_pack_id, title, body FROM writing_evidence_items;
