CREATE TABLE IF NOT EXISTS writing_cluster_capsules (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES writing_projects(id),
  cluster_id TEXT NOT NULL REFERENCES writing_clusters(id),
  input_fingerprint TEXT NOT NULL,
  version INTEGER NOT NULL,
  rule_summary TEXT NOT NULL,
  model_summary TEXT,
  key_findings_json TEXT NOT NULL,
  turning_points_json TEXT NOT NULL,
  unresolved_questions_json TEXT NOT NULL,
  status TEXT NOT NULL,
  raw_count INTEGER NOT NULL DEFAULT 0,
  representative_count INTEGER NOT NULL DEFAULT 0,
  omitted_count INTEGER NOT NULL DEFAULT 0,
  model_failure_code TEXT,
  model_failure_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, cluster_id, input_fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_writing_capsules_project_status
  ON writing_cluster_capsules(project_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_writing_capsules_cluster_version
  ON writing_cluster_capsules(cluster_id, version DESC);

CREATE TABLE IF NOT EXISTS writing_capsule_members (
  id TEXT PRIMARY KEY,
  capsule_id TEXT NOT NULL REFERENCES writing_cluster_capsules(id),
  ref_type TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  role TEXT NOT NULL,
  display_order INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(capsule_id, ref_type, ref_id)
);
CREATE INDEX IF NOT EXISTS idx_writing_capsule_members_capsule_order
  ON writing_capsule_members(capsule_id, display_order, id);

CREATE TABLE IF NOT EXISTS writing_evidence_packs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES writing_projects(id),
  input_fingerprint TEXT NOT NULL,
  version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  node_count INTEGER NOT NULL,
  char_count INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  UNIQUE(project_id, input_fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_writing_evidence_packs_project_created
  ON writing_evidence_packs(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS writing_generation_jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES writing_projects(id),
  kind TEXT NOT NULL,
  input_fingerprint TEXT NOT NULL,
  client_request_id TEXT,
  evidence_pack_id TEXT REFERENCES writing_evidence_packs(id),
  outline_document_id TEXT REFERENCES writing_documents(id),
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  provider TEXT,
  model TEXT,
  failure_code TEXT,
  failure_message TEXT,
  result_document_id TEXT REFERENCES writing_documents(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(project_id, kind, input_fingerprint)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_writing_generation_jobs_request
  ON writing_generation_jobs(project_id, kind, client_request_id);
CREATE INDEX IF NOT EXISTS idx_writing_generation_jobs_status_updated
  ON writing_generation_jobs(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_writing_generation_jobs_project_kind
  ON writing_generation_jobs(project_id, kind, created_at DESC);

ALTER TABLE writing_projects ADD COLUMN current_evidence_pack_id TEXT REFERENCES writing_evidence_packs(id);
ALTER TABLE writing_documents ADD COLUMN evidence_pack_id TEXT REFERENCES writing_evidence_packs(id);
CREATE INDEX IF NOT EXISTS idx_writing_documents_evidence_pack
  ON writing_documents(evidence_pack_id);
