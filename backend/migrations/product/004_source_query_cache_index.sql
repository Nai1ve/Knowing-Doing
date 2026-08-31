CREATE INDEX IF NOT EXISTS idx_sources_provider_query_retrieved
  ON source_items(provider, query, retrieved_at DESC);
