CREATE TABLE IF NOT EXISTS practice_lab_segments (
  id TEXT PRIMARY KEY,
  practice_run_id TEXT NOT NULL REFERENCES practice_runs(id),
  lab_run_id TEXT NOT NULL,
  fixture_version TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  ended_reason TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lab_segments_lab_run ON practice_lab_segments(lab_run_id);
CREATE INDEX IF NOT EXISTS idx_lab_segments_run_started ON practice_lab_segments(practice_run_id, started_at DESC);

CREATE TABLE IF NOT EXISTS tutor_invocations (
  id TEXT PRIMARY KEY,
  practice_run_id TEXT NOT NULL REFERENCES practice_runs(id),
  user_artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  client_request_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL,
  retrieval_status TEXT NOT NULL,
  source_ids_json TEXT NOT NULL,
  failure_code TEXT,
  failure_message TEXT,
  latency_ms INTEGER,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(practice_run_id, client_request_id)
);
CREATE INDEX IF NOT EXISTS idx_tutor_invocations_run_created ON tutor_invocations(practice_run_id, created_at DESC);
