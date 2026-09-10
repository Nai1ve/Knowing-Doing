CREATE INDEX IF NOT EXISTS idx_case_jobs_status_updated
  ON case_generation_jobs(status, updated_at);
