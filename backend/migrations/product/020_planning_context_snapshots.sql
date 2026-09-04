CREATE TABLE IF NOT EXISTS planning_context_snapshots (
  id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learners(id),
  session_id TEXT NOT NULL REFERENCES planning_sessions(id),
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('current', 'superseded')),
  input_fingerprint TEXT NOT NULL,
  goal TEXT NOT NULL,
  current_focus TEXT NOT NULL,
  packet_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(session_id, version)
);
CREATE INDEX IF NOT EXISTS idx_planning_context_learner_status
  ON planning_context_snapshots(learner_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_planning_context_session_version
  ON planning_context_snapshots(session_id, version DESC);

CREATE TABLE IF NOT EXISTS planning_context_items (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL REFERENCES planning_context_snapshots(id),
  item_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('explicit', 'confirmed', 'inferred', 'open', 'superseded')),
  confidence REAL NOT NULL DEFAULT 0,
  importance INTEGER NOT NULL DEFAULT 1,
  source_refs_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(snapshot_id, item_key)
);
CREATE INDEX IF NOT EXISTS idx_planning_context_items_snapshot
  ON planning_context_items(snapshot_id, status, importance DESC, updated_at DESC);
