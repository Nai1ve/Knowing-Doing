ALTER TABLE learner_resume_documents ADD COLUMN parse_lease_token TEXT;
CREATE INDEX idx_learner_resume_parse_fence ON learner_resume_documents(id, parse_lease_token);
