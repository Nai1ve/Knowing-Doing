CREATE TABLE IF NOT EXISTS case_preflight_runs (
  id TEXT PRIMARY KEY,
  learning_case_id TEXT NOT NULL REFERENCES learning_cases(id),
  case_generation_job_id TEXT NOT NULL REFERENCES case_generation_jobs(id),
  attempt_number INTEGER NOT NULL,
  environment_key TEXT NOT NULL,
  environment_version TEXT NOT NULL,
  runtime_kind TEXT NOT NULL,
  runner_run_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'provisioning', 'verifying_starter', 'verifying_reference', 'passed', 'failed', 'interrupted')),
  starter_execution_json TEXT NOT NULL DEFAULT '[]',
  reference_execution_json TEXT NOT NULL DEFAULT '[]',
  failure_code TEXT,
  failure_message TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(case_generation_job_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS idx_case_preflight_case_created
  ON case_preflight_runs(learning_case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_case_preflight_status_updated
  ON case_preflight_runs(status, updated_at);

CREATE INDEX IF NOT EXISTS idx_case_jobs_status_updated
  ON case_generation_jobs(status, updated_at);
