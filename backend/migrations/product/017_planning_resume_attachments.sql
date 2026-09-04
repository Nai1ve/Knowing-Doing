CREATE TABLE IF NOT EXISTS planning_resume_attachments (
  id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learners(id),
  planning_session_id TEXT NOT NULL REFERENCES planning_sessions(id),
  original_filename TEXT NOT NULL,
  stored_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(planning_session_id)
);

CREATE INDEX IF NOT EXISTS idx_planning_resume_session_learner
  ON planning_resume_attachments(planning_session_id, learner_id);
