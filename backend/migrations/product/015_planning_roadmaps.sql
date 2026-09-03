CREATE TABLE IF NOT EXISTS planning_sessions (
  id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learners(id),
  template_key TEXT NOT NULL,
  goal TEXT NOT NULL,
  status TEXT NOT NULL,
  current_step INTEGER NOT NULL DEFAULT 0,
  answers_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1,
  client_request_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(learner_id, client_request_id)
);
CREATE INDEX IF NOT EXISTS idx_planning_sessions_learner_status_updated
  ON planning_sessions(learner_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS planning_session_turns (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES planning_sessions(id),
  sequence INTEGER NOT NULL,
  step_key TEXT NOT NULL,
  prompt TEXT NOT NULL,
  answer TEXT NOT NULL,
  structured_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(session_id, sequence),
  UNIQUE(session_id, step_key)
);
CREATE INDEX IF NOT EXISTS idx_planning_turns_session_sequence
  ON planning_session_turns(session_id, sequence);

CREATE TABLE IF NOT EXISTS learning_roadmaps (
  id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learners(id),
  template_key TEXT NOT NULL,
  goal TEXT NOT NULL,
  status TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  input_snapshot_json TEXT NOT NULL DEFAULT '{}',
  based_on_roadmap_id TEXT REFERENCES learning_roadmaps(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_roadmaps_learner_status_updated
  ON learning_roadmaps(learner_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS roadmap_nodes (
  id TEXT PRIMARY KEY,
  roadmap_id TEXT NOT NULL REFERENCES learning_roadmaps(id),
  parent_id TEXT REFERENCES roadmap_nodes(id),
  node_key TEXT NOT NULL,
  node_type TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  knowledge_card_json TEXT NOT NULL DEFAULT '{}',
  completion_standard TEXT NOT NULL,
  estimated_minutes INTEGER NOT NULL,
  priority INTEGER NOT NULL,
  position INTEGER NOT NULL,
  learning_mode TEXT NOT NULL,
  case_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(roadmap_id, node_key)
);
CREATE INDEX IF NOT EXISTS idx_roadmap_nodes_parent_position
  ON roadmap_nodes(roadmap_id, parent_id, position);

CREATE TABLE IF NOT EXISTS roadmap_node_dependencies (
  roadmap_id TEXT NOT NULL REFERENCES learning_roadmaps(id),
  node_id TEXT NOT NULL REFERENCES roadmap_nodes(id),
  depends_on_node_id TEXT NOT NULL REFERENCES roadmap_nodes(id),
  PRIMARY KEY(roadmap_id, node_id, depends_on_node_id)
);

CREATE TABLE IF NOT EXISTS roadmap_node_progress (
  roadmap_id TEXT NOT NULL REFERENCES learning_roadmaps(id),
  node_id TEXT NOT NULL REFERENCES roadmap_nodes(id),
  status TEXT NOT NULL,
  source TEXT NOT NULL,
  completed_at TEXT,
  verified_at TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(roadmap_id, node_id)
);
CREATE INDEX IF NOT EXISTS idx_roadmap_progress_roadmap_status
  ON roadmap_node_progress(roadmap_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS roadmap_events (
  id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learners(id),
  roadmap_id TEXT NOT NULL REFERENCES learning_roadmaps(id),
  node_id TEXT REFERENCES roadmap_nodes(id),
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_roadmap_events_roadmap_created
  ON roadmap_events(roadmap_id, created_at DESC, id DESC);

ALTER TABLE learning_plans ADD COLUMN roadmap_id TEXT REFERENCES learning_roadmaps(id);
ALTER TABLE plan_units ADD COLUMN roadmap_node_id TEXT REFERENCES roadmap_nodes(id);
CREATE INDEX IF NOT EXISTS idx_plans_roadmap ON learning_plans(roadmap_id);
CREATE INDEX IF NOT EXISTS idx_plan_units_roadmap_node ON plan_units(roadmap_node_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_plans_active_template_pending
  ON learning_plans(learner_id, template_key)
  WHERE status IN ('confirmed', 'active', 'pending_content');
