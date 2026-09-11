CREATE TABLE IF NOT EXISTS plan_adjustments (
  id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learners(id),
  plan_id TEXT NOT NULL REFERENCES learning_plans(id),
  client_request_id TEXT NOT NULL,
  base_plan_revision INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ready', 'confirmed', 'failed', 'superseded')),
  request_text TEXT NOT NULL,
  diff_json TEXT NOT NULL DEFAULT '{}',
  proposal_json TEXT NOT NULL DEFAULT '{}',
  provider TEXT NOT NULL DEFAULT 'planner',
  failure_code TEXT,
  failure_message TEXT,
  confirmed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(plan_id, client_request_id)
);

CREATE INDEX IF NOT EXISTS idx_plan_adjustments_learner_updated
  ON plan_adjustments(learner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_plan_adjustments_plan_updated
  ON plan_adjustments(plan_id, updated_at DESC);
