#!/usr/bin/env bash
set -Eeuo pipefail

# Starts the internal Builder only for the protected smoke gate. This lets the
# product CASE_BUILDER_ENABLED flag stay false until the real model/Docker
# contract has passed. The explicit service name makes the cleanup recoverable.
app_root="${ZHIXING_APP_ROOT:-/home/ubuntu/knowing-doing-current}"
smoke_script="$app_root/deploy/case-builder-smoke.sh"

cd "$app_root/deploy"
if docker compose version >/dev/null 2>&1; then
  compose=(docker compose -f docker-compose.production.yml)
elif command -v docker-compose >/dev/null 2>&1; then
  compose=(docker-compose -f docker-compose.production.yml)
else
  echo "Docker Compose is not installed" >&2
  exit 1
fi

was_running=false
if "${compose[@]}" ps --status running --services | grep -qx 'case-builder-agent'; then was_running=true; fi
cleanup() { if [ "$was_running" = false ]; then "${compose[@]}" stop case-builder-agent >/dev/null 2>&1 || true; fi; }
trap cleanup EXIT
"${compose[@]}" up -d --build case-builder-agent
bash "$smoke_script"
