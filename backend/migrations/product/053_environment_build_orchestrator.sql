-- gym_build_jobs previously used a closed status CHECK containing "building".
-- Rebuild the pair of job/attempt tables so the public lifecycle can expose
-- cleanup_pending without invalidating historical build and attempt records.
CREATE TABLE gym_build_jobs_next (
  id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learners(id),
  plan_id TEXT NOT NULL REFERENCES learning_plans(id),
  plan_unit_id TEXT NOT NULL REFERENCES plan_units(id),
  roadmap_node_id TEXT REFERENCES roadmap_nodes(id),
  client_request_id TEXT NOT NULL,
  input_fingerprint TEXT NOT NULL,
  capability_key TEXT NOT NULL,
  exercise_profile_key TEXT,
  card_snapshot_json TEXT NOT NULL DEFAULT '{}',
  environment_key TEXT NOT NULL,
  environment_version TEXT NOT NULL,
  runtime_kind TEXT NOT NULL CHECK (runtime_kind IN ('mysql_lab', 'docker_workspace')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'ready', 'failed', 'cleanup_pending')),
  protocol_version INTEGER NOT NULL DEFAULT 1,
  current_phase TEXT CHECK (current_phase IN ('designing', 'provisioning', 'initializing', 'preflighting', 'repairing')),
  repair_round INTEGER NOT NULL DEFAULT 0 CHECK (repair_round BETWEEN 0 AND 3),
  failure_category TEXT CHECK (failure_category IN ('platform_fault', 'agent_failure', 'preflight_failure')),
  manifest_json TEXT,
  manifest_fingerprint TEXT,
  adapter_task_id TEXT,
  adapter_event_sequence INTEGER NOT NULL DEFAULT 0,
  resource_lease_json TEXT NOT NULL DEFAULT '{}',
  cleanup_due_at TEXT,
  last_cleanup_error TEXT,
  worker_lease_expires_at TEXT,
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

INSERT INTO gym_build_jobs_next(
  id, learner_id, plan_id, plan_unit_id, roadmap_node_id, client_request_id, input_fingerprint,
  capability_key, exercise_profile_key, card_snapshot_json, environment_key, environment_version,
  runtime_kind, status, protocol_version, current_phase, repair_round, learning_case_id,
  case_generation_job_id, attempt_count, worker_token, failure_code, failure_message,
  started_at, completed_at, created_at, updated_at
)
SELECT
  id, learner_id, plan_id, plan_unit_id, roadmap_node_id, client_request_id, input_fingerprint,
  capability_key, exercise_profile_key, card_snapshot_json, environment_key, environment_version,
  runtime_kind,
  CASE status WHEN 'building' THEN 'running' ELSE status END,
  0,
  CASE WHEN status = 'building' THEN 'designing' ELSE NULL END,
  0,
  learning_case_id, case_generation_job_id, attempt_count, worker_token, failure_code, failure_message,
  started_at, completed_at, created_at, updated_at
FROM gym_build_jobs;

CREATE TABLE gym_build_job_attempts_snapshot AS
SELECT * FROM gym_build_job_attempts;

DROP TABLE gym_build_job_attempts;
DROP TABLE gym_build_jobs;
ALTER TABLE gym_build_jobs_next RENAME TO gym_build_jobs;

CREATE TABLE gym_build_job_attempts (
  id TEXT PRIMARY KEY,
  gym_build_job_id TEXT NOT NULL REFERENCES gym_build_jobs(id),
  attempt_no INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'interrupted')),
  worker_token TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK (trigger IN ('create', 'retry', 'recovery', 'legacy_rebuild')),
  failure_code TEXT,
  failure_message TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(gym_build_job_id, attempt_no)
);

INSERT INTO gym_build_job_attempts(id, gym_build_job_id, attempt_no, status, worker_token, trigger, failure_code, failure_message, started_at, completed_at, created_at)
SELECT id, gym_build_job_id, attempt_no, status, worker_token, trigger, failure_code, failure_message, started_at, completed_at, created_at
FROM gym_build_job_attempts_snapshot;
DROP TABLE gym_build_job_attempts_snapshot;

CREATE INDEX IF NOT EXISTS idx_gym_build_jobs_learner_status_updated
  ON gym_build_jobs(learner_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_gym_build_jobs_unit_created
  ON gym_build_jobs(plan_unit_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gym_build_jobs_unit_profile_created
  ON gym_build_jobs(plan_unit_id, exercise_profile_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gym_build_jobs_recovery
  ON gym_build_jobs(status, worker_lease_expires_at, created_at);
CREATE INDEX IF NOT EXISTS idx_gym_build_attempts_job_attempt
  ON gym_build_job_attempts(gym_build_job_id, attempt_no DESC);
CREATE INDEX IF NOT EXISTS idx_gym_build_attempts_status_started
  ON gym_build_job_attempts(status, started_at);

CREATE TABLE IF NOT EXISTS gym_build_events (
  id TEXT PRIMARY KEY,
  gym_build_job_id TEXT NOT NULL REFERENCES gym_build_jobs(id),
  attempt_no INTEGER NOT NULL,
  sequence INTEGER NOT NULL,
  adapter_event_id TEXT,
  phase TEXT,
  type TEXT NOT NULL CHECK (type IN ('phase', 'tool', 'docker', 'diagnostic', 'status')),
  summary TEXT NOT NULL,
  command_summary TEXT,
  diagnostic_json TEXT,
  resource_json TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(gym_build_job_id, sequence),
  UNIQUE(gym_build_job_id, adapter_event_id)
);
CREATE INDEX IF NOT EXISTS idx_gym_build_events_job_sequence
  ON gym_build_events(gym_build_job_id, sequence ASC);

CREATE TABLE IF NOT EXISTS gym_build_unit_locks (
  plan_unit_id TEXT PRIMARY KEY REFERENCES plan_units(id),
  gym_build_job_id TEXT NOT NULL REFERENCES gym_build_jobs(id),
  worker_token TEXT NOT NULL,
  lease_expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_gym_build_unit_locks_lease
  ON gym_build_unit_locks(lease_expires_at);

CREATE TABLE IF NOT EXISTS environment_runtime_bindings (
  id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learners(id),
  learning_case_id TEXT NOT NULL UNIQUE REFERENCES learning_cases(id),
  gym_build_job_id TEXT NOT NULL REFERENCES gym_build_jobs(id),
  runtime_kind TEXT NOT NULL CHECK (runtime_kind IN ('mysql_lab', 'docker_workspace')),
  runtime_image_digest TEXT NOT NULL,
  runtime_image_ref TEXT NOT NULL,
  manifest_fingerprint TEXT NOT NULL,
  resource_lease_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK (status IN ('ready', 'active', 'expired', 'superseded')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_environment_runtime_bindings_learner_status
  ON environment_runtime_bindings(learner_id, status, updated_at DESC);
