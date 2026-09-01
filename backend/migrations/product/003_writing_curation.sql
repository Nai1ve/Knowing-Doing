CREATE TABLE IF NOT EXISTS writing_clusters (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES writing_projects(id),
  cluster_key TEXT NOT NULL,
  position INTEGER NOT NULL,
  title TEXT NOT NULL,
  rule_summary TEXT NOT NULL,
  model_summary TEXT,
  relevance TEXT NOT NULL,
  user_note TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  summary_status TEXT NOT NULL DEFAULT 'rule_ready',
  revision INTEGER NOT NULL DEFAULT 1,
  source_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, cluster_key)
);
CREATE INDEX IF NOT EXISTS idx_writing_clusters_project_position ON writing_clusters(project_id, position);

CREATE TABLE IF NOT EXISTS writing_cluster_members (
  id TEXT PRIMARY KEY,
  cluster_id TEXT NOT NULL REFERENCES writing_clusters(id),
  ref_type TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  role TEXT NOT NULL,
  display_order INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(cluster_id, ref_type, ref_id)
);
CREATE INDEX IF NOT EXISTS idx_writing_cluster_members_cluster_role_created ON writing_cluster_members(cluster_id, role, created_at);

CREATE TABLE IF NOT EXISTS writing_curation_jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES writing_projects(id),
  input_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  provider TEXT,
  model TEXT,
  failure_code TEXT,
  failure_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(project_id, input_fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_writing_curation_jobs_status_updated ON writing_curation_jobs(status, updated_at);
