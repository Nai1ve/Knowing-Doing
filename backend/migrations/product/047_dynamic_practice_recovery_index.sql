CREATE INDEX IF NOT EXISTS idx_practice_runs_learner_unit_case_status
  ON practice_runs(learner_id, plan_unit_id, learning_case_id, status, updated_at DESC);
