CREATE INDEX IF NOT EXISTS idx_roadmap_nodes_roadmap_position
  ON roadmap_nodes(roadmap_id, position);
