CREATE TABLE IF NOT EXISTS gym_sessions (
  id TEXT PRIMARY KEY, learner_id TEXT NOT NULL REFERENCES learners(id), practice_card_id TEXT NOT NULL REFERENCES practice_cards(id),
  learning_case_id TEXT REFERENCES learning_cases(id), gym_build_job_id TEXT REFERENCES gym_build_jobs(id),
  status TEXT NOT NULL CHECK(status IN ('active','completed','failed','expired')), stage TEXT NOT NULL CHECK(stage IN ('orienting','checking','preparing_runtime','practicing','reflecting','completed')) DEFAULT 'orienting', outcome TEXT CHECK(outcome IN ('verified','completed_with_gaps','incomplete')), activity_state_json TEXT NOT NULL DEFAULT '{}',
  client_request_id TEXT, created_at TEXT NOT NULL, completed_at TEXT, updated_at TEXT NOT NULL,
  UNIQUE(learner_id, practice_card_id, client_request_id)
);
CREATE TABLE IF NOT EXISTS gym_activity_attempts (
  id TEXT PRIMARY KEY, gym_session_id TEXT NOT NULL REFERENCES gym_sessions(id), activity_key TEXT NOT NULL,
  attempt_no INTEGER NOT NULL, answer_json TEXT NOT NULL DEFAULT '{}', result_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(gym_session_id, activity_key, attempt_no)
);
CREATE TABLE IF NOT EXISTS gym_session_events (
  id TEXT PRIMARY KEY, gym_session_id TEXT NOT NULL REFERENCES gym_sessions(id), sequence INTEGER NOT NULL, type TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}', client_request_id TEXT, created_at TEXT NOT NULL,
  UNIQUE(gym_session_id, sequence), UNIQUE(gym_session_id, client_request_id)
);
CREATE TABLE IF NOT EXISTS gym_profile_evidence (
  id TEXT PRIMARY KEY, learner_id TEXT NOT NULL REFERENCES learners(id), gym_session_id TEXT NOT NULL REFERENCES gym_sessions(id),
  evidence_key TEXT NOT NULL CHECK(evidence_key IN ('gym_knowledge','gym_runtime','gym_reflection')), content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
