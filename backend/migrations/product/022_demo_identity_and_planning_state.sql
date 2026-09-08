CREATE TABLE IF NOT EXISTS demo_identity_config (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  learner_id TEXT NOT NULL REFERENCES learners(id),
  created_at TEXT NOT NULL,
  UNIQUE(user_id),
  UNIQUE(learner_id)
);

INSERT OR IGNORE INTO users(id, display_name, status, created_at, updated_at)
VALUES ('demo-user', '知行演示用户', 'active', datetime('now'), datetime('now'));

INSERT OR IGNORE INTO learners(id, user_id, created_at, updated_at)
VALUES ('demo-learner', 'demo-user', datetime('now'), datetime('now'));

INSERT OR IGNORE INTO demo_identity_config(id, user_id, learner_id, created_at)
VALUES ('default', 'demo-user', 'demo-learner', datetime('now'));

CREATE INDEX IF NOT EXISTS idx_planning_sessions_agent_resume
  ON planning_sessions(learner_id, mode, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_planning_agent_invocations_session_status
  ON planning_agent_invocations(session_id, status, created_at DESC);
