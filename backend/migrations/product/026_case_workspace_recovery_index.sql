CREATE INDEX IF NOT EXISTS idx_workspace_runs_status_updated
  ON workspace_runs(status, updated_at DESC);
