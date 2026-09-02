CREATE TABLE IF NOT EXISTS writing_draft_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES writing_projects(id),
  input_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL,
  phase TEXT NOT NULL,
  evidence_pack_id TEXT REFERENCES writing_evidence_packs(id),
  outline_job_id TEXT REFERENCES writing_generation_jobs(id),
  article_job_id TEXT REFERENCES writing_generation_jobs(id),
  outline_document_id TEXT REFERENCES writing_documents(id),
  article_document_id TEXT REFERENCES writing_documents(id),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  failure_code TEXT,
  failure_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(project_id, input_fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_writing_draft_runs_project_updated
  ON writing_draft_runs(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_writing_draft_runs_status_updated
  ON writing_draft_runs(status, updated_at);

CREATE TABLE IF NOT EXISTS writing_section_blocks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES writing_documents(id),
  section_id TEXT NOT NULL REFERENCES writing_sections(id),
  position INTEGER NOT NULL,
  content TEXT NOT NULL,
  block_type TEXT NOT NULL DEFAULT 'paragraph',
  evidence_refs_json TEXT NOT NULL,
  source_refs_json TEXT NOT NULL,
  reference_roles_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(document_id, section_id, position)
);
CREATE INDEX IF NOT EXISTS idx_writing_section_blocks_section_position
  ON writing_section_blocks(section_id, position);
CREATE INDEX IF NOT EXISTS idx_writing_section_blocks_document_position
  ON writing_section_blocks(document_id, position);

INSERT OR IGNORE INTO writing_section_blocks(
  id, document_id, section_id, position, content, block_type,
  evidence_refs_json, source_refs_json, reference_roles_json, revision,
  created_at, updated_at
)
SELECT lower(hex(randomblob(16))), document_id, id, 0, content, 'paragraph',
  evidence_refs_json, source_refs_json, '{}', 1, updated_at, updated_at
FROM writing_sections
WHERE NOT EXISTS (
  SELECT 1 FROM writing_section_blocks blocks WHERE blocks.section_id = writing_sections.id
);
