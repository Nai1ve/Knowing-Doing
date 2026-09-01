CREATE TABLE IF NOT EXISTS practice_pins (
  id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learners(id),
  practice_run_id TEXT NOT NULL REFERENCES practice_runs(id),
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(practice_run_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS idx_practice_pins_run_created ON practice_pins(practice_run_id, created_at DESC);
