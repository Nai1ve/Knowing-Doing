CREATE TABLE IF NOT EXISTS writing_evidence_items (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES writing_projects(id),
  evidence_pack_id TEXT NOT NULL REFERENCES writing_evidence_packs(id),
  ref_type TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  UNIQUE(evidence_pack_id, ref_type, ref_id)
);
CREATE INDEX IF NOT EXISTS idx_writing_evidence_items_pack_created
  ON writing_evidence_items(evidence_pack_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_writing_evidence_items_pack_kind
  ON writing_evidence_items(evidence_pack_id, kind, created_at);

CREATE VIRTUAL TABLE IF NOT EXISTS writing_evidence_items_fts USING fts5(
  item_id UNINDEXED,
  project_id UNINDEXED,
  evidence_pack_id UNINDEXED,
  title,
  body
);

ALTER TABLE writing_generation_jobs ADD COLUMN output_content TEXT;
ALTER TABLE writing_draft_runs ADD COLUMN draft_job_id TEXT REFERENCES writing_generation_jobs(id);
ALTER TABLE writing_draft_runs ADD COLUMN humanize_job_id TEXT REFERENCES writing_generation_jobs(id);

CREATE INDEX IF NOT EXISTS idx_writing_generation_jobs_project_kind_status
  ON writing_generation_jobs(project_id, kind, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_writing_generation_jobs_input
  ON writing_generation_jobs(project_id, input_fingerprint);
CREATE INDEX IF NOT EXISTS idx_writing_draft_runs_project_input
  ON writing_draft_runs(project_id, input_fingerprint);

ALTER TABLE writing_documents ADD COLUMN format TEXT NOT NULL DEFAULT 'sectioned';
ALTER TABLE writing_documents ADD COLUMN content_markdown TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS writing_document_blocks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES writing_documents(id),
  position INTEGER NOT NULL,
  content TEXT NOT NULL,
  block_type TEXT NOT NULL,
  evidence_refs_json TEXT NOT NULL,
  source_refs_json TEXT NOT NULL,
  reference_roles_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(document_id, position)
);
CREATE INDEX IF NOT EXISTS idx_writing_document_blocks_document_position
  ON writing_document_blocks(document_id, position);
