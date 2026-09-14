-- product-migrate: foreign-key-rebuild
-- SQLite cannot alter a CHECK constraint. This migration uses the migration
-- runner's controlled foreign-key rebuild path, which verifies
-- foreign_key_check before committing. Do not rename the existing parent
-- table: SQLite would rewrite every child foreign-key declaration to the
-- temporary name.

CREATE TABLE planning_sessions_059 (
  id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learners(id),
  template_key TEXT NOT NULL,
  goal TEXT NOT NULL,
  status TEXT NOT NULL,
  current_step INTEGER NOT NULL DEFAULT 0,
  answers_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1,
  client_request_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'legacy',
  agent_status TEXT NOT NULL DEFAULT 'legacy',
  profile_snapshot_id TEXT,
  stage TEXT NOT NULL DEFAULT 'baseline' CHECK (stage IN ('baseline', 'assessment_preparing', 'assessment_answering', 'assessment_evaluating', 'requirements', 'requirements_review', 'ready', 'generating', 'proposed', 'confirmed')),
  baseline_turn_count INTEGER NOT NULL DEFAULT 0 CHECK (baseline_turn_count BETWEEN 0 AND 6),
  requirements_turn_count INTEGER NOT NULL DEFAULT 0 CHECK (requirements_turn_count BETWEEN 0 AND 5),
  active_assessment_id TEXT,
  active_requirement_brief_id TEXT,
  UNIQUE(learner_id, client_request_id)
);

INSERT INTO planning_sessions_059(
  id, learner_id, template_key, goal, status, current_step, answers_json,
  revision, client_request_id, created_at, updated_at, mode, agent_status,
  profile_snapshot_id, stage, baseline_turn_count, requirements_turn_count,
  active_assessment_id, active_requirement_brief_id
)
SELECT
  id, learner_id, template_key, goal, status, current_step, answers_json,
  revision, client_request_id, created_at, updated_at, mode, agent_status,
  profile_snapshot_id, stage, baseline_turn_count, requirements_turn_count,
  active_assessment_id, active_requirement_brief_id
FROM planning_sessions;

DROP TABLE planning_sessions;
ALTER TABLE planning_sessions_059 RENAME TO planning_sessions;

CREATE INDEX idx_planning_sessions_learner_status_updated
  ON planning_sessions(learner_id, status, updated_at DESC);
CREATE INDEX idx_planning_sessions_agent_resume
  ON planning_sessions(learner_id, mode, status, updated_at DESC);
