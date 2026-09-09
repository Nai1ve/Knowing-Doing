CREATE INDEX IF NOT EXISTS idx_workspace_completion_status_updated
  ON workspace_completion_evaluations(status, updated_at ASC, workspace_run_id);
