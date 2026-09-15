#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

commit="${1:?commit SHA is required}"
repo_root="${ZHIXING_REPO_ROOT:-/home/ubuntu/knowing-doing-repo}"
repo_url="${ZHIXING_REPO_URL:-https://github.com/Nai1ve/Knowing-Doing.git}"
release_root="${ZHIXING_RELEASE_ROOT:-/home/ubuntu/knowing-doing-releases}"
current_link="${ZHIXING_APP_ROOT:-/home/ubuntu/knowing-doing-current}"
canary_link="${ZHIXING_CANARY_ROOT:-/home/ubuntu/knowing-doing-canary}"
data_root="${ZHIXING_DATA_ROOT:-/home/ubuntu/knowing-doing-data}"
release_dir="$release_root/$commit"
archive_path="${ZHIXING_RELEASE_ARCHIVE:-}"
case_builder_env_file="$data_root/case-builder-agent.env"
commit_archive_path="$release_root/.incoming-$commit.tar.gz"

# A first-time manual clone may leave the repository one level below the
# configured root when that root already exists. Reuse that checkout instead
# of failing before the controlled fetch/commit verification can run.
if [ ! -e "$repo_root/.git" ] && [ -e "$repo_root/Knowing-Doing/.git" ]; then
  repo_root="$repo_root/Knowing-Doing"
fi

read_env_value() {
  local key="$1" file="$2"
  sudo -n awk -v key="$key" \
    'index($0, key "=") == 1 { print substr($0, length(key) + 2); found = 1; exit }
     END { exit found ? 0 : 1 }' "$file"
}

fetch_main() {
  local attempt
  local fetch_timeout="${ZHIXING_GIT_FETCH_TIMEOUT_SECONDS:-20}"
  for attempt in 1 2 3; do
    if timeout "$fetch_timeout" git -C "$repo_root" \
      -c http.lowSpeedLimit=1 \
      -c http.lowSpeedTime=10 \
      fetch --quiet origin main; then
      return 0
    fi
    sleep "$((attempt * 2))"
  done
  echo "Unable to fetch main from $repo_url after 3 attempts" >&2
  return 1
}

fetch_commit_archive() {
  local attempt
  local fetch_timeout="${ZHIXING_CODELOAD_TIMEOUT_SECONDS:-120}"
  local codeload_base="${ZHIXING_CODELOAD_URL:-$repo_url}"
  codeload_base="${codeload_base%.git}"
  codeload_base="${codeload_base/github.com/codeload.github.com}"

  rm -f -- "$commit_archive_path"
  for attempt in 1 2 3; do
    if curl --fail --location --silent --show-error \
      --connect-timeout 10 --max-time "$fetch_timeout" \
      "$codeload_base/tar.gz/$commit" -o "$commit_archive_path" \
      && tar -tzf "$commit_archive_path" >/dev/null 2>&1; then
      echo "Fetched immutable source archive for $commit from $codeload_base"
      return 0
    fi
    rm -f -- "$commit_archive_path"
    sleep "$((attempt * 2))"
  done

  echo "Unable to fetch source archive for $commit from $codeload_base" >&2
  return 1
}

install_release_archive() {
  local archive="$1"
  local strip_components="${2:-0}"
  local staging_dir="$release_root/.incoming-$commit"

  rm -rf -- "$staging_dir"
  mkdir -p "$staging_dir"
  if [ "$strip_components" -eq 1 ]; then
    tar -xzf "$archive" --strip-components=1 -C "$staging_dir"
  else
    tar -xzf "$archive" -C "$staging_dir"
  fi
  if [ ! -f "$staging_dir/backend/package.json" ]; then
    echo "Source archive does not contain backend/package.json: $archive" >&2
    rm -rf -- "$staging_dir"
    return 1
  fi
  if [ -e "$release_dir" ] || [ -L "$release_dir" ]; then
    rm -rf -- "$release_dir"
  fi
  mv "$staging_dir" "$release_dir"
}

prepare_case_builder_image() {
  if [ ! -f "$case_builder_env_file" ]; then
    echo "Missing Case Builder environment file: $case_builder_env_file" >&2
    exit 1
  fi

  local image_ref
  image_ref="$(read_env_value CASE_BUILDER_OPENHANDS_IMAGE "$case_builder_env_file" || true)"
  case "$image_ref" in
    *@sha256:*) ;;
    *) echo 'CASE_BUILDER_OPENHANDS_IMAGE must be a digest-pinned local image reference' >&2; exit 1 ;;
  esac

  docker image inspect "$image_ref" --format '{{.Id}}' >/dev/null 2>&1 || {
    echo "Prebuilt Case Builder OpenHands image is missing on this host: $image_ref" >&2
    echo 'Run deploy/setup-case-builder-agent.sh on the deployment host before enabling the Builder.' >&2
    exit 1
  }
  if [ "$(docker image inspect "$image_ref" --format '{{.Architecture}}')" != amd64 ]; then
    echo 'Prebuilt Case Builder OpenHands image must be amd64 on this host.' >&2
    exit 1
  fi
  echo "Using prebuilt Case Builder OpenHands image: $image_ref"
}

