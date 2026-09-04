ALTER TABLE planning_sessions ADD COLUMN mode TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE planning_sessions ADD COLUMN agent_status TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE planning_sessions ADD COLUMN profile_snapshot_id TEXT;

CREATE TABLE IF NOT EXISTS planning_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES planning_sessions(id),
  sequence INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  client_request_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(session_id, sequence),
  UNIQUE(session_id, client_request_id)
);
CREATE INDEX IF NOT EXISTS idx_planning_messages_session_sequence
  ON planning_messages(session_id, sequence);

CREATE TABLE IF NOT EXISTS planning_required_topics (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES planning_sessions(id),
  topic_key TEXT NOT NULL,
  label TEXT NOT NULL,
  priority INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('unknown', 'covered', 'needs_follow_up')),
  evidence_refs_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  UNIQUE(session_id, topic_key)
);
CREATE INDEX IF NOT EXISTS idx_planning_topics_session_status
  ON planning_required_topics(session_id, status, priority);

CREATE TABLE IF NOT EXISTS learner_profile_snapshots (
  id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learners(id),
  planning_session_id TEXT REFERENCES planning_sessions(id),
  version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'current', 'superseded')),
  input_fingerprint TEXT NOT NULL,
  summary_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(learner_id, version)
);
CREATE INDEX IF NOT EXISTS idx_profile_snapshots_learner_created
  ON learner_profile_snapshots(learner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS learner_profile_dimensions (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL REFERENCES learner_profile_snapshots(id),
  dimension_key TEXT NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('unknown', 'exposed', 'applied', 'independent', 'advanced')),
  confidence REAL NOT NULL,
  summary TEXT NOT NULL,
  next_validation TEXT NOT NULL,
  UNIQUE(snapshot_id, dimension_key)
);

CREATE TABLE IF NOT EXISTS learner_profile_evidence (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL REFERENCES learner_profile_snapshots(id),
  topic_key TEXT,
  source_type TEXT NOT NULL CHECK (source_type IN ('user_message', 'resume', 'reading', 'concept', 'lab')),
  source_id TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_profile_evidence_snapshot_topic
  ON learner_profile_evidence(snapshot_id, topic_key, created_at DESC);

CREATE TABLE IF NOT EXISTS planning_agent_invocations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES planning_sessions(id),
  learner_id TEXT NOT NULL REFERENCES learners(id),
  client_request_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('planner', 'profile_interpreter')),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'interrupted')),
  input_fingerprint TEXT NOT NULL,
  failure_code TEXT,
  failure_message TEXT,
  latency_ms INTEGER,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(session_id, client_request_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_planning_invocations_session_created
  ON planning_agent_invocations(session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS roadmap_generation_runs (
  id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learners(id),
  planning_session_id TEXT NOT NULL REFERENCES planning_sessions(id),
  input_fingerprint TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('domain', 'module', 'unit', 'critic', 'completed', 'failed')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'interrupted')),
  roadmap_id TEXT,
  failure_code TEXT,
  failure_message TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(learner_id, input_fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_roadmap_generation_learner_status
  ON roadmap_generation_runs(learner_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS knowledge_route_sets (
  id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learners(id),
  roadmap_node_id TEXT NOT NULL REFERENCES roadmap_nodes(id),
  profile_snapshot_id TEXT,
  query_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'ready', 'failed')),
  research_json TEXT NOT NULL DEFAULT '{}',
  failure_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(roadmap_node_id, profile_snapshot_id, query_fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_knowledge_routes_node_status
  ON knowledge_route_sets(roadmap_node_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS knowledge_route_items (
  id TEXT PRIMARY KEY,
  route_set_id TEXT NOT NULL REFERENCES knowledge_route_sets(id),
  source_item_id TEXT NOT NULL REFERENCES source_items(id),
  position INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('foundation', 'case', 'extension')),
  reason TEXT NOT NULL,
  learning_question TEXT NOT NULL,
  UNIQUE(route_set_id, source_item_id)
);
CREATE INDEX IF NOT EXISTS idx_knowledge_route_items_set_position
  ON knowledge_route_items(route_set_id, position);

CREATE TABLE IF NOT EXISTS knowledge_route_feedback (
  id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learners(id),
  route_set_id TEXT NOT NULL REFERENCES knowledge_route_sets(id),
  source_item_id TEXT NOT NULL REFERENCES source_items(id),
  feedback TEXT NOT NULL CHECK (feedback IN ('read', 'too_hard', 'too_easy', 'irrelevant', 'helpful')),
  created_at TEXT NOT NULL,
  UNIQUE(learner_id, route_set_id, source_item_id, feedback)
);
CREATE INDEX IF NOT EXISTS idx_knowledge_feedback_route_created
  ON knowledge_route_feedback(route_set_id, created_at DESC);
