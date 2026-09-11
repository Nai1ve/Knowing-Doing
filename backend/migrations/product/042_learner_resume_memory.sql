CREATE TABLE IF NOT EXISTS learner_resume_documents (
  id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learners(id),
  original_filename TEXT NOT NULL,
  stored_filename TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type = 'application/pdf'),
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  parse_status TEXT NOT NULL CHECK (parse_status IN ('pending', 'ready', 'failed')),
  page_count INTEGER NOT NULL DEFAULT 0,
  text_length INTEGER NOT NULL DEFAULT 0,
  extracted_text TEXT NOT NULL DEFAULT '',
  parse_error TEXT,
  version INTEGER NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(learner_id, version)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_learner_resume_one_current
  ON learner_resume_documents(learner_id)
  WHERE is_current = 1;
CREATE INDEX IF NOT EXISTS idx_learner_resume_current_updated
  ON learner_resume_documents(learner_id, is_current, updated_at DESC);

CREATE TABLE IF NOT EXISTS learner_resume_chunks (
  id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learners(id),
  document_id TEXT NOT NULL REFERENCES learner_resume_documents(id),
  position INTEGER NOT NULL,
  content TEXT NOT NULL,
  checksum TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(document_id, position)
);
CREATE INDEX IF NOT EXISTS idx_resume_chunks_document_position
  ON learner_resume_chunks(document_id, position);

CREATE TABLE IF NOT EXISTS planning_session_resume_refs (
  id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learners(id),
  session_id TEXT NOT NULL REFERENCES planning_sessions(id),
  document_id TEXT NOT NULL REFERENCES learner_resume_documents(id),
  document_version INTEGER NOT NULL,
  client_request_id TEXT,
  status TEXT NOT NULL DEFAULT 'current' CHECK (status IN ('current', 'superseded')),
  included_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(session_id, client_request_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_session_resume_one_current
  ON planning_session_resume_refs(session_id)
  WHERE status = 'current';
CREATE INDEX IF NOT EXISTS idx_session_resume_session
  ON planning_session_resume_refs(session_id, status);

INSERT OR IGNORE INTO learner_resume_documents (
  id, learner_id, original_filename, stored_filename, mime_type, size_bytes, sha256,
  parse_status, page_count, text_length, extracted_text, parse_error, version,
  is_current, created_at, updated_at
)
SELECT
  p.id, p.learner_id, p.original_filename, p.stored_filename, p.mime_type, p.size_bytes, p.sha256,
  p.parse_status, p.page_count, p.text_length, p.extracted_text, p.parse_error,
  1, 0, p.created_at, p.updated_at
FROM planning_resume_attachments p;

UPDATE learner_resume_documents
SET is_current = 1
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY learner_id ORDER BY updated_at DESC, id DESC) AS rank
    FROM learner_resume_documents
  ) ranked
  WHERE rank = 1
);

INSERT OR IGNORE INTO planning_session_resume_refs (
  id, learner_id, session_id, document_id, document_version, client_request_id,
  status, included_at, created_at
)
SELECT
  lower(hex(randomblob(16))), p.learner_id, p.planning_session_id, p.id, 1, NULL,
  'current', p.updated_at, p.created_at
FROM planning_resume_attachments p;
