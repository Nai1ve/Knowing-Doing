ALTER TABLE roadmap_generation_runs
  ADD COLUMN diagnostics_json TEXT NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_roadmap_generation_session_created
  ON roadmap_generation_runs(planning_session_id, created_at DESC);
