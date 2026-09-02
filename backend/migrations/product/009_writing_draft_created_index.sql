CREATE INDEX IF NOT EXISTS idx_writing_draft_runs_project_created
  ON writing_draft_runs(project_id, created_at DESC);
