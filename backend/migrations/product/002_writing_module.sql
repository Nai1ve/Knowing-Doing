CREATE TABLE IF NOT EXISTS writing_projects (
  id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learners(id),
  practice_run_id TEXT NOT NULL UNIQUE REFERENCES practice_runs(id),
  article_type TEXT NOT NULL,
  status TEXT NOT NULL,
  evidence_snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_writing_projects_learner_updated ON writing_projects(learner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS writing_materials (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES writing_projects(id),
  category TEXT NOT NULL,
  ref_type TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  title TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  selected INTEGER NOT NULL DEFAULT 1,
  verification_status TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(project_id, ref_type, ref_id)
);
CREATE INDEX IF NOT EXISTS idx_writing_materials_project_selected ON writing_materials(project_id, selected, created_at);

CREATE TABLE IF NOT EXISTS writing_documents (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES writing_projects(id),
  kind TEXT NOT NULL,
  revision INTEGER NOT NULL,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, kind, revision)
);
CREATE INDEX IF NOT EXISTS idx_writing_documents_project_kind ON writing_documents(project_id, kind, revision DESC);

CREATE TABLE IF NOT EXISTS writing_sections (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES writing_documents(id),
  section_key TEXT NOT NULL,
  position INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  required INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  evidence_refs_json TEXT NOT NULL,
  source_refs_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(document_id, section_key)
);
CREATE INDEX IF NOT EXISTS idx_writing_sections_document_position ON writing_sections(document_id, position);

CREATE TABLE IF NOT EXISTS writing_claims (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES writing_documents(id),
  section_id TEXT NOT NULL REFERENCES writing_sections(id),
  text TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  evidence_refs_json TEXT NOT NULL,
  source_refs_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(document_id, section_id, text)
);
CREATE INDEX IF NOT EXISTS idx_writing_claims_document_status ON writing_claims(document_id, status);

CREATE TABLE IF NOT EXISTS writing_review_items (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES writing_projects(id),
  code TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL,
  message TEXT NOT NULL,
  section_id TEXT REFERENCES writing_sections(id),
  created_at TEXT NOT NULL,
  UNIQUE(project_id, code, section_id)
);
CREATE INDEX IF NOT EXISTS idx_writing_review_project_status ON writing_review_items(project_id, status, severity);
