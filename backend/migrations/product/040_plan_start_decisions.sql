ALTER TABLE learning_roadmaps ADD COLUMN execution_proposal_json TEXT NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS plan_start_decisions (
  id TEXT PRIMARY KEY,
  learner_id TEXT NOT NULL REFERENCES learners(id),
  plan_id TEXT NOT NULL REFERENCES learning_plans(id),
  roadmap_id TEXT REFERENCES learning_roadmaps(id),
  roadmap_node_id TEXT REFERENCES roadmap_nodes(id),
  plan_unit_id TEXT REFERENCES plan_units(id),
  source TEXT NOT NULL CHECK (source IN ('agent_recommended', 'learner_selected', 'legacy')),
  rationale_snapshot_json TEXT NOT NULL DEFAULT '{}',
  plan_revision INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_start_decisions_plan
  ON plan_start_decisions(plan_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_units_one_current
  ON plan_units(plan_id)
  WHERE status = 'current';

INSERT INTO plan_start_decisions (
  id, learner_id, plan_id, roadmap_id, roadmap_node_id, plan_unit_id,
  source, rationale_snapshot_json, plan_revision, created_at
)
SELECT
  lower(hex(randomblob(16))),
  p.learner_id,
  p.id,
  p.roadmap_id,
  u.roadmap_node_id,
  u.id,
  'legacy',
  '{}',
  p.revision,
  p.updated_at
FROM learning_plans p
JOIN plan_units u ON u.plan_id = p.id AND u.status = 'current'
WHERE NOT EXISTS (SELECT 1 FROM plan_start_decisions d WHERE d.plan_id = p.id);
