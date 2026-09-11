ALTER TABLE roadmap_nodes ADD COLUMN exercise_profile_key TEXT;
ALTER TABLE plan_units ADD COLUMN exercise_profile_key TEXT;
ALTER TABLE gym_build_jobs ADD COLUMN exercise_profile_key TEXT;
ALTER TABLE gym_build_jobs ADD COLUMN card_snapshot_json TEXT NOT NULL DEFAULT '{}';

-- Explicitly repair the known current Agent node. New Agent routes persist this
-- data directly; Gym construction must never infer it from title text again.
UPDATE roadmap_nodes
SET capability_key = 'mysql.explain-plan', exercise_profile_key = 'mysql.explain-plan-v1'
WHERE node_key = 'mysql-explain-analysis-lab'
  AND learning_mode = 'lab'
  AND capability_key IS NULL;

UPDATE plan_units
SET exercise_profile_key = (
  SELECT n.exercise_profile_key
  FROM roadmap_nodes n
  WHERE n.id = plan_units.roadmap_node_id
)
WHERE roadmap_node_id IS NOT NULL
  AND exercise_profile_key IS NULL;

INSERT OR IGNORE INTO practice_environment_capabilities (
  planning_key, capability_key, environment_key, environment_version, runtime_kind,
  learning_mode, case_intent, display_name, agent_summary, exercise_kinds_json,
  aliases_json, status, position, created_at, updated_at
) VALUES (
  'mysql.explain-plan', 'mysql.explain-plan', 'mysql-performance-v1', '1', 'mysql_lab',
  'lab', 'mysql.explain-plan', 'MySQL 执行计划实验室',
  '可生成受控的多条件查询、EXPLAIN 字段观察和索引验证案例；只能选择平台注册的物料 profile。',
  '["data_diagnosis"]', '["mysql explain","执行计划","explain 计划"]', 'available', 31, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_gym_build_jobs_unit_profile_created
  ON gym_build_jobs(plan_unit_id, exercise_profile_key, created_at DESC);
