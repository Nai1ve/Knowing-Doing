CREATE TABLE IF NOT EXISTS gym_build_job_attempts (
  id TEXT PRIMARY KEY,
  gym_build_job_id TEXT NOT NULL REFERENCES gym_build_jobs(id),
  attempt_no INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'interrupted')),
  worker_token TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('create', 'retry', 'recovery')),
  failure_code TEXT,
  failure_message TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(gym_build_job_id, attempt_no)
);

CREATE INDEX IF NOT EXISTS idx_gym_build_attempts_job_attempt
  ON gym_build_job_attempts(gym_build_job_id, attempt_no DESC);
CREATE INDEX IF NOT EXISTS idx_gym_build_attempts_status_started
  ON gym_build_job_attempts(status, started_at);
