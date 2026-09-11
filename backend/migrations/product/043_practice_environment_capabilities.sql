CREATE TABLE IF NOT EXISTS practice_environment_capabilities (
  planning_key TEXT PRIMARY KEY,
  capability_key TEXT NOT NULL,
  environment_key TEXT NOT NULL,
  environment_version TEXT NOT NULL,
  runtime_kind TEXT NOT NULL CHECK (runtime_kind IN ('mysql_lab', 'docker_workspace')),
  learning_mode TEXT NOT NULL CHECK (learning_mode IN ('lab', 'workspace')),
  case_intent TEXT NOT NULL,
  display_name TEXT NOT NULL,
  agent_summary TEXT NOT NULL,
  exercise_kinds_json TEXT NOT NULL DEFAULT '[]',
  aliases_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('available', 'disabled', 'planned', 'retired')),
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(capability_key, environment_key, environment_version)
);

CREATE INDEX IF NOT EXISTS idx_practice_environment_capabilities_status_position
  ON practice_environment_capabilities(status, position);

INSERT OR IGNORE INTO practice_environment_capabilities (
  planning_key, capability_key, environment_key, environment_version, runtime_kind,
  learning_mode, case_intent, display_name, agent_summary, exercise_kinds_json,
  aliases_json, status, position, created_at, updated_at
) VALUES
  ('python.collections.list', 'python.collections.list', 'python-pytest-v1', '1', 'docker_workspace',
   'workspace', 'python.collections.list', 'Python list 工作区',
   '可生成 Python list 的创建、索引、切片、可变性等可运行 pytest 案例；只能使用平台允许的 Python/pytest 命令。',
   '["concept_drill","code_repair"]', '["python list","python 列表","列表","list","切片","可变性"]', 'available', 10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('python.testing', 'python.testing', 'python-pytest-v1', '1', 'docker_workspace',
   'workspace', 'python.testing', 'Python pytest 工作区',
   '可生成受限的 Python 测试、调试与小型修复案例。',
   '["concept_drill","code_repair"]', '["python 测试","pytest"]', 'available', 20, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('mysql.slow-query-index', 'mysql.slow-query', 'mysql-performance-v1', '1', 'mysql_lab',
   'lab', 'mysql.slow-query-index', 'MySQL 慢查询实验室',
   '可生成包含订单数据、慢查询、EXPLAIN 和索引问题的受控 MySQL 性能案例。',
   '["data_diagnosis"]', '["mysql","慢查询","慢查","explain","执行计划","联合索引","索引优化","数据库性能","查询优化"]', 'available', 30, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('go.testing', 'go.testing', 'go-test-v1', '1', 'docker_workspace',
   'workspace', 'go.testing', 'Go testing 工作区',
   'Go 运行器尚未在当前部署环境启用，不能被规划或案例生成使用。',
   '["concept_drill","code_repair"]', '["go 测试","go testing"]', 'disabled', 40, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('java.testing', 'java.testing', 'java-maven-v1', '1', 'docker_workspace',
   'workspace', 'java.testing', 'Java Maven 工作区',
   'Java Maven 基座尚未部署。',
   '["concept_drill","code_repair"]', '["java 测试"]', 'planned', 50, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('rust.testing', 'rust.testing', 'rust-cargo-v1', '1', 'docker_workspace',
   'workspace', 'rust.testing', 'Rust Cargo 工作区',
   'Rust Cargo 基座尚未部署。',
   '["concept_drill","code_repair"]', '["rust 测试"]', 'planned', 60, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('cpp.testing', 'cpp.testing', 'cpp-cmake-v1', '1', 'docker_workspace',
   'workspace', 'cpp.testing', 'C++ CMake 工作区',
   'C++ CMake 基座尚未部署。',
   '["concept_drill","code_repair"]', '["c++ 测试","cpp 测试"]', 'planned', 70, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
