ALTER TABLE planning_resume_attachments ADD COLUMN parse_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE planning_resume_attachments ADD COLUMN page_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE planning_resume_attachments ADD COLUMN text_length INTEGER NOT NULL DEFAULT 0;
ALTER TABLE planning_resume_attachments ADD COLUMN extracted_text TEXT NOT NULL DEFAULT '';
ALTER TABLE planning_resume_attachments ADD COLUMN parse_error TEXT;

CREATE INDEX IF NOT EXISTS idx_planning_resume_parse_status
  ON planning_resume_attachments(planning_session_id, parse_status);
