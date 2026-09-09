CREATE TABLE IF NOT EXISTS workspace_completion_evaluations (
  id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learners(id),
  workspace_run_id TEXT NOT NULL REFERENCES workspace_runs(id),
  practice_run_id TEXT NOT NULL REFERENCES practice_runs(id),
  learning_case_id TEXT NOT NULL REFERENCES learning_cases(id),
  execution_id TEXT NOT NULL REFERENCES workspace_executions(id),
  input_fingerprint TEXT NOT NULL,
  evaluator_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'not_matched', 'verified', 'superseded')),
  matched_signals_json TEXT NOT NULL DEFAULT '[]',
  missing_signals_json TEXT NOT NULL DEFAULT '[]',
  artifact_refs_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  verified_at TEXT,
  UNIQUE(workspace_run_id, input_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_workspace_completion_run_status_updated
  ON workspace_completion_evaluations(workspace_run_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workspace_completion_practice_status_updated
  ON workspace_completion_evaluations(practice_run_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workspace_completion_status_updated
  ON workspace_completion_evaluations(status, updated_at ASC, workspace_run_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_completion_verified_practice
  ON workspace_completion_evaluations(practice_run_id)
  WHERE status = 'verified';

CREATE TABLE IF NOT EXISTS learner_profile_evidence_v028 (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL REFERENCES learner_profile_snapshots(id),
  topic_key TEXT,
  source_type TEXT NOT NULL CHECK (source_type IN ('user_message', 'resume', 'reading', 'concept', 'lab', 'workspace_verification')),
  source_id TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  created_at TEXT NOT NULL
);

INSERT INTO learner_profile_evidence_v028(id, snapshot_id, topic_key, source_type, source_id, excerpt, created_at)
SELECT id, snapshot_id, topic_key, source_type, source_id, excerpt, created_at
FROM learner_profile_evidence;

DROP TABLE learner_profile_evidence;
ALTER TABLE learner_profile_evidence_v028 RENAME TO learner_profile_evidence;

CREATE INDEX IF NOT EXISTS idx_profile_evidence_snapshot_topic
  ON learner_profile_evidence(snapshot_id, topic_key, created_at DESC);
