CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS learners (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS intakes (
  id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learners(id),
  goal TEXT NOT NULL,
  technology TEXT NOT NULL,
  outcome TEXT,
  weekly_minutes INTEGER,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_intakes_learner_created ON intakes(learner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS learning_plans (
  id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learners(id),
  intake_id TEXT NOT NULL REFERENCES intakes(id),
  title TEXT NOT NULL,
  goal TEXT NOT NULL,
  source_status TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plans_learner_updated ON learning_plans(learner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS plan_units (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES learning_plans(id),
  position INTEGER NOT NULL,
  title TEXT NOT NULL,
  objective TEXT NOT NULL,
  case_id TEXT,
  status TEXT NOT NULL,
  source_refs_json TEXT NOT NULL,
  UNIQUE(plan_id, position)
);

CREATE TABLE IF NOT EXISTS practice_runs (
  id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learners(id),
  plan_unit_id TEXT REFERENCES plan_units(id),
  case_id TEXT NOT NULL,
  lab_run_id TEXT,
  stage TEXT NOT NULL,
  hint_level INTEGER NOT NULL DEFAULT 0,
  no_progress_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runs_learner_updated ON practice_runs(learner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_lab_run ON practice_runs(lab_run_id);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learners(id),
  practice_run_id TEXT REFERENCES practice_runs(id),
  kind TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  verification_status TEXT NOT NULL,
  content TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  checksum TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_artifacts_run_created ON artifacts(practice_run_id, created_at DESC);

CREATE TABLE IF NOT EXISTS practice_events (
  id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learners(id),
  practice_run_id TEXT NOT NULL REFERENCES practice_runs(id),
  sequence INTEGER NOT NULL,
  actor TEXT NOT NULL,
  type TEXT NOT NULL,
  stage TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  artifact_refs_json TEXT NOT NULL,
  client_request_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(practice_run_id, sequence),
  UNIQUE(practice_run_id, client_request_id)
);
CREATE INDEX IF NOT EXISTS idx_events_run_sequence ON practice_events(practice_run_id, sequence);
CREATE INDEX IF NOT EXISTS idx_events_run_type ON practice_events(practice_run_id, type, sequence);

CREATE TABLE IF NOT EXISTS path_nodes (
  id TEXT PRIMARY KEY,
  practice_run_id TEXT NOT NULL REFERENCES practice_runs(id),
  stage TEXT NOT NULL,
  title TEXT NOT NULL,
  judgment TEXT NOT NULL,
  outcome TEXT NOT NULL,
  judgment_change TEXT,
  next_gap TEXT,
  importance TEXT NOT NULL,
  event_refs_json TEXT NOT NULL,
  artifact_refs_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_path_nodes_run_created ON path_nodes(practice_run_id, created_at);

CREATE TABLE IF NOT EXISTS stage_memories (
  id TEXT PRIMARY KEY,
  practice_run_id TEXT NOT NULL REFERENCES practice_runs(id),
  stage TEXT NOT NULL,
  memory_json TEXT NOT NULL,
  source_event_refs_json TEXT NOT NULL,
  version INTEGER NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(practice_run_id, stage)
);

CREATE TABLE IF NOT EXISTS memory_items (
  id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learners(id),
  category TEXT NOT NULL,
  topic TEXT NOT NULL,
  status TEXT NOT NULL,
  statement TEXT NOT NULL,
  scope TEXT NOT NULL,
  confidence REAL NOT NULL,
  evidence_refs_json TEXT NOT NULL,
  user_note TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memory_learner_topic ON memory_items(learner_id, category, topic, updated_at DESC);

CREATE TABLE IF NOT EXISTS source_items (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  external_id TEXT,
  title TEXT NOT NULL,
  author TEXT,
  url TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  query TEXT,
  retrieved_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  UNIQUE(provider, external_id)
);
CREATE INDEX IF NOT EXISTS idx_sources_provider_retrieved ON source_items(provider, retrieved_at DESC);

CREATE TABLE IF NOT EXISTS tutor_turns (
  id TEXT PRIMARY KEY,
  practice_run_id TEXT NOT NULL REFERENCES practice_runs(id),
  user_artifact_id TEXT REFERENCES artifacts(id),
  assistant_artifact_id TEXT REFERENCES artifacts(id),
  mode TEXT NOT NULL,
  provider TEXT NOT NULL,
  source_status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tutor_turns_run_created ON tutor_turns(practice_run_id, created_at);