ensure_server_docker_images() {
  local image
  local required_images=(zhixing-python-pytest-v1:local zhixing-go-test-v1:local zhixing-workspace-runner:server)
  if sudo -n grep -q '^CASE_BUILDER_ENABLED=true$' /etc/knowing-doing/backend.env; then
    required_images+=(zhixing-case-builder-agent:server)
  fi
  for image in "${required_images[@]}"; do
    docker image inspect "$image" --format '{{.Id}}' >/dev/null 2>&1 || {
      echo "Required server-managed Docker image is missing: $image" >&2
      echo 'Run deploy/setup-docker-environment.sh on the deployment host before deploying.' >&2
      exit 1
    }
  done
}

wait_for_http_service() {
  local name="$1" url="$2" attempt
  for attempt in $(seq 1 30); do
    if curl --fail --silent --show-error --max-time 5 "$url" >/dev/null; then
      echo "$name is ready"
      return 0
    fi
    sleep 2
  done
  echo "$name did not become ready: $url" >&2
  return 1
}

prepare_frontend_assets() {
  # The release is created under umask 077 so backend source and deployment
  # configuration remain private. Nginx only needs traversal of the release
  # path and read access to the compiled frontend assets.
  chmod 711 "$release_root" "$release_dir" "$release_dir/frontend"
  find "$release_dir/frontend/dist" -type d -exec chmod 755 {} +
  find "$release_dir/frontend/dist" -type f -exec chmod 644 {} +
}

mkdir -p "$release_root" "$data_root"

if [ ! -f "$release_dir/backend/package.json" ]; then
  if [ -n "$archive_path" ]; then
    install_release_archive "$archive_path"
  else
    if [ ! -d "$repo_root/.git" ]; then
      if [ -e "$repo_root" ]; then
        echo "Deployment repository path exists but is not a Git checkout: $repo_root" >&2
        exit 1
      fi
      echo "Cloning deployment repository from $repo_url"
      mkdir -p "$(dirname "$repo_root")"
      git clone --origin origin "$repo_url" "$repo_root"
    else
      if git -C "$repo_root" remote get-url origin >/dev/null 2>&1; then
        git -C "$repo_root" remote set-url origin "$repo_url"
      else
        git -C "$repo_root" remote add origin "$repo_url"
      fi
    fi
    if fetch_main; then
      git -C "$repo_root" cat-file -e "$commit^{commit}"
      mkdir -p "$release_dir"
      git -C "$repo_root" archive "$commit" | tar -x -C "$release_dir"
    else
      echo "Git fetch unavailable; falling back to the exact commit archive." >&2
      fetch_commit_archive
      install_release_archive "$commit_archive_path" 1
    fi
  fi
fi

if [ -n "$archive_path" ]; then
  rm -f -- "$archive_path"
fi
rm -f -- "$commit_archive_path"

cd "$release_dir/backend"
npm ci --ignore-scripts
npm run build
cd "$release_dir/frontend"
npm ci --ignore-scripts
VITE_ZHIHU_OAUTH_ENABLED="$(read_env_value ZHIHU_OAUTH_ENABLED /etc/knowing-doing/backend.env || echo false)" \
VITE_ZHIHU_SOURCE_SYNC_ENABLED="$(read_env_value ZHIHU_SOURCE_SYNC_ENABLED /etc/knowing-doing/backend.env || echo false)" \
VITE_PRACTICE_CARD_V2_ENABLED="$(read_env_value PRACTICE_CARD_V2_ENABLED /etc/knowing-doing/backend.env || echo false)" \
VITE_MIXED_GYM_ENABLED="$(read_env_value MIXED_GYM_ENABLED /etc/knowing-doing/backend.env || echo false)" \
VITE_LEGACY_CASE_FLOW_ENABLED="$(read_env_value LEGACY_CASE_FLOW_ENABLED /etc/knowing-doing/backend.env || echo true)" \
npm run build
prepare_frontend_assets
if [ ! -f "$data_root/zhixing-product.db" ]; then
  echo "Missing product database: $data_root/zhixing-product.db" >&2
  exit 1
fi

cd "$release_dir/backend"
NODE_ENV=production ZHIXING_PRODUCT_DB_PATH="$data_root/zhixing-product.db" npm run db:migrate

if sudo -n grep -q '^CASE_BUILDER_ENABLED=true$' /etc/knowing-doing/backend.env; then
  prepare_case_builder_image
