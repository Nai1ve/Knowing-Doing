CREATE INDEX IF NOT EXISTS idx_planning_context_items_snapshot_order
  ON planning_context_items(snapshot_id, importance DESC, updated_at DESC);
