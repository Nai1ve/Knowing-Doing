CREATE TABLE IF NOT EXISTS case_source_snapshots (
  id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learners(id),
  source_item_id TEXT NOT NULL REFERENCES source_items(id),
  provider TEXT NOT NULL,
  external_id TEXT,
  source_url TEXT NOT NULL,
  title TEXT NOT NULL,
  author TEXT,
  content_markdown TEXT NOT NULL DEFAULT '',
  content_checksum TEXT NOT NULL DEFAULT '',
  content_length INTEGER NOT NULL DEFAULT 0,
  extraction_status TEXT NOT NULL CHECK (extraction_status IN ('pending', 'ready', 'failed')),
  extraction_error TEXT,
  retrieved_at TEXT NOT NULL,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(learner_id, source_item_id, content_checksum)
);

CREATE INDEX IF NOT EXISTS idx_case_source_snapshots_learner_source_retrieved
  ON case_source_snapshots(learner_id, source_item_id, retrieved_at DESC);

ALTER TABLE learning_cases ADD COLUMN source_snapshot_id TEXT REFERENCES case_source_snapshots(id);

CREATE INDEX IF NOT EXISTS idx_learning_cases_source_snapshot
  ON learning_cases(source_snapshot_id);
