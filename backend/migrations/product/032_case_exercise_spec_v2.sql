ALTER TABLE learning_cases ADD COLUMN spec_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE learning_cases ADD COLUMN preflight_status TEXT NOT NULL DEFAULT 'not_required'
  CHECK (preflight_status IN ('not_required', 'queued', 'running', 'passed', 'failed'));

CREATE INDEX IF NOT EXISTS idx_learning_cases_learner_capability_updated
  ON learning_cases(learner_id, capability_key, updated_at DESC);
