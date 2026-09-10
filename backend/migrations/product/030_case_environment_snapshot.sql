ALTER TABLE learning_cases ADD COLUMN environment_key TEXT NOT NULL DEFAULT 'python-pytest-v1';
ALTER TABLE learning_cases ADD COLUMN environment_version TEXT NOT NULL DEFAULT '1';
ALTER TABLE learning_cases ADD COLUMN runtime_kind TEXT NOT NULL DEFAULT 'docker_workspace';

CREATE INDEX IF NOT EXISTS idx_learning_cases_learner_environment_updated
  ON learning_cases(learner_id, environment_key, updated_at DESC);
