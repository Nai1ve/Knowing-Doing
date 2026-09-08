CREATE TABLE IF NOT EXISTS learning_cases (
  id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learners(id),
  roadmap_node_id TEXT NOT NULL REFERENCES roadmap_nodes(id),
  capability_key TEXT NOT NULL,
  template_key TEXT NOT NULL,
  input_kind TEXT NOT NULL,
  input_snapshot_json TEXT NOT NULL,
  input_fingerprint TEXT NOT NULL,
  provider TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  case_spec_json TEXT NOT NULL DEFAULT '{}',
  failure_code TEXT,
  failure_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(learner_id, input_fingerprint)
);
ALTER TABLE roadmap_nodes ADD COLUMN capability_key TEXT;
CREATE INDEX IF NOT EXISTS idx_roadmap_nodes_capability
  ON roadmap_nodes(roadmap_id, capability_key, learning_mode);
CREATE INDEX IF NOT EXISTS idx_learning_cases_learner_node_updated
  ON learning_cases(learner_id, roadmap_node_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_learning_cases_learner_status_updated
  ON learning_cases(learner_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS case_generation_jobs (
  id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learners(id),
  learning_case_id TEXT NOT NULL REFERENCES learning_cases(id),
  client_request_id TEXT NOT NULL,
  input_fingerprint TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  worker_token TEXT,
  failure_code TEXT,
  failure_message TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(learning_case_id, client_request_id),
  UNIQUE(learner_id, client_request_id)
);
CREATE INDEX IF NOT EXISTS idx_case_jobs_learner_status_updated
  ON case_generation_jobs(learner_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_case_jobs_case_created
  ON case_generation_jobs(learning_case_id, created_at DESC);

ALTER TABLE practice_runs ADD COLUMN practice_kind TEXT NOT NULL DEFAULT 'mysql_lab';
ALTER TABLE practice_runs ADD COLUMN learning_case_id TEXT REFERENCES learning_cases(id);
CREATE INDEX IF NOT EXISTS idx_practice_runs_kind_case_status
  ON practice_runs(practice_kind, learning_case_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS workspace_runs (
  id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learners(id),
  practice_run_id TEXT NOT NULL REFERENCES practice_runs(id),
  learning_case_id TEXT NOT NULL REFERENCES learning_cases(id),
  runner_run_id TEXT UNIQUE,
  template_key TEXT NOT NULL,
  status TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  lease_expires_at TEXT,
  last_heartbeat_at TEXT,
  ended_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ended_at TEXT,
  UNIQUE(practice_run_id)
);
CREATE INDEX IF NOT EXISTS idx_workspace_runs_practice_status
  ON workspace_runs(practice_run_id, status);
CREATE INDEX IF NOT EXISTS idx_workspace_runs_learner_status_updated
  ON workspace_runs(learner_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workspace_runs_case_status_updated
  ON workspace_runs(learning_case_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workspace_runs_status_updated
  ON workspace_runs(status, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_runs_active_case
  ON workspace_runs(learning_case_id)
  WHERE status IN ('provisioning', 'active', 'executing');

CREATE TABLE IF NOT EXISTS workspace_files (
  id TEXT PRIMARY KEY,
  workspace_run_id TEXT NOT NULL REFERENCES workspace_runs(id),
  path TEXT NOT NULL,
  content TEXT NOT NULL,
  checksum TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(workspace_run_id, path)
);
CREATE INDEX IF NOT EXISTS idx_workspace_files_run_path
  ON workspace_files(workspace_run_id, path);

CREATE TABLE IF NOT EXISTS workspace_executions (
  id TEXT PRIMARY KEY,
  workspace_run_id TEXT NOT NULL REFERENCES workspace_runs(id),
  sequence INTEGER NOT NULL,
  client_request_id TEXT NOT NULL,
  runner_execution_id TEXT,
  command TEXT NOT NULL,
  status TEXT NOT NULL,
  stdout TEXT NOT NULL DEFAULT '',
  stderr TEXT NOT NULL DEFAULT '',
  exit_code INTEGER,
  duration_ms INTEGER,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(workspace_run_id, sequence),
  UNIQUE(workspace_run_id, client_request_id)
);
CREATE INDEX IF NOT EXISTS idx_workspace_executions_run_sequence
  ON workspace_executions(workspace_run_id, sequence DESC);
CREATE INDEX IF NOT EXISTS idx_workspace_executions_run_status_updated
  ON workspace_executions(workspace_run_id, status, created_at DESC);
