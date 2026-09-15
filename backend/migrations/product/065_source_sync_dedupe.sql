-- Completion plan P4.1: triple-dedupe lookups for the source sync path.
-- external_id is already a UNIQUE index on learner_source_items; these indexes
-- make the canonical-URL and content-hash legs of the dedupe rule fast without
-- requiring unique constraints that an existing database could violate.
CREATE INDEX IF NOT EXISTS idx_learner_source_items_url
  ON learner_source_items(learner_id, provider, url);
CREATE INDEX IF NOT EXISTS idx_learner_source_items_hash
  ON learner_source_items(learner_id, provider, content_hash);
