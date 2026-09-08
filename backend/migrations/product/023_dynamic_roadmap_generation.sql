ALTER TABLE roadmap_generation_runs ADD COLUMN client_request_id TEXT;
ALTER TABLE roadmap_generation_runs ADD COLUMN input_snapshot_json TEXT NOT NULL DEFAULT '{}';

CREATE UNIQUE INDEX IF NOT EXISTS idx_roadmap_generation_client_request
  ON roadmap_generation_runs(learner_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS roadmap_generation_steps (
  id TEXT PRIMARY KEY,
  generation_run_id TEXT NOT NULL REFERENCES roadmap_generation_runs(id),
  phase TEXT NOT NULL CHECK (phase IN ('domain', 'module', 'unit', 'critic')),
  input_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  output_json TEXT NOT NULL DEFAULT '{}',
  failure_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(generation_run_id, phase)
);
CREATE INDEX IF NOT EXISTS idx_roadmap_generation_steps_run_phase
  ON roadmap_generation_steps(generation_run_id, phase);

CREATE TABLE IF NOT EXISTS roadmap_node_evidence (
  id TEXT PRIMARY KEY,
  roadmap_id TEXT NOT NULL REFERENCES learning_roadmaps(id),
  node_id TEXT NOT NULL REFERENCES roadmap_nodes(id),
  source_type TEXT NOT NULL CHECK (source_type IN ('planning_context', 'planning_message', 'resume')),
  source_id TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(roadmap_id, node_id, source_type, source_id)
);
CREATE INDEX IF NOT EXISTS idx_roadmap_node_evidence_node_position
  ON roadmap_node_evidence(roadmap_id, node_id, position);
