ALTER TABLE learning_cases ADD COLUMN case_design_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE case_generation_attempts ADD COLUMN raw_output_json TEXT;
ALTER TABLE case_generation_attempts ADD COLUMN validation_issues_json TEXT NOT NULL DEFAULT '[]';

CREATE INDEX IF NOT EXISTS idx_case_attempts_job_phase
  ON case_generation_attempts(case_generation_job_id, phase, attempt_number DESC);
