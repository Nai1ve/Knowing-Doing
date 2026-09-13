CREATE TABLE IF NOT EXISTS practice_cards (
  id TEXT PRIMARY KEY, learner_id TEXT NOT NULL REFERENCES learners(id), plan_unit_id TEXT NOT NULL REFERENCES plan_units(id),
  learning_case_id TEXT REFERENCES learning_cases(id), gym_build_job_id TEXT REFERENCES gym_build_jobs(id),
  intent_json TEXT NOT NULL, public_json TEXT NOT NULL, private_json TEXT NOT NULL, source_quality REAL NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('generating','ready','superseded','failed')), version INTEGER NOT NULL DEFAULT 1,
  superseded_by TEXT REFERENCES practice_cards(id), client_request_id TEXT, created_at TEXT NOT NULL, ready_at TEXT, updated_at TEXT NOT NULL,
  UNIQUE(learner_id, plan_unit_id, version), UNIQUE(learner_id, plan_unit_id, client_request_id)
);
CREATE INDEX IF NOT EXISTS idx_practice_cards_unit_status ON practice_cards(plan_unit_id, status, updated_at DESC);
ALTER TABLE plan_units ADD COLUMN practice_card_id TEXT REFERENCES practice_cards(id);
ALTER TABLE learning_cases ADD COLUMN practice_card_id TEXT REFERENCES practice_cards(id);
ALTER TABLE gym_build_jobs ADD COLUMN practice_card_id TEXT REFERENCES practice_cards(id);
CREATE INDEX IF NOT EXISTS idx_plan_units_practice_card ON plan_units(practice_card_id);
CREATE INDEX IF NOT EXISTS idx_learning_cases_practice_card ON learning_cases(practice_card_id);
CREATE INDEX IF NOT EXISTS idx_gym_build_jobs_practice_card ON gym_build_jobs(practice_card_id);
CREATE TABLE IF NOT EXISTS practice_card_sources (
  practice_card_id TEXT NOT NULL REFERENCES practice_cards(id), source_item_id TEXT NOT NULL REFERENCES learner_source_items(id),
  relevance REAL NOT NULL, position INTEGER NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(practice_card_id, source_item_id)
);
CREATE TABLE IF NOT EXISTS source_digests (
  id TEXT PRIMARY KEY, learner_id TEXT NOT NULL REFERENCES learners(id), source_item_id TEXT NOT NULL REFERENCES learner_source_items(id),
  digest_json TEXT NOT NULL DEFAULT '{}', quality REAL NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(learner_id, source_item_id)
);
CREATE TABLE IF NOT EXISTS practice_card_events (
  id TEXT PRIMARY KEY, practice_card_id TEXT NOT NULL REFERENCES practice_cards(id), learner_id TEXT NOT NULL REFERENCES learners(id),
  sequence INTEGER NOT NULL, type TEXT NOT NULL, payload_json TEXT NOT NULL DEFAULT '{}', client_request_id TEXT, created_at TEXT NOT NULL,
  UNIQUE(practice_card_id, sequence), UNIQUE(practice_card_id, client_request_id)
);
