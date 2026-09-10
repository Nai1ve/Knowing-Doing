CREATE TABLE IF NOT EXISTS case_materializations (
  id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learners(id),
  learning_case_id TEXT NOT NULL REFERENCES learning_cases(id),
  environment_key TEXT NOT NULL,
  environment_version TEXT NOT NULL,
  materialization_fingerprint TEXT NOT NULL,
  registry_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'materialized', 'failed', 'expired')),
  materialization_json TEXT NOT NULL DEFAULT '{}',
  failure_code TEXT,
  failure_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(learning_case_id, materialization_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_case_materializations_learner_status_updated
  ON case_materializations(learner_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_case_materializations_case_created
  ON case_materializations(learning_case_id, created_at DESC);

ALTER TABLE learning_cases ADD COLUMN materialization_id TEXT REFERENCES case_materializations(id);
CREATE INDEX IF NOT EXISTS idx_learning_cases_materialization
  ON learning_cases(materialization_id);

CREATE TABLE IF NOT EXISTS case_materialization_events (
  id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learners(id),
  learning_case_id TEXT NOT NULL REFERENCES learning_cases(id),
  materialization_id TEXT NOT NULL REFERENCES case_materializations(id),
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_case_materialization_events_case_created
  ON case_materialization_events(learning_case_id, created_at DESC);
