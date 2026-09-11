CREATE TABLE IF NOT EXISTS roadmap_generation_phase_attempts (
  id TEXT PRIMARY KEY,
  generation_run_id TEXT NOT NULL REFERENCES roadmap_generation_runs(id),
  phase TEXT NOT NULL CHECK (phase IN ('domain', 'module', 'unit', 'critic')),
  scope_key TEXT,
  attempt_no INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  input_fingerprint TEXT NOT NULL,
  output_json TEXT NOT NULL DEFAULT '{}',
  validation_issues_json TEXT NOT NULL DEFAULT '[]',
  provider TEXT NOT NULL,
  model TEXT,
  latency_ms INTEGER,
  failure_code TEXT,
  failure_message TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(generation_run_id, phase, scope_key, attempt_no)
);

ALTER TABLE roadmap_generation_runs ADD COLUMN scope_key TEXT;

CREATE INDEX IF NOT EXISTS idx_roadmap_phase_attempts_run_phase
  ON roadmap_generation_phase_attempts(generation_run_id, phase, scope_key, attempt_no DESC);
CREATE INDEX IF NOT EXISTS idx_roadmap_phase_attempts_running
  ON roadmap_generation_phase_attempts(status, updated_at DESC);
