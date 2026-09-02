CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

ALTER TABLE learners ADD COLUMN user_id TEXT REFERENCES users(id);
ALTER TABLE learning_plans ADD COLUMN template_key TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE learning_plans ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE plan_units ADD COLUMN availability TEXT NOT NULL DEFAULT 'available';
ALTER TABLE plan_units ADD COLUMN completed_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_learners_user_unique
  ON learners(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_plans_learner_status_updated
  ON learning_plans(learner_id, status, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_plans_active_template
  ON learning_plans(learner_id, template_key)
  WHERE status IN ('confirmed', 'active');
CREATE INDEX IF NOT EXISTS idx_plan_units_plan_status_position
  ON plan_units(plan_id, status, position);
CREATE INDEX IF NOT EXISTS idx_practice_runs_plan_unit_status
  ON practice_runs(plan_unit_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_practice_runs_learner_unit_status
  ON practice_runs(learner_id, plan_unit_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS plan_events (
  id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learners(id),
  plan_id TEXT NOT NULL REFERENCES learning_plans(id),
  plan_unit_id TEXT REFERENCES plan_units(id),
  practice_run_id TEXT REFERENCES practice_runs(id),
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plan_events_plan_created
  ON plan_events(plan_id, created_at DESC, id DESC);
