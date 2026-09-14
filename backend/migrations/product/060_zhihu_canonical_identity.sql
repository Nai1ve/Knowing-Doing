-- Preserve every historical learner and connection. If old data assigned one
-- Zhihu identity to more than one learner, the earliest connection remains the
-- canonical identity; later ambiguous connections remain in place but must be
-- re-authorized before they can be used again.
ALTER TABLE provider_connections ADD COLUMN profile_json TEXT NOT NULL DEFAULT '{}';

WITH ambiguous_connections AS (
  SELECT candidate.id
  FROM provider_connections AS candidate
  WHERE NULLIF(TRIM(candidate.provider_user_id), '') IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM provider_connections AS canonical
      WHERE canonical.provider = candidate.provider
        AND NULLIF(TRIM(canonical.provider_user_id), '') = NULLIF(TRIM(candidate.provider_user_id), '')
        AND (
          canonical.created_at < candidate.created_at
          OR (canonical.created_at = candidate.created_at AND canonical.id < candidate.id)
        )
    )
)
UPDATE provider_connections
SET provider_user_id = NULL,
    status = 'reauthorization_required',
    updated_at = CURRENT_TIMESTAMP
WHERE id IN (SELECT id FROM ambiguous_connections);

CREATE UNIQUE INDEX idx_provider_connections_provider_user_identity
  ON provider_connections(provider, provider_user_id)
  WHERE provider_user_id IS NOT NULL AND LENGTH(TRIM(provider_user_id)) > 0;
