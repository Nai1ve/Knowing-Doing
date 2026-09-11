-- Dynamic Gym cases are represented by learning_case_id. Fixed scheduler case
-- references must not remain reachable from a current roadmap or plan unit.
-- Historical practice_runs retain their case_id for audit and narrative evidence.
UPDATE plan_units
SET case_id = NULL
WHERE case_id IS NOT NULL;

UPDATE roadmap_nodes
SET case_id = NULL
WHERE case_id IS NOT NULL;
