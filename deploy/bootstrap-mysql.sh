#!/usr/bin/env bash
set -Eeuo pipefail

data_root="${ZHIXING_DATA_ROOT:-/home/ubuntu/knowing-doing-data}"
app_root="${ZHIXING_APP_ROOT:-/home/ubuntu/knowing-doing-current}"
compose_file="$app_root/deploy/docker-compose.production.yml"
dump_file="$data_root/zhixing-lab.sql"
env_file="$data_root/mysql.env"

if [ ! -f "$env_file" ]; then
  echo "Missing MySQL environment: $env_file" >&2
  exit 1
fi
if [ ! -f "$dump_file" ]; then
  echo "Missing MySQL dump: $dump_file" >&2
  exit 1
fi

set -a
. "$env_file"
set +a

if docker compose version >/dev/null 2>&1; then
  compose=(docker compose -f "$compose_file")
elif command -v docker-compose >/dev/null 2>&1; then
  compose=(docker-compose -f "$compose_file")
else
  echo "Docker Compose is not installed" >&2
  exit 1
fi

"${compose[@]}" up -d mysql
for attempt in $(seq 1 60); do
  if docker exec -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" zhixing-lab-mysql mysqladmin ping -h 127.0.0.1 -uroot --silent >/dev/null 2>&1; then
    break
  fi
  if [ "$attempt" = 60 ]; then
    echo "MySQL did not become ready" >&2
    exit 1
  fi
  sleep 2
done

# Migration and import are explicit deployment operations; the API never runs DDL.
# Older releases carried a fixed Lab schema migration. Current releases create
# learner-owned schemas through the dynamic case flow, so only apply that file
# when it is present in the selected release.
if [ -f "$app_root/backend/migrations/001_zhixing_lab_schema.sql" ]; then
  docker exec -i -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" zhixing-lab-mysql mysql -uroot < "$app_root/backend/migrations/001_zhixing_lab_schema.sql"
fi
docker exec -i -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" zhixing-lab-mysql mysql -uroot < "$dump_file"

docker exec -e MYSQL_PWD="$MYSQL_ROOT_PASSWORD" zhixing-lab-mysql mysql -uroot -e "
  CREATE USER IF NOT EXISTS 'zhixing_lab_runner'@'%' IDENTIFIED BY '$LAB_MYSQL_RUNNER_PASSWORD';
  ALTER USER 'zhixing_lab_runner'@'%' IDENTIFIED BY '$LAB_MYSQL_RUNNER_PASSWORD';
  CREATE USER IF NOT EXISTS 'zhixing_lab_admin'@'%' IDENTIFIED BY '$LAB_MYSQL_ADMIN_PASSWORD';
  ALTER USER 'zhixing_lab_admin'@'%' IDENTIFIED BY '$LAB_MYSQL_ADMIN_PASSWORD';
  GRANT SELECT, INSERT, UPDATE, DELETE, INDEX, ALTER ON zhixing_lab_slow.* TO 'zhixing_lab_runner'@'%';
  GRANT SELECT, INSERT, UPDATE, DELETE, INDEX, ALTER ON zhixing_lab_deadlock.* TO 'zhixing_lab_runner'@'%';
  GRANT SELECT, INSERT, UPDATE, DELETE, INDEX, ALTER ON zhixing_lab_pagination.* TO 'zhixing_lab_runner'@'%';
  GRANT ALL PRIVILEGES ON zhixing_lab_slow.* TO 'zhixing_lab_admin'@'%';
  GRANT ALL PRIVILEGES ON zhixing_lab_deadlock.* TO 'zhixing_lab_admin'@'%';
  GRANT ALL PRIVILEGES ON zhixing_lab_pagination.* TO 'zhixing_lab_admin'@'%';
  GRANT ALL PRIVILEGES ON *.* TO 'zhixing_lab_admin'@'%';
  FLUSH PRIVILEGES;
"
