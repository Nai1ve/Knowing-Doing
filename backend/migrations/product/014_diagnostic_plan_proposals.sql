ALTER TABLE learning_plans ADD COLUMN plan_state TEXT NOT NULL DEFAULT 'active';
ALTER TABLE plan_units ADD COLUMN learning_mode TEXT NOT NULL DEFAULT 'lab';
ALTER TABLE plan_units ADD COLUMN estimated_minutes INTEGER NOT NULL DEFAULT 60;
ALTER TABLE plan_units ADD COLUMN rationale TEXT NOT NULL DEFAULT '';

DROP INDEX IF EXISTS idx_plans_active_template;
CREATE UNIQUE INDEX IF NOT EXISTS idx_plans_current_learner
  ON learning_plans(learner_id)
  WHERE status IN ('confirmed', 'active', 'pending_content');
CREATE INDEX IF NOT EXISTS idx_plans_learner_state_updated
  ON learning_plans(learner_id, plan_state, updated_at DESC);

CREATE TABLE IF NOT EXISTS diagnostic_sessions (
  id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learners(id),
  intake_id TEXT NOT NULL REFERENCES intakes(id),
  target_key TEXT NOT NULL,
  status TEXT NOT NULL,
  rules_version TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  client_request_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(learner_id, client_request_id)
);
CREATE INDEX IF NOT EXISTS idx_diagnostic_sessions_learner_status_updated
  ON diagnostic_sessions(learner_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS diagnostic_turns (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES diagnostic_sessions(id),
  position INTEGER NOT NULL,
  question_key TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(session_id, position),
  UNIQUE(session_id, question_key)
);
CREATE INDEX IF NOT EXISTS idx_diagnostic_turns_session_position
  ON diagnostic_turns(session_id, position);

CREATE TABLE IF NOT EXISTS profile_evidence (
  id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learners(id),
  diagnostic_session_id TEXT NOT NULL REFERENCES diagnostic_sessions(id),
  evidence_key TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_profile_evidence_learner_status_updated
  ON profile_evidence(learner_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS plan_proposals (
  id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learners(id),
  diagnostic_session_id TEXT NOT NULL REFERENCES diagnostic_sessions(id),
  input_fingerprint TEXT NOT NULL,
  template_key TEXT NOT NULL,
  target_key TEXT NOT NULL,
  status TEXT NOT NULL,
  rules_version TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  input_snapshot_json TEXT NOT NULL,
  plan_snapshot_json TEXT NOT NULL,
  rationale_json TEXT NOT NULL,
  confirmed_plan_id TEXT REFERENCES learning_plans(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(diagnostic_session_id, input_fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_plan_proposals_learner_status_updated
  ON plan_proposals(learner_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_plan_proposals_session_updated
  ON plan_proposals(diagnostic_session_id, updated_at DESC);
