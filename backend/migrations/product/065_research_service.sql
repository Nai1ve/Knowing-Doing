-- Completion plan P4: research object model persistence + source sync dedupe indexes.
-- The frozen ResearchQuery / ResearchCandidate / ResearchCacheRecord types in
-- product-types.ts are persisted here. Every research row is scoped to a
-- learner so public searches and private favorites can never leak across
-- learners. Candidate dedupe (content hash + canonical URL) is enforced in the
-- service before persistence; the indexes below make those lookups fast.

CREATE TABLE IF NOT EXISTS research_queries (
  id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learners(id),
  planning_session_id TEXT REFERENCES planning_sessions(id),
  roadmap_node_id TEXT REFERENCES roadmap_nodes(id),
  provider TEXT NOT NULL CHECK (provider IN ('user_source','zhihu_search','global_search','question_recommendation','direct_answer')),
  query TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','failed','rate_limited')),
  requested_at TEXT NOT NULL,
  completed_at TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_queries_learner_requested
  ON research_queries(learner_id, requested_at DESC);

CREATE TABLE IF NOT EXISTS research_candidates (
  id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learners(id),
  query_id TEXT REFERENCES research_queries(id),
  provider TEXT NOT NULL CHECK (provider IN ('user_source','zhihu_search','global_search','question_recommendation','direct_answer')),
  external_id TEXT,
  canonical_url TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  title TEXT NOT NULL,
  author TEXT,
  excerpt TEXT NOT NULL DEFAULT '',
  summary TEXT,
  fetched_at TEXT NOT NULL,
  credibility REAL NOT NULL,
  relevance REAL NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','private')),
  retrieval_evidence_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_candidates_learner_fetched
  ON research_candidates(learner_id, fetched_at DESC);
CREATE INDEX IF NOT EXISTS idx_research_candidates_hash
  ON research_candidates(learner_id, content_hash);
CREATE INDEX IF NOT EXISTS idx_research_candidates_url
  ON research_candidates(learner_id, canonical_url);

CREATE TABLE IF NOT EXISTS research_query_cache (
  id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learners(id),
  provider TEXT NOT NULL,
  query TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  candidate_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  UNIQUE(learner_id, provider, fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_research_query_cache_expiry
  ON research_query_cache(learner_id, provider, expires_at);
