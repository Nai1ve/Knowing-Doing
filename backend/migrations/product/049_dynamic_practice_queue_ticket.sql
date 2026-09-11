ALTER TABLE practice_runs ADD COLUMN runtime_queue_ticket_id TEXT;
ALTER TABLE practice_runs ADD COLUMN runtime_queue_expires_at TEXT;

CREATE INDEX IF NOT EXISTS idx_practice_runs_dynamic_queue
  ON practice_runs(learner_id, plan_unit_id, learning_case_id, runtime_queue_ticket_id, updated_at DESC);
