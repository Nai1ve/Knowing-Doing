-- Keep the existing agent conversation and roadmap records intact while making
-- the diagnostic flow an explicit, resumable state machine.
ALTER TABLE planning_sessions ADD COLUMN stage TEXT NOT NULL DEFAULT 'baseline' CHECK (stage IN ('baseline', 'assessment_preparing', 'assessment_answering', 'assessment_evaluating', 'requirements', 'requirements_review', 'ready', 'generating', 'proposed', 'confirmed'));
ALTER TABLE planning_sessions ADD COLUMN baseline_turn_count INTEGER NOT NULL DEFAULT 0 CHECK (baseline_turn_count BETWEEN 0 AND 3);
ALTER TABLE planning_sessions ADD COLUMN requirements_turn_count INTEGER NOT NULL DEFAULT 0 CHECK (requirements_turn_count BETWEEN 0 AND 5);
ALTER TABLE planning_sessions ADD COLUMN active_assessment_id TEXT;
ALTER TABLE planning_sessions ADD COLUMN active_requirement_brief_id TEXT;
UPDATE planning_sessions
SET stage = CASE
  WHEN status = 'confirmed' THEN 'confirmed'
  WHEN status = 'proposed' THEN 'proposed'
  ELSE 'baseline'
END
WHERE status IN ('confirmed', 'proposed') OR stage IS NULL OR stage = '';
UPDATE planning_sessions
SET baseline_turn_count = MIN(3, (SELECT COUNT(*) FROM planning_messages WHERE planning_messages.session_id = planning_sessions.id AND role = 'user'));

CREATE TABLE IF NOT EXISTS planning_assessments (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES planning_sessions(id),
  learner_id TEXT NOT NULL REFERENCES learners(id),
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('preparing', 'answering', 'evaluating', 'completed', 'abandoned', 'failed', 'superseded')),
  direction TEXT NOT NULL,
  input_profile_snapshot_id TEXT,
  model TEXT NOT NULL,
  completion_mode TEXT CHECK (completion_mode IN ('complete', 'abandon')),
  failure_code TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  dimensions_json TEXT NOT NULL DEFAULT '[]',
  evaluation_json TEXT,
  error_message TEXT,
  client_request_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(session_id, version),
  UNIQUE(session_id, client_request_id)
);
CREATE INDEX IF NOT EXISTS idx_planning_assessments_session_updated ON planning_assessments(session_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS planning_assessment_questions (
  id TEXT PRIMARY KEY,
  assessment_id TEXT NOT NULL REFERENCES planning_assessments(id),
  position INTEGER NOT NULL,
  dimension_key TEXT NOT NULL,
  question_type TEXT NOT NULL CHECK (question_type IN ('single_choice', 'multiple_choice', 'short_text', 'scenario')),
  difficulty TEXT NOT NULL DEFAULT 'foundation' CHECK (difficulty IN ('foundation', 'applied', 'advanced')),
  prompt TEXT NOT NULL,
  options_json TEXT NOT NULL DEFAULT '[]',
  rubric_json TEXT NOT NULL,
  reference_answer_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(assessment_id, position)
);
CREATE INDEX IF NOT EXISTS idx_planning_assessment_questions_assessment_position ON planning_assessment_questions(assessment_id, position);

CREATE TABLE IF NOT EXISTS planning_assessment_answers (
  id TEXT PRIMARY KEY,
  assessment_id TEXT NOT NULL REFERENCES planning_assessments(id),
  question_id TEXT NOT NULL REFERENCES planning_assessment_questions(id),
  value_json TEXT,
  skipped INTEGER NOT NULL DEFAULT 0 CHECK (skipped IN (0, 1)),
  answer_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(assessment_id, question_id)
);
CREATE TABLE IF NOT EXISTS planning_assessment_answer_batches (
  id TEXT PRIMARY KEY,
  assessment_id TEXT NOT NULL REFERENCES planning_assessments(id),
  client_request_id TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(assessment_id, client_request_id)
);

CREATE TABLE IF NOT EXISTS planning_requirement_briefs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES planning_sessions(id),
  learner_id TEXT NOT NULL REFERENCES learners(id),
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'confirmed', 'superseded')),
  content_json TEXT NOT NULL,
  confirmed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(session_id, version)
);
CREATE INDEX IF NOT EXISTS idx_planning_requirement_briefs_session_updated ON planning_requirement_briefs(session_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS planning_requirement_turns (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES planning_sessions(id),
  position INTEGER NOT NULL,
  message TEXT NOT NULL,
  client_request_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(session_id, position),
  UNIQUE(session_id, client_request_id)
);

-- SQLite cannot broaden CHECK constraints in place.  Rebuild only these two
-- append-only tables, copying every pre-existing row verbatim.
ALTER TABLE planning_agent_invocations RENAME TO planning_agent_invocations_054;
CREATE TABLE planning_agent_invocations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES planning_sessions(id),
  learner_id TEXT NOT NULL REFERENCES learners(id),
  client_request_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('planner', 'profile_interpreter', 'assessment_generator', 'assessment_evaluator', 'requirements_generator')),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'interrupted')),
  input_fingerprint TEXT NOT NULL,
  failure_code TEXT,
  failure_message TEXT,
  latency_ms INTEGER,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(session_id, client_request_id, kind)
);
INSERT INTO planning_agent_invocations SELECT * FROM planning_agent_invocations_054;
DROP TABLE planning_agent_invocations_054;
DROP INDEX IF EXISTS idx_planning_invocations_session_created;
CREATE INDEX IF NOT EXISTS idx_planning_invocations_session_created ON planning_agent_invocations(session_id, created_at DESC);

ALTER TABLE learner_profile_evidence RENAME TO learner_profile_evidence_054;
CREATE TABLE learner_profile_evidence (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL REFERENCES learner_profile_snapshots(id),
  topic_key TEXT,
  source_type TEXT NOT NULL CHECK (source_type IN ('user_message', 'resume', 'reading', 'concept', 'lab', 'workspace', 'workspace_verification', 'diagnostic_assessment')),
  source_id TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  created_at TEXT NOT NULL
);
INSERT INTO learner_profile_evidence SELECT * FROM learner_profile_evidence_054;
DROP TABLE learner_profile_evidence_054;
DROP INDEX IF EXISTS idx_profile_evidence_snapshot_topic;
CREATE INDEX IF NOT EXISTS idx_profile_evidence_snapshot_topic ON learner_profile_evidence(snapshot_id, topic_key, created_at DESC);
