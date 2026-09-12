-- v1 deliberately runs one OpenHands build at a time.  This lease is shared
-- by every API process, unlike the in-memory per-process mutex.
CREATE TABLE IF NOT EXISTS gym_build_global_locks (
  lock_name TEXT PRIMARY KEY CHECK (lock_name = 'environment-build-v1'),
  gym_build_job_id TEXT NOT NULL REFERENCES gym_build_jobs(id),
  worker_token TEXT NOT NULL,
  lease_expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gym_build_global_locks_lease
  ON gym_build_global_locks(lease_expires_at);
