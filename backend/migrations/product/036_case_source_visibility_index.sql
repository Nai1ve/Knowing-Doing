CREATE INDEX IF NOT EXISTS idx_knowledge_route_items_source_route
  ON knowledge_route_items(source_item_id, route_set_id);
