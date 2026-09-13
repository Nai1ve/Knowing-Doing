CREATE TABLE IF NOT EXISTS learner_sessions (
  id TEXT PRIMARY KEY, learner_id TEXT NOT NULL REFERENCES learners(id), csrf_token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL, created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_learner_sessions_expiry ON learner_sessions(expires_at);
CREATE TABLE IF NOT EXISTS oauth_authorization_states (
  id TEXT PRIMARY KEY, learner_id TEXT NOT NULL REFERENCES learners(id), provider TEXT NOT NULL,
  state_hash TEXT NOT NULL UNIQUE, redirect_uri TEXT NOT NULL, expires_at TEXT NOT NULL,
  consumed_at TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oauth_states_lookup ON oauth_authorization_states(provider, state_hash, expires_at);
CREATE TABLE IF NOT EXISTS provider_connections (
  id TEXT PRIMARY KEY, learner_id TEXT NOT NULL REFERENCES learners(id), provider TEXT NOT NULL,
  provider_user_id TEXT, token_ciphertext TEXT NOT NULL, token_iv TEXT NOT NULL, token_tag TEXT NOT NULL,
  token_expires_at TEXT, scopes_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','reauthorization_required')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(learner_id, provider)
);
CREATE TABLE IF NOT EXISTS external_source_collections (
  id TEXT PRIMARY KEY, learner_id TEXT NOT NULL REFERENCES learners(id), connection_id TEXT REFERENCES provider_connections(id),
  provider TEXT NOT NULL, external_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, cursor TEXT,
  status TEXT NOT NULL DEFAULT 'active', metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(learner_id, provider, external_id, kind)
);
CREATE TABLE IF NOT EXISTS learner_source_items (
  id TEXT PRIMARY KEY, learner_id TEXT NOT NULL REFERENCES learners(id), provider TEXT NOT NULL, external_id TEXT NOT NULL,
  url TEXT NOT NULL, title TEXT NOT NULL, author TEXT, excerpt TEXT NOT NULL DEFAULT '', content_json TEXT NOT NULL DEFAULT '{}',
  visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','public')), content_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','removed')),
  saved INTEGER NOT NULL DEFAULT 1 CHECK(saved IN (0,1)), tags_json TEXT NOT NULL DEFAULT '[]',
  published_at TEXT, removed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(learner_id, provider, external_id)
);
CREATE TABLE IF NOT EXISTS external_source_collection_items (
  collection_id TEXT NOT NULL REFERENCES external_source_collections(id), source_item_id TEXT NOT NULL REFERENCES learner_source_items(id),
  position INTEGER, created_at TEXT NOT NULL, PRIMARY KEY(collection_id, source_item_id)
);
CREATE TABLE IF NOT EXISTS source_sync_jobs (
  id TEXT PRIMARY KEY, learner_id TEXT NOT NULL REFERENCES learners(id), collection_id TEXT REFERENCES external_source_collections(id),
  provider TEXT NOT NULL, sync_kind TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','running','completed','failed')),
  cursor TEXT, client_request_id TEXT, imported_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0, error_code TEXT, error_message TEXT,
  started_at TEXT, completed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(learner_id, provider, client_request_id)
);
