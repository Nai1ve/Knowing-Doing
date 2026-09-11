ALTER TABLE plan_units ADD COLUMN learning_case_id TEXT REFERENCES learning_cases(id);

CREATE INDEX IF NOT EXISTS idx_plan_units_learning_case
  ON plan_units(learning_case_id);

CREATE TABLE IF NOT EXISTS gym_build_jobs (
  id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learners(id),
  plan_id TEXT NOT NULL REFERENCES learning_plans(id),
  plan_unit_id TEXT NOT NULL REFERENCES plan_units(id),
  roadmap_node_id TEXT REFERENCES roadmap_nodes(id),
  client_request_id TEXT NOT NULL,
  input_fingerprint TEXT NOT NULL,
  capability_key TEXT NOT NULL,
  environment_key TEXT NOT NULL,
  environment_version TEXT NOT NULL,
  runtime_kind TEXT NOT NULL CHECK (runtime_kind IN ('mysql_lab', 'docker_workspace')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'building', 'ready', 'failed')),
  learning_case_id TEXT REFERENCES learning_cases(id),
  case_generation_job_id TEXT REFERENCES case_generation_jobs(id),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  worker_token TEXT,
  failure_code TEXT,
  failure_message TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(learner_id, plan_unit_id, client_request_id),
  UNIQUE(learner_id, plan_unit_id, input_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_gym_build_jobs_learner_status_updated
  ON gym_build_jobs(learner_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_gym_build_jobs_unit_created
  ON gym_build_jobs(plan_unit_id, created_at DESC);
