CREATE TABLE IF NOT EXISTS case_generation_attempts (
  id TEXT PRIMARY KEY,
  case_generation_job_id TEXT NOT NULL REFERENCES case_generation_jobs(id),
  attempt_number INTEGER NOT NULL,
  phase TEXT NOT NULL,
  provider TEXT NOT NULL,
  model_name TEXT,
  prompt_version TEXT,
  context_fingerprint TEXT NOT NULL,
  response_fingerprint TEXT,
  status TEXT NOT NULL,
  diagnostics_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(case_generation_job_id, attempt_number, phase)
);

CREATE INDEX IF NOT EXISTS idx_case_attempts_job_attempt
  ON case_generation_attempts(case_generation_job_id, attempt_number DESC, phase);
CREATE INDEX IF NOT EXISTS idx_case_attempts_status_created
  ON case_generation_attempts(status, created_at DESC);