fi
ensure_server_docker_images

cd "$release_dir/deploy"
if sudo -n docker compose version >/dev/null 2>&1; then
  compose=(docker compose -f docker-compose.production.yml)
elif command -v docker-compose >/dev/null 2>&1; then
  compose=(docker-compose -f docker-compose.production.yml)
else
  echo "Docker Compose is not installed" >&2
  exit 1
fi
if sudo -n grep -q '^CASE_BUILDER_ENABLED=true$' /etc/knowing-doing/backend.env; then
  # The Agent and the Docker daemon must resolve the Builder workspace to the
  # exact same host path; a named volume cannot be bind-mounted by a child
  # container through the Docker socket.
  sudo -n install -d -m 0700 "$data_root/case-builder-state"
  sudo -n "${compose[@]}" up -d workspace-runner case-builder-agent
else
  sudo -n "${compose[@]}" stop case-builder-agent >/dev/null 2>&1 || true
  sudo -n "${compose[@]}" up -d workspace-runner
fi

wait_for_http_service 'Workspace Runner' http://127.0.0.1:3101/health
if sudo -n grep -q '^CASE_BUILDER_ENABLED=true$' /etc/knowing-doing/backend.env; then
  wait_for_http_service 'Case Builder Agent' http://127.0.0.1:3102/health
fi

if [ "${ZHIXING_CANARY_ONLY:-0}" = 1 ]; then
  # Rolling canary: stage the release and start the canary service on :3002
  # without touching the production symlink, systemd unit, or nginx. The
  # canary unit forces every business flag OFF (see knowing-doing-canary.service),
  # so the new schema + code are exercised safely alongside production.
  # OAuth cannot be exercised on the canary port: config.ts pins the OAuth
  # origin/callback to the production host, which is by design.
  ln -sfn "$release_dir" "$canary_link"
  sudo -n install -d -m 0755 /etc/systemd/system
  sudo -n install -m 0644 "$release_dir/deploy/knowing-doing-canary.service" /etc/systemd/system/knowing-doing-canary.service
  sudo -n systemctl daemon-reload
  sudo -n systemctl enable knowing-doing-canary.service >/dev/null
  sudo -n systemctl restart knowing-doing-canary.service
  wait_for_http_service 'Canary API' http://127.0.0.1:3002/healthz
  echo "Canary ready at http://127.0.0.1:3002 (frontend http://119.45.243.102:8082)."
  echo "Promote: re-run without ZHIXING_CANARY_ONLY. Roll back: systemctl disable --now knowing-doing-canary && rm -f \"$canary_link\""
  exit 0
fi

previous_release=""
if [ -L "$current_link" ]; then
  previous_release="$(readlink -f "$current_link" || true)"
fi

rollback_production_release() {
  local failed_status="$1"
  trap - ERR
  set +e
  if [ -z "$previous_release" ] || [ ! -d "$previous_release" ]; then
    echo "Production promotion failed and no previous immutable release is available for automatic rollback." >&2
    exit "$failed_status"
  fi

  echo "Promotion failed; restoring previous release: $previous_release" >&2
  ln -sfn "$previous_release" "$current_link"
  sudo -n systemctl daemon-reload
  sudo -n systemctl restart knowing-doing.service
  sudo -n systemctl reload nginx
  if ! wait_for_http_service 'Rolled-back API' http://127.0.0.1:3001/healthz; then
    echo "Automatic rollback could not restore a healthy API; inspect knowing-doing.service immediately." >&2
  fi
  exit "$failed_status"
}

# From this point, a failed nginx validation, systemd restart, or health probe
# must restore the prior immutable application release. SQLite migrations are
# append-only and deliberately remain in place; old releases are required to
# remain compatible with the expanded schema during the rollout window.
trap 'rollback_production_release $?' ERR
ln -sfn "$release_dir" "$current_link"

sudo -n install -d -m 0755 /etc/knowing-doing
sudo -n install -m 0644 "$release_dir/deploy/knowing-doing.service" /etc/systemd/system/knowing-doing.service
sudo -n install -m 0644 "$release_dir/deploy/nginx-knowing-doing.conf" /etc/nginx/sites-enabled/default
sudo -n systemctl daemon-reload
sudo -n nginx -t
sudo -n systemctl enable knowing-doing.service >/dev/null
sudo -n systemctl restart knowing-doing.service
sudo -n systemctl reload nginx

for attempt in $(seq 1 30); do
  if curl --fail --silent --show-error http://127.0.0.1:3001/healthz >/dev/null; then
    trap - ERR
    echo "Production release is healthy: $release_dir"
    exit 0
  fi
  sleep 2
done

echo "API did not become ready" >&2
sudo -n journalctl -u knowing-doing.service -n 80 --no-pager >&2 || true
rollback_production_release 1
