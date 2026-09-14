-- product-migrate: foreign-key-rebuild
-- Extend the historical CHECK constraint without dropping documents or refs.
ALTER TABLE learner_resume_chunks RENAME TO learner_resume_chunks_061_old;
ALTER TABLE planning_session_resume_refs RENAME TO planning_session_resume_refs_061_old;
ALTER TABLE learner_resume_documents RENAME TO learner_resume_documents_061_old;
CREATE TABLE learner_resume_documents (
  id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learners(id),
  original_filename TEXT NOT NULL,
  stored_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type = 'application/pdf'),
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  parse_status TEXT NOT NULL CHECK (parse_status IN ('pending','processing','ready','failed')),
  page_count INTEGER NOT NULL DEFAULT 0,
  text_length INTEGER NOT NULL DEFAULT 0,
  extracted_text TEXT NOT NULL DEFAULT '',
  parse_error TEXT,
  parse_lease_until TEXT,
  version INTEGER NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(learner_id, version)
);
INSERT INTO learner_resume_documents(id,learner_id,original_filename,stored_filename,mime_type,size_bytes,sha256,parse_status,page_count,text_length,extracted_text,parse_error,version,is_current,created_at,updated_at)
SELECT id,learner_id,original_filename,stored_filename,mime_type,size_bytes,sha256,parse_status,page_count,text_length,extracted_text,parse_error,version,is_current,created_at,updated_at FROM learner_resume_documents_061_old;
CREATE TABLE learner_resume_chunks (
  id TEXT PRIMARY KEY, learner_id TEXT NOT NULL REFERENCES learners(id),
  document_id TEXT NOT NULL REFERENCES learner_resume_documents(id), position INTEGER NOT NULL,
  content TEXT NOT NULL, checksum TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(document_id, position)
);
INSERT INTO learner_resume_chunks SELECT * FROM learner_resume_chunks_061_old;
CREATE TABLE planning_session_resume_refs (
  id TEXT PRIMARY KEY, learner_id TEXT NOT NULL REFERENCES learners(id),
  session_id TEXT NOT NULL REFERENCES planning_sessions(id), document_id TEXT NOT NULL REFERENCES learner_resume_documents(id),
  document_version INTEGER NOT NULL, client_request_id TEXT, status TEXT NOT NULL DEFAULT 'current' CHECK (status IN ('current','superseded')),
  included_at TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(session_id, client_request_id)
);
INSERT INTO planning_session_resume_refs SELECT * FROM planning_session_resume_refs_061_old;
DROP TABLE learner_resume_chunks_061_old;
DROP TABLE planning_session_resume_refs_061_old;
DROP TABLE learner_resume_documents_061_old;
CREATE UNIQUE INDEX idx_learner_resume_one_current ON learner_resume_documents(learner_id) WHERE is_current = 1;
CREATE INDEX idx_learner_resume_current_updated ON learner_resume_documents(learner_id, is_current, updated_at DESC);
CREATE INDEX idx_learner_resume_parse_recovery ON learner_resume_documents(parse_status, parse_lease_until, updated_at);
CREATE INDEX idx_resume_chunks_document_position ON learner_resume_chunks(document_id, position);
CREATE UNIQUE INDEX idx_session_resume_one_current ON planning_session_resume_refs(session_id) WHERE status = 'current';
CREATE INDEX idx_session_resume_session ON planning_session_resume_refs(session_id, status);
