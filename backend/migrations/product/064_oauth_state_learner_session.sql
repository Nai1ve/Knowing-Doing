-- Bind OAuth authorization state to the concrete device session that started
-- it. The callback must match state + device session + expiry + one-time
-- consumption together, so a state captured on one device can never be replayed
-- through another session. Existing rows keep a NULL learner_session_id; only
-- newly started OAuth flows carry the binding. The binding is enforced by the
-- callback lookup rather than a foreign key so the gateway remains testable
-- with synthetic session identifiers.
ALTER TABLE oauth_authorization_states ADD COLUMN learner_session_id TEXT;
CREATE INDEX IF NOT EXISTS idx_oauth_states_learner_session ON oauth_authorization_states(provider, learner_session_id, state_hash, expires_at);
