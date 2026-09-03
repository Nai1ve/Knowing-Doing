CREATE UNIQUE INDEX IF NOT EXISTS idx_plans_active_template_pending
  ON learning_plans(learner_id, template_key)
  WHERE status IN ('confirmed', 'active', 'pending_content');
